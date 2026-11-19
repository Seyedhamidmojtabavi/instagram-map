import { randomUUID } from "node:crypto";
import { cityCenters, inferCity, normalizeText } from "./evidence.mjs";

// The anonymous search route used by neshan.org's own public map. It is called
// without copied browser cookies or session tokens.
const pwaSearchEndpoint = "https://neshan.org/maps/pwa-api/neshan-search";
const officialSearchEndpoint = "https://api.neshan.org/v1/search";
const pwaClientVersion = "2028";

const searchTemplate = {
  zoom: 6,
  limit: 30,
  filters: {},
  night: false,
  location: null,
  center: { x: 49.220930223430116, y: 35.43772937695179 },
  boundary: {
    south_west: { x: 49.290323435067165, y: 33.4334287705627 },
    south_east: { x: 53.156749959187096, y: 33.4334287705627 },
    north_east: { x: 53.156749959187096, y: 37.39205264216352 },
    north_west: { x: 49.290323435067165, y: 37.39205264216352 },
  },
};

const genericNameTokens = new Set([
  "the", "and", "co", "official", "page", "iran", "tehran",
  "کافه", "رستوران", "فروشگاه", "آموزش", "آموزشی", "آکادمی", "مرکز",
  "کلینیک", "مطب", "سالن", "مجتمع", "شرکت", "صفحه", "رسمی", "ایران",
  "تهران", "فود", "شاپ", "گروه",
]);

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function toLatinDigits(value) {
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return String(value ?? "").replace(/[۰-۹٠-٩]/g, (digit) => {
    const persianIndex = persianDigits.indexOf(digit);
    return String(persianIndex >= 0 ? persianIndex : arabicDigits.indexOf(digit));
  });
}

export function phoneNumbers(value) {
  const normalized = toLatinDigits(value);
  const matches = normalized.match(/(?:\+?98|0)?[\d\s()-]{8,16}\d/g) ?? [];
  return new Set(
    matches
      .map((phone) => phone.replace(/\D/g, ""))
      .map((phone) => phone.replace(/^0098/, "").replace(/^98/, "").replace(/^0/, ""))
      .filter((phone) => phone.length >= 8)
      .map((phone) => phone.slice(-10)),
  );
}

export function tokenSet(value, { removeGeneric = false } = {}) {
  const values = normalizeText(value).split(" ").filter((token) => token.length >= 2);
  return new Set(removeGeneric ? values.filter((token) => !genericNameTokens.has(token)) : values);
}

