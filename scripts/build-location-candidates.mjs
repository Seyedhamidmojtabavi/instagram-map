import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const classifiedDir = resolve(appRoot, "..", "Classified");
const outputPath = join(appRoot, "data", "location-candidates.json");

const personalOrEditorialCategories = new Set([
  "Creators_Public_Figures_and_Personal_Brands",
  "Arts_Music_and_Entertainment",
  "Media_News_and_Publishing",
  "Personal_and_Noncommercial",
  "Unclear",
]);

const publicPlaceCategories = new Set([
  "Restaurants",
  "Cafes_and_Coffee_Shops",
  "Bakeries_Desserts_and_Sweets",
  "Food_Products_Catering_and_Grocery",
  "Fashion_Beauty_Jewelry_and_Accessories",
  "Electronics_Automotive_and_Gadgets",
  "Home_Books_Gifts_and_Other_Retail",
  "Education_and_Language",
  "Immigration_Legal_and_Finance",
  "Marketing_Design_and_Business_Services",
  "Health_Medical_and_Wellness",
  "Travel_Hotels_and_Events",
  "Sports_and_Fitness",
  "Community_Nonprofit_and_Government",
  "Other_Businesses_and_Services",
]);

const repeatedLocationCategories = new Set([
  "Restaurants",
  "Cafes_and_Coffee_Shops",
  "Bakeries_Desserts_and_Sweets",
  "Food_Products_Catering_and_Grocery",
  "Fashion_Beauty_Jewelry_and_Accessories",
  "Electronics_Automotive_and_Gadgets",
  "Home_Books_Gifts_and_Other_Retail",
  "Education_and_Language",
  "Health_Medical_and_Wellness",
  "Travel_Hotels_and_Events",
  "Sports_and_Fitness",
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

const categoryFiles = (await readdir(classifiedDir))
  .filter((name) => name.endsWith(".json"))
  .sort();

const membership = new Map();
const profiles = new Map();

const explicitAddressPattern =
  /(?<![\p{L}\p{N}])(?:آدرس|نشانی|address|شعبه|دفتر|خیابان|بلوار|میدان|کوچه|پلاک|طبقه|اتوبان|بزرگراه|چهارراه|نبش|مجتمع|پاساژ)(?![\p{L}\p{N}])/iu;
const locationMarkerPattern = /(?:📍|location|لوکیشن|آدرس|نشانی|شعبه)/iu;

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

for (const filename of categoryFiles) {
  const category = filename.replace(/\.json$/, "");
  const accounts = JSON.parse(await readFile(join(classifiedDir, filename), "utf8"));
  for (const account of accounts) {
    profiles.set(account.username, account);
    const categories = membership.get(account.username) ?? [];
    categories.push(category);
    membership.set(account.username, categories);
  }
}

function externalLinks(profile) {
  return (profile.externalUrls ?? [])
    .map((item) => (typeof item === "string" ? item : item?.url))
    .filter(Boolean);
}

function directMapLink(profile) {
  return externalLinks(profile).find(isAllowedPublicMapUrl);
}

function bioLocationLines(profile) {
  const iranLocationPattern =
    /(?<![\p{L}\p{N}])(?:تهران|tehran|کرج|karaj|قم|qom|مشهد|mashhad|اصفهان|isfahan|شیراز|shiraz|رشت|rasht|تبریز|tabriz|اهواز|ahvaz|کیش|kish|قشم|qeshm|بوشهر|bushehr|ارومیه|urmia|یزد|yazd|کرمان|kerman|ساری|sari|گرگان|gorgan|همدان|hamedan|قزوین|qazvin|زنجان|zanjan|اراک|arak|سنندج|sanandaj|کرمانشاه|kermanshah|بندر\s*عباس|bandar\s*abbas|مازندران|گیلان|خراسان|فارس|البرز)(?![\p{L}\p{N}])/iu;
  const personalContextPattern =
    /(?:دانشگاه|متولد|اهل\s|ساکن|خانواده|علاقه|دانش‌آموخته|دانش آموخته)/iu;
  return String(profile.biography ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) => {
        if (line.length < 3) return false;
        if (explicitAddressPattern.test(line)) return true;
        if (!iranLocationPattern.test(line)) return false;
        const looksFormattedAsLocation =
          locationMarkerPattern.test(line) || line.length <= 42;
        return looksFormattedAsLocation && !personalContextPattern.test(line);
      },
    )
    .slice(0, 4);
}

function isLikelyIranPostLocation(name) {
  const foreignPattern =
    /(?:toronto|vancouver|montreal|los angeles|new york|san jose|dubai|kuwait|cannes|india|usa|united states|canada|australia|germany|turkey|istanbul|london|paris|doha|qatar)/iu;
  return !foreignPattern.test(name);
}

function postLocations(profile) {
  const counts = new Map();
  for (const post of profile.latestPosts ?? []) {
    const name = String(post.locationName ?? "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function inferCity(text) {
  const cities = [
    ["تهران", "Tehran"],
    ["tehran", "Tehran"],
    ["کرج", "Karaj"],
    ["karaj", "Karaj"],
    ["قم", "Qom"],
    ["qom", "Qom"],
    ["مشهد", "Mashhad"],
    ["mashhad", "Mashhad"],
    ["اصفهان", "Isfahan"],
    ["isfahan", "Isfahan"],
    ["شیراز", "Shiraz"],
    ["shiraz", "Shiraz"],
    ["رشت", "Rasht"],
    ["rasht", "Rasht"],
    ["تبریز", "Tabriz"],
    ["tabriz", "Tabriz"],
    ["اهواز", "Ahvaz"],
    ["ahvaz", "Ahvaz"],
    ["کیش", "Kish"],
    ["kish", "Kish"],
  ];
  const normalized = text.toLocaleLowerCase("en");
  return cities.find(([token]) => normalized.includes(token))?.[1] ?? null;
}

const candidates = [];

for (const [username, profile] of profiles) {
  const categories = membership.get(username) ?? [];
  const mapLink = directMapLink(profile);
  const bioLines = bioLocationLines(profile);
  const locations = postLocations(profile);
  const repeatedLocation = locations.find(
    (item) => item.count >= 2 && isLikelyIranPostLocation(item.name),
  );
  const hasPublicPlaceCategory = categories.some((category) =>
    publicPlaceCategories.has(category),
  );
  const hasPersonalOrEditorialCategory = categories.some((category) =>
    personalOrEditorialCategories.has(category),
  );
  const allowsRepeatedLocation = categories.some((category) =>
    repeatedLocationCategories.has(category),
  );
  const appearsInactive =
    /(?:در حال جابه[‌ ]?جایی|در حال جابجایی|تعطیل|temporarily closed|permanently closed|we are moving|moving soon)/iu.test(
      profile.biography ?? "",
    );
  const hasBusinessEvidence =
    profile.isBusinessAccount === true || Boolean(profile.businessCategoryName);
  const hasExplicitPublicEvidence = Boolean(
    mapLink ||
    bioLines.some((line) =>
      explicitAddressPattern.test(line) || locationMarkerPattern.test(line),
    ),
  );

  // Personal and creator accounts are never located from incidental post tags.
  // They need explicit public-place evidence and declared business evidence.
  const hasPublicEvidence = Boolean(mapLink || bioLines.length);
  const eligible =
    !appearsInactive &&
    hasPublicPlaceCategory &&
    (!hasPersonalOrEditorialCategory ||
      (hasExplicitPublicEvidence && hasBusinessEvidence)) &&
    (hasPublicEvidence ||
      (repeatedLocation &&
        allowsRepeatedLocation &&
        !hasPersonalOrEditorialCategory &&
        hasBusinessEvidence));
  if (!eligible) continue;

  const evidenceStrength = mapLink
    ? "direct-map-link"
    : bioLines.length
      ? "public-address"
      : repeatedLocation
        ? "repeated-post-location"
        : "public-address";

  const locationText =
    bioLines.join("، ") ||
    repeatedLocation?.name ||
    "";
  const displayName = profile.fullName || profile.username;
  const candidateTerm = [displayName, locationText].filter(Boolean).join("، ");
  const cityHint = inferCity(
    [profile.biography, ...locations.map((item) => item.name)].filter(Boolean).join(" "),
  );

  candidates.push({
    username,
    fullName: profile.fullName ?? "",
    biography: profile.biography ?? "",
    instagramUrl: profile.url ?? `https://instagram.com/${username}`,
    businessCategoryName: profile.businessCategoryName ?? null,
    categories,
    primaryCategory:
      primaryCategoryPriority.find((category) => categories.includes(category)) ??
      categories[0],
    candidateTerm,
    cityHint,
    evidenceStrength,
    evidence: {
      mapLink: mapLink ?? null,
      publicAddressLines: bioLines,
      postLocations: locations.slice(0, 5),
    },
    privacyEligible: true,
  });
}

const payload = {
  generatedAt: new Date().toISOString(),
  sourceProfileCount: profiles.size,
  candidateCount: candidates.length,
  policy:
    "Only public-facing businesses, venues, and offices with explicit or repeated location evidence. Personal/residential locations are excluded.",
  candidates,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${candidates.length} privacy-eligible candidates to ${outputPath}`);
