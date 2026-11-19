import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildEvidence,
  clusterPostLocations,
  coordinatesFromMapUrl,
  isAllowedPublicMapUrl,
  isCityLevelTag,
} from "../pipeline/evidence.mjs";
import { classifyByRules, classifyProfiles } from "../pipeline/classify.mjs";
import { ownerIdFromCredentials } from "../pipeline/instagram.mjs";
import { profileQueue, runSync } from "../pipeline/sync.mjs";
import { decodePwaResponse } from "../pipeline/neshan.mjs";

const token = `Bearer IGT:2:${Buffer.from(JSON.stringify({ ds_user_id: "100", sessionid: "100%3Aabc%3A1" })).toString("base64")}`;

function profile(overrides = {}) {
  return {
    pk: "1",
    username: "sample",
    fullName: "Sample",
    biography: "",
    externalUrls: [],
    category: null,
    isBusiness: true,
    isProfessional: true,
    isPrivate: false,
    isVerified: false,
    followerCount: 100,
    business: { street: "", city: "", zip: "", lat: 0, lng: 0, phone: "" },
    postLocations: [],
    ...overrides,
  };
}

/** A tiny stand-in for Instagram's mobile API, driven by `world`. */
function fakeInstagram(world) {
  return async (input) => {
    const url = new URL(String(input));
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.hostname !== "ig.test") return new Response("blocked", { status: 503 });
    if (url.pathname === "/api/v1/accounts/current_user/") return json({ status: "ok", user: { pk: 100, username: "owner" } });
    const following = url.pathname.match(/^\/api\/v1\/friendships\/(\d+)\/following\/$/);
    if (following) {
      if (world.hidden) return json({ status: "ok", users: [], special_empty_state: { body: "We limit certain things" } });
      const pageSize = 2;
      const start = Number(url.searchParams.get("max_id") ?? 0);
      const users = world.following.slice(start, start + pageSize);
      const next = start + pageSize < world.following.length ? String(start + pageSize) : null;
      return json({ status: "ok", users: users.map((u) => ({ pk: u.pk, username: u.username, full_name: u.full_name, is_private: u.is_private ?? false })), next_max_id: next });
    }
    const info = url.pathname.match(/^\/api\/v1\/users\/(\d+)\/info\/$/);
    if (info && world.partial?.includes(Number(info[1]))) return json({ status: "ok", user: { pk: Number(info[1]), biography: "" } });
    if (info) {
      const user = world.following.find((u) => String(u.pk) === info[1]);
      return user ? json({ status: "ok", user }) : json({ status: "fail", message: "User not found" }, 404);
    }
    const feed = url.pathname.match(/^\/api\/v1\/feed\/user\/(\d+)\/$/);
    if (feed) return json({ status: "ok", items: (world.posts?.[feed[1]] ?? []).map((location) => ({ location })) });
    return json({ status: "fail", message: "unknown endpoint" }, 404);
  };
}

function testConfig(dataDir) {
  return {
    dataDir,
    instagram: {
      authorization: token,
      sessionId: "",
      targetUsername: "",
      baseUrl: "https://ig.test",
      requestDelayMs: 0,
      profileBudget: 50,
      profileMaxAgeDays: 10,
      fetchPostLocations: true,
    },
    classifier: { apiKey: "", models: ["gemini-2.5-flash"], batchSize: 25 },
    geocoder: { neshanApiKey: "", usePwaSearch: false, requestDelayMs: 0 },
    schedule: { intervalMinutes: 60, enabled: true },
    publish: { includePrivateAccounts: false },
  };
}

const cafe = {
  pk: 1,
  username: "rooftop.cafe",
  full_name: "Rooftop Cafe",
  biography: "آدرس: تهران، خیابان ولیعصر، پلاک ۱۲",
  category: "Cafe",
  is_business: true,
  address_street: "Valiasr St 12",
  city_name: "Tehran",
  latitude: 35.75,
  longitude: 51.41,
};
const bakery = {
  pk: 2,
  username: "nan.bakery",
  full_name: "Nan Bakery",
  biography: "Fresh bread every morning",
  category: "Bakery",
  is_business: true,
};
const friend = { pk: 3, username: "my.friend", full_name: "A Friend", biography: "living my life", is_private: true };
const artist = { pk: 4, username: "painter", full_name: "Painter", biography: "Artist. Tehran", category: "Artist", is_business: false };
const shop = {
  pk: 5,
  username: "linkshop",
  full_name: "Link Shop",
  biography: "Find us https://www.google.com/maps/place/x/@35.7,51.4,17z/data=!3d35.7012!4d51.4123",
  category: "Clothing (Brand)",
  is_business: true,
};

