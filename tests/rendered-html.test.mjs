import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(new URL("../app/AtlasMap.tsx", import.meta.url), "utf8");
const geocoder = await readFile(new URL("../scripts/geocode-neshan.mjs", import.meta.url), "utf8");
const candidates = await readFile(new URL("../scripts/build-location-candidates.mjs", import.meta.url), "utf8");

test("the Atlas UI contains the core map experience", () => {
  assert.match(page, /Following Atlas/);
  assert.match(page, /MAP LAYERS/);
  assert.match(page, /Restaurants/);
  assert.match(page, /Cafés & coffee shops/);
  assert.match(page, /READY FOR VERIFIED LOCATIONS/);
  assert.match(page, /NEXT_PUBLIC_NESHAN_WEB_KEY/);
  assert.match(page, /cluster: true/);
  assert.match(page, /Open in Neshan/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
});

test("the enrichment pipeline keeps service keys server-side and queues uncertain matches", () => {
  assert.match(geocoder, /NESHAN_SERVICE_KEY/);
  assert.match(geocoder, /https:\/\/api\.neshan\.org\/v1\/search/);
  assert.match(geocoder, /needs-human-review/);
  assert.match(candidates, /privacyEligible: true/);
  assert.match(candidates, /Personal and creator accounts are never located/);
});