function intersectionSize(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

export function setMatchScore(expected, actual) {
  if (expected.size === 0 || actual.size === 0) return 0;
  const matches = intersectionSize(expected, actual);
  const containment = matches / expected.size;
  const dice = (2 * matches) / (expected.size + actual.size);
  return Math.max(containment, dice);
}

/** How well a place title matches the account's display name and handle (0-1). */
export function nameMatchScore(profile, title) {
  const expected = tokenSet(`${profile.fullName} ${profile.username.replace(/[._-]+/g, " ")}`, {
    removeGeneric: true,
  });
  let score = setMatchScore(expected, tokenSet(title, { removeGeneric: true }));
  const fullName = normalizeText(profile.fullName);
  const normalizedTitle = normalizeText(title);
  const exactPhrase =
    fullName.length >= 4 && normalizedTitle.length >= 4 &&
    (fullName.includes(normalizedTitle) || normalizedTitle.includes(fullName));
  if (exactPhrase) score = Math.max(score, 0.98);
  return { score, exactPhrase, distinctive: expected.size > 0 };
}

function categoryMatch(primaryCategory, item) {
  const resultType = normalizeText(`${item.type ?? ""} ${item.typeTitle ?? ""}`);
  const patterns = {
    Restaurants: /restaurant|fast food|food court|رستوران|فست فود|غذا/,
    Cafes_and_Coffee_Shops: /cafe|coffee|کافه|قهوه/,
    Bakeries_Desserts_and_Sweets: /bakery|pastry|sweet|ice cream|نانوایی|شیرینی|بستنی/,
    Health_Medical_and_Wellness: /hospital|clinic|doctor|pharmacy|درمانگاه|بیمارستان|پزشک|داروخانه/,
    Sports_and_Fitness: /gym|sport|ورزش|باشگاه/,
    Travel_Hotels_and_Events: /hotel|lodging|هتل|اقامتگاه/,
    Education_and_Language: /school|education|university|آموزش|مدرسه|دانشگاه/,
  };
  return patterns[primaryCategory]?.test(resultType) ? 1 : 0;
}

export function scoreMatch({ profile, evidence, primaryCategory }, item) {
  const name = nameMatchScore(profile, item.title);
  const expectedLocation = tokenSet(
    [evidence.locationText, ...evidence.tags.map((tag) => `${tag.name} ${tag.address}`)].join(" "),
  );
  const locationScore = setMatchScore(expectedLocation, tokenSet(item.subtitle));
  const typeScore = categoryMatch(primaryCategory, item);
  const candidatePhones = phoneNumbers(`${profile.biography} ${evidence.phone}`);
  const phoneMatch = (item.phones ?? []).some((phone) => candidatePhones.has(phone));
  const resultCity = inferCity(item.subtitle);
  const cityConflict = Boolean(evidence.cityHint && resultCity) && evidence.cityHint !== resultCity;
  const total =
    name.score * 0.76 + locationScore * 0.19 + typeScore * 0.05 + (phoneMatch ? 0.12 : 0);
  return {
    total: Math.min(total, 1),
    nameScore: name.score,
    locationScore,
    typeScore,
    exactPhrase: name.exactPhrase,
    phoneMatch,
    cityConflict,
    hasDistinctiveName: name.distinctive,
  };
}

export function isCertainMatch(best, runnerUp) {
  if (!best) return false;
  const margin = best.score.total - (runnerUp?.score.total ?? 0);
  if (!best.score.hasDistinctiveName || best.score.cityConflict) return false;
  if (best.score.phoneMatch) return best.score.nameScore >= 0.55;
  if (margin < 0.15) return false;
  return (
    (best.score.nameScore >= 0.85 && best.score.locationScore >= 0.6) ||
    (best.score.exactPhrase && best.score.nameScore >= 0.9 && best.score.locationScore >= 0.3)
  );
}

export function decodePwaResponse(raw) {
  const trimmed = raw.trim();
  let decoded;
  try {
    decoded = JSON.parse(trimmed);
  } catch {
    // Current PWA responses use two rotated base64 chunks plus a signature.
    const envelope = trimmed.match(/^([A-Za-z0-9+/]{28})([A-Za-z0-9+/=]+)@(\d+)([A-Za-z0-9+/]{28})$/);
    if (!envelope) throw new Error("Neshan PWA response envelope changed; refusing to guess.");
    const encodedPayload = envelope[2];
    const splitIndex = Number(envelope[3]);
    if (!Number.isInteger(splitIndex) || splitIndex < 0 || splitIndex > encodedPayload.length) {
      throw new Error("Neshan PWA response contained an invalid split index.");
    }
    const restored = encodedPayload.slice(splitIndex) + encodedPayload.slice(0, splitIndex);
    decoded = JSON.parse(Buffer.from(restored, "base64").toString("utf8"));
  }
  if (!decoded || !Array.isArray(decoded.items)) {
    throw new Error("Neshan PWA response did not contain a result list.");
  }
  return decoded;
}

function compactPwaItems(result) {
  return (result.items ?? [])
    .filter((item) => item?.location && item.isAd !== true)
    .filter(
      (item) =>
        item.category === "place" &&
        item.id?.startsWith("poi_") &&
        item.publishStatus !== "UNPUBLISHED" &&
        item.showOnMap !== false,
    )
    .map((item) => ({
      title: item.title,
      subtitle: item.subtitle,
      type: item.type,
      typeTitle: item.typeTitle,
      location: { x: Number(item.location.x), y: Number(item.location.y) },
      phones: (item.actions ?? [])
        .filter((action) => action.type === "CALL")
        .flatMap((action) => {
          try {
            return [...phoneNumbers(JSON.parse(action.metaData).phone)];
          } catch {
            return [];
          }
        }),
    }))
    .filter((item) => Number.isFinite(item.location.x) && Number.isFinite(item.location.y));
}

/**
 * Creates a search function backed by the official API (when a service key is
 * configured) or the anonymous PWA route. Results are cached in `cache`.
 * Throws `NeshanUnavailableError` after three consecutive transport failures so
 * a blocked network does not burn the whole run.
 */
export class NeshanUnavailableError extends Error {}

export function createNeshanSearch({ apiKey = "", usePwaSearch = true, requestDelayMs = 450, cache = {}, fetchImpl = fetch } = {}) {
  const uuid = `web_${randomUUID()}`;
  let consecutiveFailures = 0;
  let disabled = !apiKey && !usePwaSearch;

  async function official(term, cityHint) {
    const [lng, lat] = cityCenters[cityHint] ?? cityCenters.tehran;
    const params = new URLSearchParams({ term, lat: String(lat), lng: String(lng) });
    const response = await fetchImpl(`${officialSearchEndpoint}?${params}`, {
      headers: { "Api-Key": apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Neshan API returned HTTP ${response.status}.`);
    const body = await response.json();
    return (body.items ?? []).map((item) => ({
      title: item.title,
      subtitle: [item.region, item.neighbourhood, item.address].filter(Boolean).join("، "),
      type: item.type,
      typeTitle: item.category,
      location: { x: Number(item.location?.x), y: Number(item.location?.y) },
      phones: [],
    })).filter((item) => Number.isFinite(item.location.x) && Number.isFinite(item.location.y));
  }

  async function pwa(term) {
    const body = Buffer.from(encodeURIComponent(JSON.stringify({ ...searchTemplate, uuid, term }))).toString("base64");
    const params = new URLSearchParams({ body, "search-in-bound": "false" });
    const response = await fetchImpl(`${pwaSearchEndpoint}?${params}`, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: "https://neshan.org/maps/",
        uuid,
        "X-Client-Version": pwaClientVersion,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Neshan PWA search returned HTTP ${response.status}.`);
    return compactPwaItems(decodePwaResponse(await response.text()));
  }

  return {
    get available() {
      return !disabled;
    },
    async search(term, cityHint) {
      const provider = apiKey ? "api" : "pwa";
      const key = `${provider}-v3|${cityHint ?? ""}|${term}`;
      if (cache[key]) return cache[key];
      if (disabled) return null;
      try {
        const items = apiKey ? await official(term, cityHint) : await pwa(term);
        consecutiveFailures = 0;
        cache[key] = items;
        await sleep(requestDelayMs);
        return items;
      } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          disabled = true;
          throw new NeshanUnavailableError(`Neshan search unavailable: ${error.message}`);
        }
        return null;
      }
    },
  };
}

/** Follows short map links (maps.app.goo.gl) to find the coordinates they encode. */
export async function resolveMapLink(url, { isAllowed, extract, cache = {}, fetchImpl = fetch }) {
  const direct = extract(url);
  if (direct) return direct;
  const key = `map-link-v5|${url}`;
  if (key in cache) return cache[key];
  let coordinates = null;
  let current = url;
  try {
    for (let hop = 0; hop <= 5; hop += 1) {
      if (!isAllowed(current)) break;
      const response = await fetchImpl(current, {
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        current = new URL(location, current).toString();
        coordinates = extract(current);
        if (coordinates) break;
        continue;
      }
      coordinates = extract(current);
      break;
    }
  } catch {
    coordinates = null;
  }
  cache[key] = coordinates;
  return coordinates;
}