test("map links are parsed and restricted to map providers", () => {
  assert.deepEqual(coordinatesFromMapUrl("https://www.google.com/maps/place/x/@35.7,51.4,17z/data=!3d35.7012!4d51.4123"), [51.4123, 35.7012]);
  assert.deepEqual(coordinatesFromMapUrl("https://neshan.org/maps/@35.708,51.42,16z"), [51.42, 35.708]);
  assert.equal(isAllowedPublicMapUrl("https://evil.example/maps/@35.7,51.4"), false);
  assert.equal(isAllowedPublicMapUrl("http://maps.google.com/?q=1,2"), false);
  assert.equal(isAllowedPublicMapUrl("https://maps.app.goo.gl/abc"), true);
});

test("Instagram owner id is read from the bearer token", () => {
  assert.equal(ownerIdFromCredentials({ authorization: token }), "100");
  assert.equal(ownerIdFromCredentials({ sessionId: "555%3Aabc" }), "555");
});

test("post tags are clustered and city-wide tags ignored", () => {
  const clusters = clusterPostLocations([
    { name: "Rooftop Cafe", lat: 35.75, lng: 51.41 },
    { name: "Rooftop Café Tehran", lat: 35.7501, lng: 51.4101 },
    { name: "Tehran, Iran", lat: 35.69, lng: 51.39 },
  ]);
  assert.equal(clusters[0].count, 2);
  assert.equal(isCityLevelTag({ name: "Tehran, Iran" }), true);
  assert.equal(isCityLevelTag({ name: "Iran Artists House" }), false);
  assert.equal(isCityLevelTag({ name: "Walnut Creek, California", address: "" }), true);
  assert.equal(isCityLevelTag({ name: "Seville, Spain" }), true);
  assert.equal(isCityLevelTag({ name: "Cafe Lamiz, Tehran", address: "Valiasr St" }), false, "a venue with an address is kept");
  assert.equal(isCityLevelTag({ name: "Pedram Couture", address: "" }), false);
});

test("people are never pinned, businesses with an address are", () => {
  const friendEvidence = buildEvidence(profile({ isPrivate: true, biography: "تهران" }), ["Personal_and_Noncommercial"]);
  assert.equal(friendEvidence.eligible, false);
  assert.equal(friendEvidence.reason, "private-account");

  const creator = buildEvidence(
    profile({ isBusiness: false, isProfessional: false, category: null, postLocations: [{ name: "Cafe X", lat: 35.7, lng: 51.4 }, { name: "Cafe X", lat: 35.7, lng: 51.4 }] }),
    ["Creators_Public_Figures_and_Personal_Brands", "Restaurants"],
  );
  assert.equal(creator.eligible, false);

  const business = buildEvidence(
    profile({ business: { street: "Valiasr 12", city: "Tehran", lat: 35.75, lng: 51.41, zip: "", phone: "" } }),
    ["Cafes_and_Coffee_Shops"],
  );
  assert.equal(business.eligible, true);
  assert.deepEqual(business.businessPin, [51.41, 35.75]);

  const closed = buildEvidence(profile({ biography: "آدرس: تهران — تعطیل شد" }), ["Restaurants"]);
  assert.equal(closed.eligible, false);
  assert.equal(closed.reason, "closed-or-moving");
});

test("keyword rules classify from Instagram's own category", () => {
  assert.deepEqual(classifyByRules(profile({ category: "Bakery", fullName: "Nan" })).categories.slice(0, 1), ["Bakeries_Desserts_and_Sweets"]);
  assert.deepEqual(classifyByRules(profile({ isBusiness: false, isProfessional: false, category: null })).categories, ["Personal_and_Noncommercial"]);
});

test("Gemini answers are validated and fall back to rules", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify({ results: [
          { username: "a", categories: ["Restaurants", "NotARealCategory"] },
        ] }) }] },
      }],
    }), { status: 200 });
  const results = await classifyProfiles(
    [profile({ pk: "1", username: "a" }), profile({ pk: "2", username: "b", category: "Gym/Physical Fitness Center" })],
    { apiKey: "test", models: ["gemini-2.5-flash"], batchDelayMs: 0, fetchImpl },
  );
  assert.deepEqual(results.get("1"), { categories: ["Restaurants"], method: "gemini:gemini-2.5-flash" });
  assert.equal(results.get("2").method, "rules");
  assert.ok(results.get("2").categories.includes("Sports_and_Fitness"));
});

