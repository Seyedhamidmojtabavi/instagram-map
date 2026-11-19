import { createHash } from "node:crypto";
import taxonomy from "../lib/categories.json" with { type: "json" };

const categoryById = new Map(taxonomy.categories.map((category) => [category.id, category]));

// Accounts in these categories are people or editorial voices. They are never
// pinned from incidental post tags and need explicit public-place evidence.
const editorialCategories = new Set([
  "Creators_Public_Figures_and_Personal_Brands",
  "Arts_Music_and_Entertainment",
  "Media_News_and_Publishing",
  "Personal_and_Noncommercial",
  "Unclear",
]);

const primaryCategoryPriority = [
  "Restaurants",
  "Cafes_and_Coffee_Shops",
  "Bakeries_Desserts_and_Sweets",
  "Food_Products_Catering_and_Grocery",
  "Fashion_Beauty_Jewelry_and_Accessories",
  "Electronics_Automotive_and_Gadgets",
  "Home_Books_Gifts_and_Other_Retail",
  "Education_and_Language",
  "Immigration_Legal_and_Finance",
  "Health_Medical_and_Wellness",
  "Travel_Hotels_and_Events",
  "Sports_and_Fitness",
  "Community_Nonprofit_and_Government",
  "Marketing_Design_and_Business_Services",
  "Other_Businesses_and_Services",
  "Technology_and_Software",
  "Media_News_and_Publishing",
  "Arts_Music_and_Entertainment",
  "Creators_Public_Figures_and_Personal_Brands",
  "Personal_and_Noncommercial",
  "Unclear",
];

export function primaryCategoryOf(categories) {
  return primaryCategoryPriority.find((id) => categories.includes(id)) ?? categories[0] ?? "Unclear";
}

const explicitAddressPattern =
  /(?<![\p{L}\p{N}])(?:آدرس|نشانی|address|شعبه|دفتر|خیابان|بلوار|میدان|کوچه|پلاک|طبقه|اتوبان|بزرگراه|چهارراه|نبش|مجتمع|پاساژ)(?![\p{L}\p{N}])/iu;
const locationMarkerPattern = /(?:📍|location|لوکیشن|آدرس|نشانی|شعبه)/iu;
const iranLocationPattern =
  /(?<![\p{L}\p{N}])(?:تهران|tehran|کرج|karaj|قم|qom|مشهد|mashhad|اصفهان|isfahan|شیراز|shiraz|رشت|rasht|تبریز|tabriz|اهواز|ahvaz|کیش|kish|قشم|qeshm|بوشهر|bushehr|ارومیه|urmia|یزد|yazd|کرمان|kerman|ساری|sari|گرگان|gorgan|همدان|hamedan|قزوین|qazvin|زنجان|zanjan|اراک|arak|سنندج|sanandaj|کرمانشاه|kermanshah|بندر\s*عباس|bandar\s*abbas|مازندران|گیلان|خراسان|فارس|البرز)(?![\p{L}\p{N}])/iu;
const personalContextPattern =
  /(?:دانشگاه|متولد|اهل\s|ساکن|خانواده|علاقه|دانش‌آموخته|دانش آموخته)/iu;
const inactivePattern =
  /(?:در حال جابه[‌ ]?جایی|در حال جابجایی|تعطیل|temporarily closed|permanently closed|we are moving|moving soon)/iu;

const cityNames = [
  ["tehran", ["تهران", "tehran"]],
  ["karaj", ["کرج", "karaj"]],
  ["qom", ["قم", "qom"]],
  ["mashhad", ["مشهد", "mashhad"]],
  ["isfahan", ["اصفهان", "isfahan", "esfahan"]],
  ["shiraz", ["شیراز", "shiraz"]],
  ["rasht", ["رشت", "rasht"]],
  ["tabriz", ["تبریز", "tabriz"]],
  ["ahvaz", ["اهواز", "ahvaz"]],
  ["kish", ["کیش", "kish"]],
];

export const cityCenters = {
  tehran: [51.389, 35.6892],
  karaj: [50.9915, 35.8327],
  qom: [50.8764, 34.6401],
  mashhad: [59.6168, 36.2605],
  isfahan: [51.6776, 32.6546],
  shiraz: [52.5311, 29.5918],
  rasht: [49.5832, 37.2808],
  tabriz: [46.2919, 38.0962],
  ahvaz: [48.6706, 31.3183],
  kish: [53.98, 26.5317],
};

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/[ً-ٰٟ‌‍]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function inferCity(text) {
  const normalized = ` ${normalizeText(text)} `;
  for (const [city, tokens] of cityNames) {
    if (tokens.some((token) => normalized.includes(` ${token} `))) return city;
  }
  return null;
}

