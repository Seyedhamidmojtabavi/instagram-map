import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { acquireLock, loadState, paths, readJson, saveState, writeJson } from "./store.mjs";
import { createInstagramClient, InstagramError } from "./instagram.mjs";
import { classificationFingerprint, classifyProfiles } from "./classify.mjs";
import { buildEvidence, fingerprint, primaryCategoryOf } from "./evidence.mjs";
import { createNeshanSearch, NeshanUnavailableError } from "./neshan.mjs";
import { locateProfile } from "./geocode.mjs";
import { buildAtlas } from "./publish.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
export const REMOVE_AFTER_MISSED_RUNS = 3;

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function loadSeedPins() {
  try {
    const seed = JSON.parse(await readFile(`${repoRoot}public/locations.geojson`, "utf8"));
    return new Map(seed.features.map((feature) => [feature.properties.username.toLowerCase(), feature]));
  } catch {
    return new Map();
  }
}

/** Human decisions: the committed list plus anything approved in the admin page. */
async function loadApprovals(dataDir) {
  const committed = await readJson(`${repoRoot}scripts/location-approvals.json`, { approvals: [] });
  const runtime = await readJson(paths(dataDir).approvals, { approvals: [] });
  const approvals = new Map();
  for (const approval of [...(committed.approvals ?? []), ...(runtime.approvals ?? [])]) {
    approvals.set(String(approval.username).toLowerCase(), approval);
  }
  return approvals;
}

/** Picks which profiles to (re)fetch this run: new follows first, then the stalest. */
export function profileQueue(state, { budget, maxAgeDays, now = Date.now() }) {
  const missing = [];
  const stale = [];
  for (const follow of Object.values(state.following)) {
    const profile = state.profiles[follow.pk];
    if (!profile) missing.push(follow);
    else if (now - Date.parse(profile.fetchedAt) > maxAgeDays * DAY) stale.push({ follow, at: Date.parse(profile.fetchedAt) });
  }
  stale.sort((a, b) => a.at - b.at);
  return [...missing, ...stale.map((item) => item.follow)].slice(0, budget);
}

function needsPostLocations(profile) {
  if (profile.isPrivate) return false;
  if (profile.business?.street && profile.business?.lat) return false;
  return profile.isBusiness || profile.isProfessional || Boolean(profile.category);
}

