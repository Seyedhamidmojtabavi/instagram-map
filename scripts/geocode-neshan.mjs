import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const candidatePath = join(appRoot, "data", "location-candidates.json");
const geojsonPath = join(appRoot, "public", "locations.geojson");
const reviewPath = join(appRoot, "data", "location-review.json");
const cachePath = join(appRoot, "data", ".pwa-geocode-cache.json");
const approvalPath = join(here, "location-approvals.json");

// This is the anonymous search route used by neshan.org's own public map.
// It is intentionally called without copied browser cookies or session tokens.
const pwaSearchEndpoint = "https://neshan.org/maps/pwa-api/neshan-search";
const pwaUuid = process.env.NESHAN_PWA_UUID ?? `web_${randomUUID()}`;
const pwaClientVersion = "2028";
const requestDelayMs = Number(process.env.PWA_SEARCH_DELAY_MS ?? 450);

const searchTemplate = {
  uuid: pwaUuid,
  zoom: 6,
  limit: 30,
  filters: {},
  night: false,
  location: null,
  center: {
    x: 49.220930223430116,
    y: 35.43772937695179,
  },
  boundary: {
    south_west: { x: 49.290323435067165, y: 33.4334287705627 },
    south_east: { x: 53.156749959187096, y: 33.4334287705627 },
    north_east: { x: 53.156749959187096, y: 37.39205264216352 },
    north_west: { x: 49.290323435067165, y: 37.39205264216352 },
  },
};

const colorByCategory = {
  Restaurants: "#9f3d2f",
  Cafes_and_Coffee_Shops: "#a96f3a",
  Bakeries_Desserts_and_Sweets: "#c48d55",
  Food_Products_Catering_and_Grocery: "#b75a3f",
  Fashion_Beauty_Jewelry_and_Accessories: "#9a5f73",
  Electronics_Automotive_and_Gadgets: "#596d78",
  Home_Books_Gifts_and_Other_Retail: "#7c6a51",
  Education_and_Language: "#49756d",
  Immigration_Legal_and_Finance: "#536a8b",
  Technology_and_Software: "#3c7781",
  Marketing_Design_and_Business_Services: "#7f5e8a",
  Health_Medical_and_Wellness: "#4f8264",
  Travel_Hotels_and_Events: "#3d7890",
  Media_News_and_Publishing: "#7b6250",
  Arts_Music_and_Entertainment: "#8d4f55",
  Creators_Public_Figures_and_Personal_Brands: "#a6654c",
  Sports_and_Fitness: "#547348",
  Community_Nonprofit_and_Government: "#657548",
  Personal_and_Noncommercial: "#827b70",
  Other_Businesses_and_Services: "#6f695f",
  Unclear: "#aaa091",
};

const genericNameTokens = new Set([
  "the", "and", "co", "official", "page", "iran", "tehran",
  "کافه", "رستوران", "فروشگاه", "آموزش", "آموزشی", "آکادمی", "مرکز",
  "کلینیک", "مطب", "سالن", "مجتمع", "شرکت", "صفحه", "رسمی", "ایران",
  "تهران", "فود", "شاپ", "گروه",
]);

const payload = JSON.parse(await readFile(candidatePath, "utf8"));
await mkdir(dirname(reviewPath), { recursive: true });
let cache = {};
try {
  cache = JSON.parse(await readFile(cachePath, "utf8"));
} catch {
  // The first run starts with an empty cache.
}
const approvalPayload = JSON.parse(await readFile(approvalPath, "utf8"));
const manualApprovals = new Map();
for (const approval of approvalPayload.approvals ?? []) {
  if (manualApprovals.has(approval.username)) {
    throw new Error(`Duplicate manual approval for ${approval.username}.`);
  }
  manualApprovals.set(approval.username, approval);
}

function sleep(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function isAllowedPublicMapUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLocaleLowerCase("en");
    if (
      hostname === "maps.app.goo.gl" ||
      hostname === "maps.google.com" ||
      hostname === "waze.com" ||
      hostname === "www.waze.com" ||
      hostname === "ul.waze.com" ||
      hostname === "balad.ir" ||
      hostname === "www.balad.ir" ||
      hostname === "maps.apple.com"
    ) {
      return true;
    }
    return (
      (hostname === "google.com" || hostname === "www.google.com") &&
      url.pathname.startsWith("/maps")
    ) || (
      (hostname === "neshan.org" || hostname === "www.neshan.org") &&
      url.pathname.startsWith("/maps")
    );
  } catch {
    return false;
  }
}