const mapHosts = new Set([
  "maps.app.goo.gl",
  "maps.google.com",
  "goo.gl",
  "waze.com",
  "www.waze.com",
  "ul.waze.com",
  "balad.ir",
  "www.balad.ir",
  "maps.apple.com",
  "nshn.ir",
]);

export function isAllowedPublicMapUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLocaleLowerCase("en");
    if (hostname === "goo.gl") return url.pathname.startsWith("/maps");
    if (mapHosts.has(hostname)) return true;
    return (
      ((hostname === "google.com" || hostname === "www.google.com") && url.pathname.startsWith("/maps")) ||
      ((hostname === "neshan.org" || hostname === "www.neshan.org") && url.pathname.startsWith("/maps"))
    );
  } catch {
    return false;
  }
}

/** Pulls lat/lng from a map URL. Returns [lng, lat] or null. */
export function coordinatesFromMapUrl(url) {
  if (!url) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }
  const patterns = [
    // Prefer the POI coordinate over a Google viewport centre.
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/i,
    /[?&](?:q|query|ll|destination|daddr)=(-?\d{1,2}\.\d+)\s*[,]\s*(-?\d{1,3}\.\d+)/i,
    /[?&]to=ll\.(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/i,
    /[?&]latitude=(-?\d{1,2}\.\d+).*?[?&]longitude=(-?\d{1,3}\.\d+)/i,
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /\/maps\/@?(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (isPlausibleCoordinate([lng, lat])) return [lng, lat];
  }
  return null;
}

export function isPlausibleCoordinate(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;
  const [lng, lat] = coordinates.map(Number);
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 85 && Math.abs(lng) <= 180 &&
    !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01)
  );
}

export function isInIran([lng, lat]) {
  return lat >= 24 && lat <= 40 && lng >= 43 && lng <= 64;
}

function urlsInText(text) {
  return String(text ?? "").match(/https?:\/\/[^\s<>"'،]+/giu) ?? [];
}

export function bioLocationLines(biography) {
  return String(biography ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 3) return false;
      if (explicitAddressPattern.test(line)) return true;
      if (!iranLocationPattern.test(line)) return false;
      const looksFormattedAsLocation = locationMarkerPattern.test(line) || line.length <= 42;
      return looksFormattedAsLocation && !personalContextPattern.test(line);
    })
    .slice(0, 4);
}