export async function runSync({ config = loadConfig(), log = console.log, fetchImpl = fetch, now = () => new Date() } = {}) {
  const { dataDir } = config;
  const release = await acquireLock(dataDir);
  if (!release) {
    log("Another sync is already running; skipping.");
    return { skipped: true, reason: "locked" };
  }
  const startedAt = now();
  const stats = { following: 0, added: 0, removed: 0, profilesFetched: 0, classified: 0, located: 0, review: 0, requests: 0 };
  const run = { startedAt: startedAt.toISOString(), ok: false, stats };
  let state;
  try {
    state = await loadState(dataDir);
    const inBackoff = Boolean(state.backoffUntil && Date.parse(state.backoffUntil) > startedAt.getTime());
    if (inBackoff) log(`Instagram asked us to slow down; skipping Instagram until ${state.backoffUntil}.`);

    // ---- 1. Instagram: who does the account follow, and what do their profiles say?
    const sessionPath = paths(dataDir).session;
    const envAuthorization = config.instagram.authorization;
    const stored = await readJson(sessionPath, null);
    const source = hash(envAuthorization || config.instagram.sessionId || "none");
    const authorization = stored?.source === source && stored.authorization ? stored.authorization : envAuthorization;
    const ig = createInstagramClient({
      authorization,
      sessionId: config.instagram.sessionId,
      baseUrl: config.instagram.baseUrl,
      requestDelayMs: config.instagram.requestDelayMs,
      fetchImpl,
      onAuthorizationRefresh: (value) =>
        writeJson(sessionPath, { source, authorization: value, at: now().toISOString() }, { mode: 0o600 }),
    });

    let instagramError = null;
    try {
      if (inBackoff) throw new InstagramError("Waiting for the Instagram rate limit to reset.", { kind: "backoff" });
      const owner = await ig.currentUser();
      state.owner = owner;
      const target = config.instagram.targetUsername && config.instagram.targetUsername.toLowerCase() !== owner.username.toLowerCase()
        ? await ig.lookupUser(config.instagram.targetUsername)
        : { ...owner, isPrivate: false };
      state.target = { pk: target.pk, username: target.username };
      log(`Signed in as @${owner.username}; reading who @${target.username} follows.`);

      const following = await ig.following(target.pk);
      const previousCount = Object.keys(state.following).length;
      if (previousCount >= 20 && following.length < previousCount * 0.4) {
        throw new InstagramError(
          `Instagram returned ${following.length} follows (was ${previousCount}). Refusing to drop that many at once.`,
        );
      }
      // An account missing from one read may just be Instagram's unstable
      // paging. Drop a page only after it is missing from several runs in a row.
      const next = {};
      const nowIso = now().toISOString();
      for (const user of following) {
        const previous = state.following[user.pk];
        if (!previous) stats.added += 1;
        next[user.pk] = { ...user, firstSeenAt: previous?.firstSeenAt ?? nowIso, missedRuns: 0 };
      }
      for (const [pk, previous] of Object.entries(state.following)) {
        if (next[pk]) continue;
        const missedRuns = (previous.missedRuns ?? 0) + 1;
        if (missedRuns < REMOVE_AFTER_MISSED_RUNS) {
          next[pk] = { ...previous, missedRuns };
          continue;
        }
        stats.removed += 1;
        delete state.profiles[pk];
        delete state.classifications[pk];
        delete state.locations[pk];
      }
      state.following = next;
      stats.following = Object.keys(next).length;
      log(`Following ${Object.keys(next).length} accounts (${stats.added} new, ${stats.removed} unfollowed).`);

      const queue = profileQueue(state, {
        budget: config.instagram.profileBudget,
        maxAgeDays: config.instagram.profileMaxAgeDays,
        now: startedAt.getTime(),
      });
      for (const [index, follow] of queue.entries()) {
        // Instagram occasionally answers with a stripped-down profile (no
        // username or name). Retry once, then leave it for the next run.
        let profile = await ig.userInfo(follow.pk);
        if (!profile.username) profile = await ig.userInfo(follow.pk);
        if (!profile.username) {
          stats.incompleteProfiles = (stats.incompleteProfiles ?? 0) + 1;
          log(`Instagram returned an incomplete profile for @${follow.username}; retrying next run.`);
          continue;
        }
        profile.postLocations = config.instagram.fetchPostLocations && needsPostLocations(profile)
          ? await ig.postLocations(follow.pk)
          : state.profiles[follow.pk]?.postLocations ?? [];
        profile.fetchedAt = now().toISOString();
        state.profiles[follow.pk] = profile;
        stats.profilesFetched += 1;
        if ((index + 1) % 10 === 0) {
          await saveState(dataDir, state);
          log(`Fetched ${index + 1}/${queue.length} profiles.`);
        }
      }
      state.backoffUntil = null;
      state.backoffMinutes = 0;
    } catch (error) {
      if (!(error instanceof InstagramError)) throw error;
      instagramError = error;
      log(`Instagram: ${error.message}`);
      if (error.kind === "backoff") {
        // Keep the existing backoff window.
      } else if (error.kind === "rate-limit") {
        state.backoffMinutes = Math.min((state.backoffMinutes || 60) * 2, 24 * 60);
        state.backoffUntil = new Date(startedAt.getTime() + state.backoffMinutes * 60_000).toISOString();
      }
    }
    stats.requests = ig.requestCount;
    await saveState(dataDir, state);

    // ---- 2. Classify profiles that are new or whose name, bio, or category changed.
    const toClassify = Object.values(state.following)
      .map((follow) => state.profiles[follow.pk])
      .filter(Boolean)
      .filter((profile) => state.classifications[profile.pk]?.fingerprint !== classificationFingerprint(profile));
    if (toClassify.length) {
      log(`Classifying ${toClassify.length} profiles${config.classifier.apiKey ? " with Gemini" : " with keyword rules (no GEMINI_API_KEY)"}.`);
      const results = await classifyProfiles(toClassify, { ...config.classifier, fetchImpl, log });
      for (const profile of toClassify) {
        const result = results.get(profile.pk);
        state.classifications[profile.pk] = {
          ...result,
          fingerprint: classificationFingerprint(profile),
          at: now().toISOString(),
        };
      }
      stats.classified = toClassify.length;
      await saveState(dataDir, state);
    }

    // ---- 3. Locate public places.
    const approvals = await loadApprovals(dataDir);
    const seedPins = await loadSeedPins();
    const cache = await readJson(paths(dataDir).cache, {});
    const neshan = createNeshanSearch({
      apiKey: config.geocoder.neshanApiKey,
      usePwaSearch: config.geocoder.usePwaSearch,
      requestDelayMs: config.geocoder.requestDelayMs,
      cache,
      fetchImpl,
    });
    let searchNotice = null;
    for (const follow of Object.values(state.following)) {
      const profile = state.profiles[follow.pk];
      const classification = state.classifications[follow.pk];
      if (!profile || !classification) continue;
      const approval = approvals.get(profile.username.toLowerCase());
      const evidence = buildEvidence(profile, classification.categories);
      const locateFingerprint = fingerprint([evidence.fingerprint, approval ?? null]);
      const previous = state.locations[follow.pk];
      if (previous?.fingerprint === locateFingerprint && !(previous.status === "review" && previous.searchUnavailable && neshan.available)) {
        continue;
      }

      const seed = seedPins.get(profile.username.toLowerCase());
      if (!previous && seed && !approval && evidence.eligible) {
        state.locations[follow.pk] = {
          status: "located",
          method: seed.properties.geocodeMethod ?? "seed",
          coordinates: seed.geometry.coordinates,
          address: seed.properties.address ?? "",
          title: seed.properties.fullName ?? "",
          confidence: seed.properties.geocodeConfidence ?? 0.9,
          fingerprint: locateFingerprint,
          at: now().toISOString(),
        };
        continue;
      }

      let result;
      try {
        result = await locateProfile({
          profile,
          primaryCategory: primaryCategoryOf(classification.categories),
          evidence,
          approval,
          neshan,
          cache,
          fetchImpl,
        });
      } catch (error) {
        if (!(error instanceof NeshanUnavailableError)) throw error;
        searchNotice = error.message;
        log(`${error.message}. Continuing with Instagram evidence only.`);
        result = await locateProfile({ profile, primaryCategory: primaryCategoryOf(classification.categories), evidence, approval, neshan: null, cache, fetchImpl });
      }
      // Keep a known-good pin when fresh evidence is merely weaker (for example a
      // bio edit, or Neshan being unreachable). Pins derived from Instagram
      // evidence are recomputed from that evidence instead.
      if (previous?.status === "located" && result.status === "review" && !previous.method?.startsWith("instagram-")) {
        state.locations[follow.pk] = { ...previous, fingerprint: locateFingerprint };
        continue;
      }
      state.locations[follow.pk] = { ...result, fingerprint: locateFingerprint, at: now().toISOString() };
    }
    await writeJson(paths(dataDir).cache, cache);

    for (const location of Object.values(state.locations)) {
      if (location.status === "located") stats.located += 1;
      if (location.status === "review") stats.review += 1;
    }

    // ---- 4. Publish.
    run.ok = !instagramError;
    run.finishedAt = now().toISOString();
    run.error = instagramError?.message ?? null;
    run.errorKind = instagramError?.kind ?? null;
    run.searchNotice = searchNotice;
    run.publicMessage = instagramError
      ? instagramError.kind === "rate-limit" || instagramError.kind === "backoff"
        ? "Instagram asked for a pause. The next sync resumes automatically."
        : "Sync is paused until the Instagram session is renewed."
      : null;
    if (run.ok) state.lastSuccessfulSyncAt = run.finishedAt;
    state.runs = [...state.runs, run].slice(-40);
    await saveState(dataDir, state);
    await writeJson(paths(dataDir).atlas, buildAtlas(state, config.publish));
    await writeJson(paths(dataDir).review, buildReviewQueue(state));
    log(`Published ${stats.located} places; ${stats.review} waiting for review.`);
    return { ok: run.ok, stats, error: run.error };
  } catch (error) {
    run.finishedAt = now().toISOString();
    run.error = error.message;
    if (state) {
      state.runs = [...state.runs, run].slice(-40);
      await saveState(dataDir, state).catch(() => {});
    }
    throw error;
  } finally {
    await release();
  }
}

/** Private list for the admin page: accounts that look like places but have no confident pin. */
export function buildReviewQueue(state) {
  const items = [];
  for (const follow of Object.values(state.following)) {
    const location = state.locations[follow.pk];
    const profile = state.profiles[follow.pk];
    if (location?.status !== "review" || !profile) continue;
    items.push({
      pk: follow.pk,
      username: profile.username,
      fullName: profile.fullName,
      biography: profile.biography,
      categories: state.classifications[follow.pk]?.categories ?? [],
      reason: location.reason,
      proposals: location.proposals ?? [],
    });
  }
  return { generatedAt: new Date().toISOString(), count: items.length, items };
}
