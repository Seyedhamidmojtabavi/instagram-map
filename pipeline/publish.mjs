import taxonomy from "../lib/categories.json" with { type: "json" };
import { primaryCategoryOf } from "./evidence.mjs";

const categoryById = new Map(taxonomy.categories.map((category) => [category.id, category]));
const familyById = new Map(taxonomy.families.map((family) => [family.id, family]));

function familyOf(categoryId) {
  return familyById.get(categoryById.get(categoryId)?.family ?? "people") ?? taxonomy.families.at(-1);
}

function snippet(text, length = 180) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}

/**
 * Turns pipeline state into the public payload the website reads. Private
 * accounts and personal (non-public) accounts are left out entirely.
 */
export function buildAtlas(state, { includePrivateAccounts = false, now = new Date() } = {}) {
  const directory = [];
  const places = [];
  let hiddenCount = 0;
  let reviewCount = 0;

  for (const follow of Object.values(state.following)) {
    const profile = state.profiles[follow.pk];
    const classification = state.classifications[follow.pk];
    const location = state.locations[follow.pk];
    const isPrivate = profile?.isPrivate ?? follow.isPrivate;
    const categories = classification?.categories ?? [];
    if ((isPrivate && !includePrivateAccounts) || categories.some((id) => categoryById.get(id)?.hiddenFromDirectory)) {
      hiddenCount += 1;
      continue;
    }
    const primaryCategory = categories.length ? primaryCategoryOf(categories) : null;
    const family = primaryCategory ? familyOf(primaryCategory) : null;
    const isLocated = location?.status === "located";
    if (location?.status === "review") reviewCount += 1;

    const entry = {
      pk: follow.pk,
      username: profile?.username ?? follow.username,
      fullName: profile?.fullName ?? follow.fullName ?? "",
      categories,
      primaryCategory,
      family: family?.id ?? null,
      verified: Boolean(profile?.isVerified ?? follow.isVerified),
      bio: snippet(profile?.biography),
      located: isLocated,
      pending: !profile || !classification,
    };
    directory.push(entry);

    if (isLocated) {
      places.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: location.coordinates },
        properties: {
          pk: follow.pk,
          username: entry.username,
          fullName: entry.fullName || location.title || entry.username,
          biography: profile?.biography ?? "",
          address: location.address ?? "",
          categories,
          primaryCategory,
          family: family?.id ?? "people",
          color: family?.color ?? "#5E6675",
          instagramUrl: `https://www.instagram.com/${entry.username}/`,
          geocodeMethod: location.method,
          geocodeConfidence: location.confidence ?? null,
        },
      });
    }
  }

  directory.sort((a, b) =>
    Number(b.located) - Number(a.located) ||
    (a.fullName || a.username).localeCompare(b.fullName || b.username, "fa"),
  );

  const lastRun = state.runs.at(-1) ?? null;
  return {
    type: "FeatureCollection",
    generatedAt: now.toISOString(),
    lastSyncAt: state.lastSuccessfulSyncAt ?? null,
    source: state.target ? { username: state.target.username } : null,
    stats: {
      following: Object.keys(state.following).length,
      listed: directory.length,
      located: places.length,
      awaitingReview: reviewCount,
      hidden: hiddenCount,
      pendingProfiles: directory.filter((entry) => entry.pending).length,
    },
    sync: lastRun
      ? { finishedAt: lastRun.finishedAt, ok: lastRun.ok, message: lastRun.publicMessage ?? null }
      : null,
    features: places,
    directory,
  };
}