function directCoordinates(url) {
  if (!url) return null;
  const patterns = [
    // Prefer provider-specific POI coordinates over a Google viewport center.
    { pattern: /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/i, order: "lat-lng" },
    { pattern: /[?&](?:q|query|ll)=(-?\d{1,2}\.\d+)[,%2C]+(-?\d{1,3}\.\d+)/i, order: "lat-lng" },
    { pattern: /[?&]to=ll\.(-?\d{1,2}\.\d+)[,%2C]+(-?\d{1,3}\.\d+)/i, order: "lat-lng" },
    { pattern: /[?&]latitude=(-?\d{1,2}\.\d+).*?[?&]longitude=(-?\d{1,3}\.\d+)/i, order: "lat-lng" },
    { pattern: /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/, order: "lat-lng" },
  ];
  for (const { pattern } of patterns) {
    const match = decodeURIComponent(url).match(pattern);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (lat >= 24 && lat <= 40 && lng >= 43 && lng <= 64) return [lng, lat];
  }
  return null;
}

async function resolvePublicMapLink(url) {
  if (!isAllowedPublicMapUrl(url)) return null;
  const direct = directCoordinates(url);
  if (direct) return direct;
  if (!url) return null;

  const cacheKey = `map-link-v4|${url}`;
  if (cache[cacheKey]) return cache[cacheKey].coordinates ?? null;

  let coordinates = null;
  let finalUrl = url;
  try {
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      if (!isAllowedPublicMapUrl(finalUrl)) {
        throw new Error("Map link redirected outside the provider allowlist.");
      }
      const response = await fetch(finalUrl, {
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(25_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        finalUrl = new URL(location, finalUrl).toString();
        continue;
      }
      if (!response.ok) {
        throw new Error(`Map link returned HTTP ${response.status}.`);
      }
      coordinates = directCoordinates(finalUrl);
      break;
    }
  } catch {
    // Search can still locate the profile when a supplied short link expires.
  }

  if (coordinates) {
    cache[cacheKey] = { coordinates, finalUrl };
    await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  }
  await sleep(250);
  return coordinates;
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670\u200c\u200d]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function manuallyApprovedMatch(candidate, ranked) {
  const approval = manualApprovals.get(candidate.username);
  if (!approval) return null;
  const expectedCoordinates = approval.coordinates?.map(Number);
  if (
    !Array.isArray(expectedCoordinates) ||
    expectedCoordinates.length !== 2 ||
    expectedCoordinates.some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(`Invalid manual approval coordinates for ${candidate.username}.`);
  }

  const match = ranked.find(({ item }) => {
    const coordinates = [Number(item.location?.x), Number(item.location?.y)];
    return (
      normalize(item.title) === normalize(approval.title) &&
      normalize(item.subtitle) === normalize(approval.address) &&
      Math.abs(coordinates[0] - expectedCoordinates[0]) < 1e-7 &&
      Math.abs(coordinates[1] - expectedCoordinates[1]) < 1e-7
    );
  });
  return match ? { approval, ...match } : null;
}

function searchTermFor(candidate) {
  return String(candidate.fullName || candidate.username)
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[|/•]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function tokenSet(value, { removeGeneric = false } = {}) {
  const values = normalize(value)
    .split(" ")
    .filter((token) => token.length >= 2);
  return new Set(
    removeGeneric
      ? values.filter((token) => !genericNameTokens.has(token))
      : values,
  );
}

function intersectionSize(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function setMatchScore(expected, actual) {
  if (expected.size === 0 || actual.size === 0) return 0;
  const matches = intersectionSize(expected, actual);
  const containment = matches / expected.size;
  const dice = (2 * matches) / (expected.size + actual.size);
  return Math.max(containment, dice);
}

function categoryMatch(candidate, item) {
  const resultType = normalize(`${item.type ?? ""} ${item.typeTitle ?? ""}`);
  const patterns = {
    Restaurants: /restaurant|fast food|food court|رستوران|فست فود|غذا/,
    Cafes_and_Coffee_Shops: /cafe|coffee|کافه|قهوه/,
    Bakeries_Desserts_and_Sweets: /bakery|pastry|sweet|ice cream|نانوایی|شیرینی|بستنی/,
    Health_Medical_and_Wellness: /hospital|clinic|doctor|pharmacy|درمانگاه|بیمارستان|پزشک|داروخانه/,
    Sports_and_Fitness: /gym|sport|ورزش|باشگاه/,
    Travel_Hotels_and_Events: /hotel|lodging|هتل|اقامتگاه/,
    Education_and_Language: /school|education|university|آموزش|مدرسه|دانشگاه/,
  };
  const pattern = patterns[candidate.primaryCategory];
  return pattern?.test(resultType) ? 1 : 0;
}

function scoreMatch(candidate, item) {
  const expectedName = tokenSet(
    `${candidate.fullName} ${candidate.username.replace(/[._-]+/g, " ")}`,
    { removeGeneric: true },
  );
  const actualTitle = tokenSet(item.title, { removeGeneric: true });
  let nameScore = setMatchScore(expectedName, actualTitle);

  const normalizedExpectedName = normalize(candidate.fullName);
  const normalizedTitle = normalize(item.title);
  const exactPhrase =
    normalizedExpectedName.length >= 4 &&
    normalizedTitle.length >= 4 &&
    (normalizedExpectedName.includes(normalizedTitle) ||
      normalizedTitle.includes(normalizedExpectedName));
  if (exactPhrase) nameScore = Math.max(nameScore, 0.98);

  const expectedLocation = tokenSet(
    [
      ...(candidate.evidence.publicAddressLines ?? []),
      ...(candidate.evidence.postLocations ?? []).map((location) => location.name),
    ].join(" "),
  );
  const actualLocation = tokenSet(item.subtitle);
  const locationScore = setMatchScore(expectedLocation, actualLocation);
  const typeScore = categoryMatch(candidate, item);
  const candidatePhones = phoneNumbers(candidate.biography);
  const resultPhones = new Set(item.phones ?? []);
  const phoneMatch = [...candidatePhones].some((phone) => resultPhones.has(phone));
  const candidateCity = candidate.cityHint?.toLocaleLowerCase("en") ?? null;
  const resultCity = inferCity(item.subtitle);
  const cityConflict =
    Boolean(candidateCity && resultCity) && candidateCity !== resultCity;
  const total =
    (nameScore * 0.76) +
    (locationScore * 0.19) +
    (typeScore * 0.05) +
    (phoneMatch ? 0.12 : 0);

  return {
    total: Math.min(total, 1),
    nameScore,
    locationScore,
    typeScore,
    exactPhrase,
    phoneMatch,
    cityConflict,
    hasDistinctiveName: expectedName.size > 0,
  };
}

function toLatinDigits(value) {
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return String(value ?? "").replace(/[۰-۹٠-٩]/g, (digit) => {
    const persianIndex = persianDigits.indexOf(digit);
    return String(persianIndex >= 0 ? persianIndex : arabicDigits.indexOf(digit));
  });
}

function phoneNumbers(value) {
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

function inferCity(value) {
  const normalized = normalize(value);
  const cities = [
    ["tehran", /(?:^|\s)(?:تهران|tehran)(?:$|\s)/],
    ["karaj", /(?:^|\s)(?:کرج|karaj)(?:$|\s)/],
    ["qom", /(?:^|\s)(?:قم|qom)(?:$|\s)/],
    ["mashhad", /(?:^|\s)(?:مشهد|mashhad)(?:$|\s)/],
    ["isfahan", /(?:^|\s)(?:اصفهان|isfahan)(?:$|\s)/],
    ["shiraz", /(?:^|\s)(?:شیراز|shiraz)(?:$|\s)/],
    ["rasht", /(?:^|\s)(?:رشت|rasht)(?:$|\s)/],
    ["tabriz", /(?:^|\s)(?:تبریز|tabriz)(?:$|\s)/],
    ["ahvaz", /(?:^|\s)(?:اهواز|ahvaz)(?:$|\s)/],
    ["kish", /(?:^|\s)(?:کیش|kish)(?:$|\s)/],
  ];
  return cities.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

function decodePwaResponse(raw) {
  const trimmed = raw.trim();
  let decoded;
  try {
    decoded = JSON.parse(trimmed);
  } catch {
    // Current PWA responses use two rotated base64 chunks plus a signature.
    const envelope = trimmed.match(
      /^([A-Za-z0-9+/]{28})([A-Za-z0-9+/=]+)@(\d+)([A-Za-z0-9+/]{28})$/,
    );
    if (!envelope) {
      throw new Error("Neshan PWA response envelope changed; refusing to guess.");
    }
    const encodedPayload = envelope[2];
    const splitIndex = Number(envelope[3]);
    if (
      !Number.isInteger(splitIndex) ||
      splitIndex < 0 ||
      splitIndex > encodedPayload.length
    ) {
      throw new Error("Neshan PWA response contained an invalid split index.");
    }
    const restoredPayload =
      encodedPayload.slice(splitIndex) + encodedPayload.slice(0, splitIndex);
    decoded = JSON.parse(
      Buffer.from(restoredPayload, "base64").toString("utf8"),
    );
  }
  if (!decoded || !Array.isArray(decoded.items)) {
    throw new Error("Neshan PWA response did not contain a result list.");
  }
  return decoded;
}

function encodeSearchBody(term) {
  const body = { ...searchTemplate, term };
  return Buffer.from(encodeURIComponent(JSON.stringify(body))).toString("base64");
}

function compactSearchResult(result) {
  return {
    items: (result.items ?? [])
      .filter((item) => item?.location && item.isAd !== true)
      .map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        category: item.category,
        type: item.type,
        typeTitle: item.typeTitle,
        location: item.location,
        crowdId: item.crowdId,
        publishStatus: item.publishStatus,
        showOnMap: item.showOnMap,
        phones: (item.actions ?? [])
          .filter((action) => action.type === "CALL")
          .flatMap((action) => {
            try {
              return [...phoneNumbers(JSON.parse(action.metaData).phone)];
            } catch {
              return [];
            }
          }),
      })),
  };
}

async function searchNeshanPwa(term, attempt = 0) {
  const params = new URLSearchParams({
    body: encodeSearchBody(term),
    "search-in-bound": "false",
  });
  const response = await fetch(`${pwaSearchEndpoint}?${params}`, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Referer: "https://neshan.org/maps/",
      uuid: pwaUuid,
      "X-Client-Version": pwaClientVersion,
    },
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await sleep(1_500 * (attempt + 1));
      return searchNeshanPwa(term, attempt + 1);
    }
    throw new Error(`Neshan PWA search failed with HTTP ${response.status}.`);
  }
  return compactSearchResult(decodePwaResponse(await response.text()));
}

