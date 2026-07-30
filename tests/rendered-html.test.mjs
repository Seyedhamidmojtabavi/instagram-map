import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(new URL("../app/AtlasMap.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const geocoder = await readFile(new URL("../scripts/geocode-neshan.mjs", import.meta.url), "utf8");
const candidates = await readFile(new URL("../scripts/build-location-candidates.mjs", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const lockfile = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const npmConfig = await readFile(new URL("../.npmrc", import.meta.url), "utf8");
const approvals = JSON.parse(
  await readFile(new URL("../scripts/location-approvals.json", import.meta.url), "utf8"),
);

test("the Atlas UI contains the core map experience", () => {
  assert.match(page, /Following Atlas/);
  assert.match(page, /MAP LAYERS/);
  assert.match(page, /Restaurants/);
  assert.match(page, /Cafés & coffee shops/);
  assert.match(page, /READY FOR MATCHED LOCATIONS/);
  assert.match(route, /NEXT_PUBLIC_NESHAN_WEB_KEY/);
  assert.match(route, /force-dynamic/);
  assert.match(page, /cluster: true/);
  assert.match(page, /Open in Neshan/);
  assert.match(page, /setActiveCategories\(createAllCategorySet\(\)\)/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(worker, /vinext\/server\/app-router-entry/);
  assert.doesNotMatch(worker, /environment\.ASSETS\.fetch/);
});

test("the enrichment pipeline uses the anonymous PWA route and queues uncertain matches", () => {
  assert.match(geocoder, /https:\/\/neshan\.org\/maps\/pwa-api\/neshan-search/);
  assert.match(geocoder, /decodePwaResponse/);
  assert.match(geocoder, /encodeURIComponent\(JSON\.stringify\(body\)\)/);
  assert.match(geocoder, /Browser cookies are not used|without copied browser cookies/);
  assert.match(geocoder, /needs-human-review/);
  assert.match(geocoder, /manual-approval-no-longer-matches/);
  assert.match(geocoder, /AbortSignal\.timeout/);
  assert.match(geocoder, /isAllowedPublicMapUrl/);
  assert.match(geocoder, /redirect: "manual"/);
  assert.match(geocoder, /!decoded \|\| !Array\.isArray\(decoded\.items\)/);
  assert.doesNotMatch(geocoder, /redirect: "follow"/);
  assert.doesNotMatch(geocoder, /APP_INITIALIZATION_STATE/);
  assert.equal(approvals.approvals.length, 21);
  assert.equal(
    new Set(approvals.approvals.map((approval) => approval.username)).size,
    approvals.approvals.length,
  );
  assert.match(candidates, /privacyEligible: true/);
  assert.match(candidates, /Personal and creator accounts are never located/);
  assert.match(candidates, /hasExplicitPublicEvidence && hasBusinessEvidence/);
  assert.match(candidates, /isAllowedPublicMapUrl/);
});

test("the Railway install is reproducible and includes build tooling", () => {
  const malformedPackages = Object.entries(lockfile.packages).filter(
    ([path, packageRecord]) =>
      path && !packageRecord.version && !packageRecord.link,
  );

  assert.deepEqual(malformedPackages, []);
  assert.match(npmConfig, /^include=dev\s*$/);
});