test("the refresh queue prefers new follows, then the stalest profiles", () => {
  const now = Date.parse("2026-11-19T00:00:00Z");
  const state = {
    following: { a: { pk: "a" }, b: { pk: "b" }, c: { pk: "c" }, d: { pk: "d" } },
    profiles: {
      a: { fetchedAt: "2026-11-18T00:00:00Z" },
      b: { fetchedAt: "2026-10-01T00:00:00Z" },
      c: { fetchedAt: "2026-09-01T00:00:00Z" },
    },
  };
  assert.deepEqual(profileQueue(state, { budget: 3, maxAgeDays: 10, now }).map((f) => f.pk), ["d", "c", "b"]);
});

test("the PWA decoder refuses unknown envelopes", () => {
  assert.throws(() => decodePwaResponse("not-a-valid-envelope"), /envelope changed/);
  assert.deepEqual(decodePwaResponse('{"items":[]}'), { items: [] });
});

test("a full sync lists followed pages, pins places, and hides people", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "atlas-sync-"));
  try {
    const world = {
      following: [cafe, bakery, friend, artist, shop],
      posts: { 2: [
        { name: "Nan Bakery", lat: 35.71, lng: 51.39, address: "Enghelab St" },
        { name: "Nan Bakery", lat: 35.71, lng: 51.39, address: "Enghelab St" },
      ] },
    };
    const result = await runSync({ config: testConfig(dataDir), log: () => {}, fetchImpl: fakeInstagram(world) });
    assert.equal(result.ok, true);
    const atlas = JSON.parse(await readFile(join(dataDir, "atlas.json"), "utf8"));
    const listed = atlas.directory.map((entry) => entry.username).sort();
    assert.deepEqual(listed, ["linkshop", "nan.bakery", "painter", "rooftop.cafe"]);
    const pins = Object.fromEntries(atlas.features.map((f) => [f.properties.username, f]));
    assert.deepEqual(pins["rooftop.cafe"].geometry.coordinates, [51.41, 35.75]);
    assert.equal(pins["rooftop.cafe"].properties.geocodeMethod, "instagram-business-address");
    assert.equal(pins["nan.bakery"].properties.geocodeMethod, "instagram-place-tag");
    assert.equal(pins.linkshop.properties.geocodeMethod, "direct-map-link");
    assert.equal(pins.painter, undefined, "artists are not pinned from a city name");
    assert.equal(atlas.stats.hidden, 1);
    assert.doesNotMatch(JSON.stringify(atlas), /my\.friend/);

    // A new follow appears on the next run. An unfollowed page survives a
    // couple of misses (Instagram's paging drops accounts at random), then goes.
    world.following = [cafe, bakery, artist, shop, { ...bakery, pk: 6, username: "new.place", full_name: "New Place" }];
    const sync = () => runSync({ config: testConfig(dataDir), log: () => {}, fetchImpl: fakeInstagram(world) });
    const readAtlas = async () => JSON.parse(await readFile(join(dataDir, "atlas.json"), "utf8"));
    await sync();
    let next = await readAtlas();
    assert.ok(next.directory.some((entry) => entry.username === "new.place"));
    assert.equal(next.stats.following, 6, "the missing friend is kept for now");
    await sync();
    await sync();
    next = await readAtlas();
    assert.equal(next.stats.following, 5, "removed after three missed runs");

    // A page missed once and then seen again keeps its data.
    world.following = [cafe, artist, shop, { ...bakery, pk: 6, username: "new.place", full_name: "New Place" }];
    await sync();
    world.following = [cafe, bakery, artist, shop, { ...bakery, pk: 6, username: "new.place", full_name: "New Place" }];
    await sync();
    const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
    assert.equal(state.following["2"].missedRuns, 0);
    assert.equal(state.profiles["2"].username, "nan.bakery");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a hidden or collapsed following list never wipes the atlas", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "atlas-guard-"));
  try {
    const many = Array.from({ length: 30 }, (_, index) => ({ ...bakery, pk: 100 + index, username: `place${index}` }));
    const world = { following: many };
    const config = testConfig(dataDir);
    config.instagram.profileBudget = 0;
    await runSync({ config, log: () => {}, fetchImpl: fakeInstagram(world) });

    world.hidden = true;
    const hidden = await runSync({ config, log: () => {}, fetchImpl: fakeInstagram(world) });
    assert.equal(hidden.ok, false);
    assert.match(hidden.error, /hiding this following list/);

    world.hidden = false;
    world.following = many.slice(0, 3);
    const collapsed = await runSync({ config, log: () => {}, fetchImpl: fakeInstagram(world) });
    assert.equal(collapsed.ok, false);
    const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
    assert.equal(Object.keys(state.following).length, 30);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("admin approvals override the geocoder, including hiding a page", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "atlas-approve-"));
  try {
    await writeFile(join(dataDir, "approvals.json"), JSON.stringify({ approvals: [
      { username: "nan.bakery", coordinates: [51.5, 35.8], reason: "checked" },
      { username: "rooftop.cafe", hidden: true },
    ] }));
    await runSync({ config: testConfig(dataDir), log: () => {}, fetchImpl: fakeInstagram({ following: [cafe, bakery] }) });
    const atlas = JSON.parse(await readFile(join(dataDir, "atlas.json"), "utf8"));
    const pins = Object.fromEntries(atlas.features.map((f) => [f.properties.username, f]));
    assert.deepEqual(pins["nan.bakery"].geometry.coordinates, [51.5, 35.8]);
    assert.equal(pins["rooftop.cafe"], undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a stripped-down profile from Instagram is retried later, not stored", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "atlas-partial-"));
  try {
    const world = { following: [cafe, bakery], partial: [2] };
    const result = await runSync({ config: testConfig(dataDir), log: () => {}, fetchImpl: fakeInstagram(world) });
    assert.equal(result.ok, true);
    assert.equal(result.stats.incompleteProfiles, 1);
    const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
    assert.equal(state.profiles["2"], undefined);
    const atlas = JSON.parse(await readFile(join(dataDir, "atlas.json"), "utf8"));
    const pending = atlas.directory.find((entry) => entry.username === "nan.bakery");
    assert.equal(pending.pending, true, "still listed, marked as being processed");

    world.partial = [];
    await runSync({ config: testConfig(dataDir), log: () => {}, fetchImpl: fakeInstagram(world) });
    const next = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
    assert.equal(next.profiles["2"].username, "nan.bakery");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a coach who tags their home city is not pinned", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "atlas-city-"));
  try {
    const coach = { pk: 7, username: "coach", full_name: "A Coach", biography: "Helping leaders communicate", category: "Coach", is_business: true };
    const city = { name: "Walnut Creek, California", address: "", lat: 37.9, lng: -122.06 };
    const world = { following: [coach], posts: { 7: [city, city, city, city, { ...city, name: "San Francisco, California" }] } };
    await runSync({ config: testConfig(dataDir), log: () => {}, fetchImpl: fakeInstagram(world) });
    const atlas = JSON.parse(await readFile(join(dataDir, "atlas.json"), "utf8"));
    assert.equal(atlas.features.length, 0);
    assert.equal(atlas.directory[0].username, "coach", "still listed in the directory");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("pages classified by rules are retried with Gemini on a later run", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "atlas-retry-"));
  try {
    const instagram = fakeInstagram({ following: [cafe, bakery] });
    let geminiUp = false;
    const fetchImpl = async (input, init) => {
      if (!String(input).includes("generativelanguage")) return instagram(input, init);
      if (!geminiUp) {
        return new Response(JSON.stringify({ error: { message: "quota", details: [{ retryDelay: "0s" }] } }), { status: 429 });
      }
      const asked = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^[^\[]*/, ""));
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({
        results: asked.map((item) => ({ username: item.username, categories: ["Restaurants"] })),
      }) }] } }] }), { status: 200 });
    };
    const config = testConfig(dataDir);
    config.classifier = { ...config.classifier, apiKey: "test", batchDelayMs: 0 };
    await runSync({ config, log: () => {}, fetchImpl });
    let state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
    assert.equal(state.classifications["1"].method, "rules");

    geminiUp = true;
    await runSync({ config, log: () => {}, fetchImpl });
    state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
    assert.equal(state.classifications["1"].method, "gemini:gemini-2.5-flash");
    assert.deepEqual(state.classifications["2"].categories, ["Restaurants"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