function isCertainMatch(candidate, best, runnerUp) {
  if (!best) return false;
  const margin = best.score.total - (runnerUp?.score.total ?? 0);
  if (!best.score.hasDistinctiveName || best.score.cityConflict) return false;
  if (best.score.phoneMatch) {
    return best.score.nameScore >= 0.55;
  }
  if (margin < 0.15) return false;
  if (candidate.evidenceStrength === "repeated-post-location") {
    return (
      best.score.nameScore >= 0.95 &&
      best.score.locationScore >= 0.70
    );
  }
  return (
    (best.score.nameScore >= 0.85 &&
      best.score.locationScore >= 0.60) ||
    (best.score.exactPhrase &&
      best.score.nameScore >= 0.90 &&
      best.score.locationScore >= 0.30)
  );
}

if (process.env.NESHAN_PWA_TEST_TERM) {
  const testResult = await searchNeshanPwa(process.env.NESHAN_PWA_TEST_TERM);
  console.log(
    JSON.stringify({
      ok: true,
      resultCount: testResult.items.length,
      results: testResult.items.slice(0, 10),
    }, null, 2),
  );
  process.exit(0);
}

const accepted = [];
const review = [];
let consecutiveSearchErrors = 0;
let fatalSearchError = null;

for (let index = 0; index < payload.candidates.length; index += 1) {
  const candidate = payload.candidates[index];
  if (candidate.privacyEligible !== true) continue;

  const direct = await resolvePublicMapLink(candidate.evidence.mapLink);
  if (direct) {
    consecutiveSearchErrors = 0;
    accepted.push({
      candidate,
      coordinates: direct,
      title: candidate.fullName,
      address: candidate.evidence.publicAddressLines.join("، "),
      confidence: 1,
      method: "direct-map-link",
      matchDetails: { directCoordinateLink: true },
    });
    continue;
  }

  const searchTerm = searchTermFor(candidate);
  const cacheKey = `pwa-v2|${searchTerm}`;
  let result = cache[cacheKey];
  if (result && !Array.isArray(result.items)) result = null;
  if (!result) {
    try {
      result = await searchNeshanPwa(searchTerm);
      cache[cacheKey] = result;
      await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    } catch (error) {
      consecutiveSearchErrors += 1;
      const message = error instanceof Error ? error.message : String(error);
      review.push({
        ...candidate,
        reviewReason: "geocoding-error",
        error: message,
      });
      if (consecutiveSearchErrors >= 3) {
        fatalSearchError = new Error(
          `Stopped after three consecutive PWA search failures. Last error: ${message}`,
        );
        break;
      }
      continue;
    }
    await sleep(requestDelayMs);
  }
  consecutiveSearchErrors = 0;

  const ranked = (result.items ?? [])
    .filter(
      (item) =>
        item.category === "place" &&
        item.id?.startsWith("poi_") &&
        item.publishStatus !== "UNPUBLISHED" &&
        item.showOnMap !== false &&
        Number.isFinite(Number(item.location?.x)) &&
        Number.isFinite(Number(item.location?.y)),
    )
    .map((item) => ({ item, score: scoreMatch(candidate, item) }))
    .sort((left, right) => right.score.total - left.score.total);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const manualMatch = manuallyApprovedMatch(candidate, ranked);
  const coordinates = best
    ? [Number(best.item.location.x), Number(best.item.location.y)]
    : null;
  const inIran =
    coordinates &&
    coordinates[1] >= 24 &&
    coordinates[1] <= 40 &&
    coordinates[0] >= 43 &&
    coordinates[0] <= 64;

  if (manualMatch) {
    accepted.push({
      candidate,
      coordinates: manualMatch.approval.coordinates,
      title: manualMatch.item.title,
      address:
        manualMatch.item.subtitle ||
        candidate.evidence.publicAddressLines.join("، "),
      confidence: Number(manualMatch.score.total.toFixed(3)),
      method: "manual-review",
      matchDetails: {
        reviewed: true,
        reason: manualMatch.approval.reason,
        nameScore: Number(manualMatch.score.nameScore.toFixed(3)),
        locationScore: Number(manualMatch.score.locationScore.toFixed(3)),
        crowdId: manualMatch.item.crowdId ?? null,
      },
    });
  } else if (
    !manualApprovals.has(candidate.username) &&
    inIran &&
    isCertainMatch(candidate, best, runnerUp)
  ) {
    accepted.push({
      candidate,
      coordinates,
      title: best.item.title,
      address:
        best.item.subtitle ||
        candidate.evidence.publicAddressLines.join("، "),
      confidence: Number(best.score.total.toFixed(3)),
      method: "neshan-pwa-search",
      matchDetails: {
        nameScore: Number(best.score.nameScore.toFixed(3)),
        locationScore: Number(best.score.locationScore.toFixed(3)),
        phoneMatch: best.score.phoneMatch,
        margin: Number(
          (best.score.total - (runnerUp?.score.total ?? 0)).toFixed(3),
        ),
        crowdId: best.item.crowdId ?? null,
      },
    });
  } else {
    review.push({
      ...candidate,
      reviewReason: manualApprovals.has(candidate.username)
        ? "manual-approval-no-longer-matches"
        : best
          ? "needs-human-review"
          : "no-search-results",
      proposedMatches: ranked.slice(0, 3).map(({ item, score }) => ({
        title: item.title,
        address: item.subtitle,
        coordinates: [Number(item.location.x), Number(item.location.y)],
        confidence: Number(score.total.toFixed(3)),
        nameScore: Number(score.nameScore.toFixed(3)),
        locationScore: Number(score.locationScore.toFixed(3)),
        phoneMatch: score.phoneMatch,
        cityConflict: score.cityConflict,
      })),
    });
  }

  if ((index + 1) % 10 === 0 || index + 1 === payload.candidates.length) {
    console.log(
      `Processed ${index + 1}/${payload.candidates.length} — ${accepted.length} accepted, ${review.length} queued`,
    );
  }
}

