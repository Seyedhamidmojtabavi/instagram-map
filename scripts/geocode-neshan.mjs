import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const candidatePath = join(appRoot, "data", "location-candidates.json");
const geojsonPath = join(appRoot, "public", "locations.geojson");
const reviewPath = join(appRoot, "data", "location-review.json");
const cachePath = join(appRoot, "data", ".geocode-cache.json");
const serviceKey = process.env.NESHAN_SERVICE_KEY;

if (!serviceKey) {
  console.error("Missing NESHAN_SERVICE_KEY. Add it to your shell environment before running this command.");
  process.exit(1);
}

const cityCenters = {
  Tehran: [35.6892, 51.389],
  Karaj: [35.8400, 50.9391],
  Qom: [34.6416, 50.8746],
  Mashhad: [36.2605, 59.6168],
  Isfahan: [32.6546, 51.6680],
  Shiraz: [29.5918, 52.5837],
  Rasht: [37.2808, 49.5832],
  Tabriz: [38.0800, 46.2919],
  Ahvaz: [31.3183, 48.6706],
  Kish: [26.5325, 53.9868],
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

const payload = JSON.parse(await readFile(candidatePath, "utf8"));
await mkdir(dirname(reviewPath), { recursive: true });
let cache = {};
try {
  cache = JSON.parse(await readFile(cachePath, "utf8"));
} catch {
  // The first run starts with an empty cache.
}

function directCoordinates(url) {
  if (!url) return null;
  const patterns = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll)=(-?\d{1,2}\.\d+)[,%2C]+(-?\d{1,3}\.\d+)/i,
    /(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
  ];
  for (const pattern of patterns) {
    const match = decodeURIComponent(url).match(pattern);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (lat >= 24 && lat <= 40 && lng >= 43 && lng <= 64) return [lng, lat];
  }
  return null;
}

function tokens(value) {
  return new Set(
    String(value ?? "")
      .toLocaleLowerCase("en")
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]{2,}/gu) ?? [],
  );
}

function overlapScore(candidate, result) {
  const expected = tokens(`${candidate.fullName} ${candidate.candidateTerm}`);
  const actual = tokens(`${result.title ?? ""} ${result.address ?? ""} ${result.region ?? ""}`);
  if (expected.size === 0) return 0;
  let matches = 0;
  for (const token of expected) if (actual.has(token)) matches += 1;
  const nameScore = Math.min(matches / Math.min(expected.size, 8), 1);
  const evidenceBonus =
    candidate.evidenceStrength === "public-address" ? 0.22 :
    candidate.evidenceStrength === "repeated-post-location" ? 0.12 : 0;
  return Math.min(nameScore + evidenceBonus, 1);
}

async function searchNeshan(candidate) {
  const center = cityCenters[candidate.cityHint] ?? cityCenters.Tehran;
  const params = new URLSearchParams({
    term: candidate.candidateTerm,
    lat: String(center[0]),
    lng: String(center[1]),
  });
  const response = await fetch(`https://api.neshan.org/v1/search?${params}`, {
    headers: { "Api-Key": serviceKey },
  });
  if (!response.ok) {
    throw new Error(`Neshan search failed (${response.status}) for @${candidate.username}`);
  }
  return response.json();
}

const accepted = [];
const review = [];

for (let index = 0; index < payload.candidates.length; index += 1) {
  const candidate = payload.candidates[index];
  if (candidate.privacyEligible !== true) continue;

  const direct = directCoordinates(candidate.evidence.mapLink);
  if (direct) {
    accepted.push({
      candidate,
      coordinates: direct,
      title: candidate.fullName,
      address: candidate.evidence.publicAddressLines.join("، "),
      confidence: 1,
      method: "direct-map-link",
    });
    continue;
  }

  const cacheKey = `${candidate.candidateTerm}|${candidate.cityHint ?? "Tehran"}`;
  let result = cache[cacheKey];
  if (!result) {
    try {
      result = await searchNeshan(candidate);
      cache[cacheKey] = result;
      await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    } catch (error) {
      review.push({ ...candidate, reviewReason: "geocoding-error", error: error.message });
      continue;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
  }

  const ranked = (result.items ?? [])
    .map((item) => ({ item, score: overlapScore(candidate, item) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const coordinates = best?.item?.location
    ? [Number(best.item.location.x), Number(best.item.location.y)]
    : null;
  const threshold =
    candidate.evidenceStrength === "public-address" ? 0.62 :
    candidate.evidenceStrength === "repeated-post-location" ? 0.72 : 1;

  if (
    coordinates &&
    coordinates.every(Number.isFinite) &&
    best.score >= threshold
  ) {
    accepted.push({
      candidate,
      coordinates,
      title: best.item.title,
      address: best.item.address || candidate.evidence.publicAddressLines.join("، "),
      confidence: Number(best.score.toFixed(3)),
      method: "neshan-search",
    });
  } else {
    review.push({
      ...candidate,
      reviewReason: best ? "needs-human-review" : "no-search-results",
      proposedMatch: best
        ? {
            title: best.item.title,
            address: best.item.address,
            coordinates,
            confidence: Number(best.score.toFixed(3)),
          }
        : null,
    });
  }

  if ((index + 1) % 25 === 0) {
    console.log(`Processed ${index + 1}/${payload.candidates.length}`);
  }
}

const geojson = {
  type: "FeatureCollection",
  metadata: {
    generatedAt: new Date().toISOString(),
    sourceCandidateCount: payload.candidates.length,
    acceptedCount: accepted.length,
    reviewCount: review.length,
    policy: payload.policy,
  },
  features: accepted.map(({ candidate, coordinates, address, confidence, method }) => ({
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
    },
  })),
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