/** Groups post location tags that point at the same venue (within ~120 m). */
export function clusterPostLocations(postLocations = []) {
  const clusters = [];
  for (const location of postLocations) {
    const coordinates = [Number(location.lng), Number(location.lat)];
    const hasCoordinates = isPlausibleCoordinate(coordinates);
    const key = normalizeText(location.name);
    const cluster = clusters.find((item) =>
      item.key === key ||
      (hasCoordinates && item.coordinates && distanceMeters(item.coordinates, coordinates) < 120),
    );
    if (cluster) {
      cluster.count += 1;
    } else {
      clusters.push({
        key,
        name: location.name,
        address: location.address ?? "",
        city: location.city ?? "",
        coordinates: hasCoordinates ? coordinates : null,
        count: 1,
      });
    }
  }
  return clusters.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function distanceMeters([lng1, lat1], [lng2, lat2]) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * City-wide tags ("Tehran, Iran", "Walnut Creek, California") say nothing
 * about where a venue is. Instagram gives venues a street address; cities and
 * regions come back as "Place, Region" with no address.
 */
export function isCityLevelTag(cluster) {
  if (!String(cluster.address ?? "").trim() && /^[^,،]{2,40}[,،]\s*[^,،]{2,40}(?:[,،]\s*[^,،]{2,40})?$/u.test(String(cluster.name).trim())) {
    return true;
  }
  const name = normalizeText(cluster.name);
  const words = name.split(" ").filter(Boolean);
  if (words.length > 3) return false;
  const cityWords = new Set(["iran", "ایران", "province", "استان", ...cityNames.flatMap(([, tokens]) => tokens)]);
  return words.every((word) => cityWords.has(word));
}

/** Rounds a coordinate so pins on the same spot compare equal. */
export function pinKey([lng, lat]) {
  return `${Number(lng).toFixed(4)},${Number(lat).toFixed(4)}`;
}

// Generic points Instagram's geocoder returns for "Tehran" instead of a street.
const knownCentroids = [
  [51.4231, 35.6961],
  [51.41503, 35.68877],
  [51.389, 35.6892],
];

/**
 * Instagram geocodes business addresses itself and does it badly in Iran: many
 * Tehran businesses share one city-centre point, and some land on another
 * continent. Returns why a business pin cannot be trusted, or null.
 */
export function businessPinProblem(pin, { addressText = "", sharedPins = new Set() } = {}) {
  if (sharedPins.has(pinKey(pin))) return "shared-by-other-accounts";
  if (knownCentroids.some((centroid) => distanceMeters(centroid, pin) < 300)) return "city-centroid";
  if (Object.values(cityCenters).some((center) => distanceMeters(center, pin) < 150)) return "city-centroid";
  const city = inferCity(addressText);
  if (city && distanceMeters(cityCenters[city], pin) > 60_000) return "outside-named-city";
  if (/(?:^|[^\p{L}])(?:iran|ایران)(?:$|[^\p{L}])/iu.test(addressText) && !isInIran(pin)) return "outside-iran";
  return null;
}

/**
 * Everything the geocoder needs about one profile, plus the privacy decision.
 * `eligible` is false for people, closed businesses, and accounts without
 * public-place evidence. Those accounts are never pinned.
 */
export function buildEvidence(profile, categories, { sharedPins = new Set() } = {}) {
  const categorySet = new Set(categories);
  const urls = [...(profile.externalUrls ?? []), ...urlsInText(profile.biography)];
  const mapLink = urls.find(isAllowedPublicMapUrl) ?? null;
  const addressLines = bioLocationLines(profile.biography);
  const business = profile.business ?? {};
  const businessCoordinates = [Number(business.lng), Number(business.lat)];
  const hasBusinessAddress = Boolean(business.street);
  const rawBusinessPin =
    hasBusinessAddress && isPlausibleCoordinate(businessCoordinates) ? businessCoordinates : null;
  const businessPinRejected = rawBusinessPin
    ? businessPinProblem(rawBusinessPin, {
        addressText: `${business.street} ${business.city} ${profile.biography ?? ""}`,
        sharedPins,
      })
    : null;
  const businessPin = businessPinRejected ? null : rawBusinessPin;
  const tags = clusterPostLocations(profile.postLocations ?? []).filter((cluster) => !isCityLevelTag(cluster));

  const hasPublicPlaceCategory = categories.some((id) => categoryById.get(id)?.publicPlace);
  const isEditorial = categories.some((id) => editorialCategories.has(id));
  const allowsRepeatedTags = categories.some((id) => categoryById.get(id)?.repeatedLocation);
  const declaresBusiness = Boolean(profile.isBusiness || profile.isProfessional || profile.category);
  const inactive = inactivePattern.test(profile.biography ?? "");
  const explicitEvidence = Boolean(
    mapLink || businessPin || hasBusinessAddress ||
    addressLines.some((line) => explicitAddressPattern.test(line) || locationMarkerPattern.test(line)),
  );
  const repeatedTag = tags.find((tag) => tag.count >= 2 && tag.coordinates);

  const eligible =
    !profile.isPrivate &&
    !inactive &&
    !categorySet.has("Personal_and_Noncommercial") &&
    hasPublicPlaceCategory &&
    (!isEditorial || (explicitEvidence && declaresBusiness)) &&
    (explicitEvidence || addressLines.length > 0 ||
      Boolean(repeatedTag && allowsRepeatedTags && !isEditorial && declaresBusiness));
  let reason = "public-place";
  if (profile.isPrivate) reason = "private-account";
  else if (inactive) reason = "closed-or-moving";
  else if (categorySet.has("Personal_and_Noncommercial")) reason = "personal-account";
  else if (!hasPublicPlaceCategory) reason = "not-a-place-category";
  else if (!eligible) reason = "no-public-place-evidence";

  const locationText = [business.street, business.city, ...addressLines].filter(Boolean).join("، ");
  const cityHint = inferCity(
    [business.city, profile.biography, ...tags.map((tag) => `${tag.name} ${tag.city}`)].join(" "),
  );

  const evidence = {
    eligible,
    reason,
    mapLink,
    businessPin,
    businessPinRejected,
    businessAddress: [business.street, business.city].filter(Boolean).join("، "),
    phone: business.phone ?? "",
    addressLines,
    tags: tags.slice(0, 6),
    allowsRepeatedTags: allowsRepeatedTags && !isEditorial && declaresBusiness,
    locationText,
    cityHint,
  };
  evidence.fingerprint = fingerprint({
    fullName: profile.fullName,
    biography: profile.biography,
    mapLink,
    businessPin,
    businessAddress: evidence.businessAddress,
    tags: evidence.tags.map((tag) => [tag.key, tag.count]),
    categories: [...categories].sort(),
  });
  return evidence;
}

export function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
