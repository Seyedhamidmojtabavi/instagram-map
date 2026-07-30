import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const classifiedDir = resolve(appRoot, "..", "Classified");
const outputPath = join(appRoot, "data", "location-candidates.json");

const excludedWithoutBusinessEvidence = new Set([
  "Creators_Public_Figures_and_Personal_Brands",
  "Personal_and_Noncommercial",
  "Unclear",
]);

const categoryFiles = (await readdir(classifiedDir))
  .filter((name) => name.endsWith(".json"))
  .sort();

const membership = new Map();
const profiles = new Map();

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
  return externalLinks(profile).find((url) =>
    /(?:google\.[^/]+\/maps|maps\.app\.goo\.gl|neshan\.org\/maps|balad\.ir|waze\.com)/i.test(url),
  );
}

function bioLocationLines(profile) {
  const locationPattern =
    /(?:📍|آدرس|نشانی|address|شعبه|دفتر|خیابان|بلوار|میدان|کوچه|پلاک|طبقه|تهران|کرج|قم|مشهد|اصفهان|شیراز|رشت|تبریز|اهواز|کیش)/iu;
  return String(profile.biography ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3 && locationPattern.test(line))
    .slice(0, 4);
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
  const repeatedLocation = locations.find((item) => item.count >= 2);
  const singleLocation = locations[0];
  const isBusinessLike =
    profile.isBusinessAccount === true ||
    Boolean(profile.businessCategoryName) ||
    categories.some((category) => !excludedWithoutBusinessEvidence.has(category));

  // Personal and creator accounts are never located from incidental post tags.
  // They need an explicit public-facing address or map link and business evidence.
  const hasPublicEvidence = Boolean(mapLink || bioLines.length);
  const eligible =
    isBusinessLike &&
    (hasPublicEvidence ||
      (repeatedLocation && categories.some((category) => !excludedWithoutBusinessEvidence.has(category))));
  if (!eligible) continue;

  const evidenceStrength = mapLink
    ? "direct-map-link"
    : bioLines.length
      ? "public-address"
      : repeatedLocation
        ? "repeated-post-location"
        : "single-post-location";

  const locationText =
    bioLines.join("، ") ||
    repeatedLocation?.name ||
    singleLocation?.name ||
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
    primaryCategory: categories[0],
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