if (fatalSearchError) {
  await writeFile(
    reviewPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      fatalError: fatalSearchError.message,
      instructions:
        "Production locations.geojson was not changed because the PWA endpoint failed repeatedly.",
      count: review.length,
      profiles: review,
    }, null, 2)}\n`,
  );
  throw fatalSearchError;
}

const geojson = {
  type: "FeatureCollection",
  metadata: {
    generatedAt: new Date().toISOString(),
    sourceCandidateCount: payload.candidates.length,
    acceptedCount: accepted.length,
    manualReviewCount: accepted.filter((item) => item.method === "manual-review").length,
    reviewCount: review.length,
    provider: "Neshan public PWA search",
    policy: payload.policy,
  },
  features: accepted.map(
    ({
      candidate,
      coordinates,
      address,
      confidence,
      method,
      matchDetails,
    }) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: {
        username: candidate.username,
        fullName: candidate.fullName,
        biography: candidate.biography,
        address,
        categories: candidate.categories,
        primaryCategory: candidate.primaryCategory,
        color: colorByCategory[candidate.primaryCategory] ?? "#6f695f",
        instagramUrl: candidate.instagramUrl,
        evidenceStrength: candidate.evidenceStrength,
        geocodeConfidence: confidence,
        geocodeMethod: method,
        matchDetails,
      },
    }),
  ),
};

await writeFile(geojsonPath, `${JSON.stringify(geojson, null, 2)}\n`);
await writeFile(
  reviewPath,
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    instructions:
      "Review proposed matches before moving them into locations.geojson. Never approve residential or inferred personal locations.",
    count: review.length,
    profiles: review,
  }, null, 2)}\n`,
);

console.log(`Accepted ${accepted.length} locations; ${review.length} require review.`);
