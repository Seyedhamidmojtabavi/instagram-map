import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [app, map, route, boot, atlasServer, approve, gitignore, npmConfig] = await Promise.all([
  read("app/AtlasApp.tsx"),
  read("app/MapCanvas.tsx"),
  read("app/page.tsx"),
  read("server/boot.mjs"),
  read("lib/atlas-server.ts"),
  read("app/api/admin/approve/route.ts"),
  read(".gitignore"),
  read(".npmrc"),
]);
const lockfile = JSON.parse(await read("package-lock.json"));
const pkg = JSON.parse(await read("package.json"));
const taxonomy = JSON.parse(await read("lib/categories.json"));
const approvals = JSON.parse(await read("scripts/location-approvals.json"));

test("the site reads live data and keeps the map key server-provided", () => {
  assert.match(route, /NEXT_PUBLIC_NESHAN_WEB_KEY/);
  assert.match(route, /force-dynamic/);
  assert.match(app, /\/api\/atlas/);
  assert.match(map, /cluster: true/);
  assert.match(map, /khatam-/);
  assert.match(app, /Directions in Neshan/);
  assert.match(atlasServer, /RAILWAY_VOLUME_MOUNT_PATH/);
  assert.match(atlasServer, /locations\.geojson/, "falls back to the curated seed on first boot");
});

test("production start runs the web server and the sync scheduler together", () => {
  assert.equal(pkg.scripts.start, "node server/boot.mjs");
  assert.match(boot, /vinext\/dist\/cli\.js/);
  assert.match(boot, /runSync/);
  assert.match(boot, /SYNC_INTERVAL_MINUTES|intervalMinutes/);
});

test("admin endpoints require the admin token", () => {
  assert.match(atlasServer, /ADMIN_TOKEN/);
  assert.match(atlasServer, /expected\.length < 12/);
  assert.match(approve, /isAdmin\(request\)/);
});

test("every category belongs to a family with a colour", () => {
  const familyIds = new Set(taxonomy.families.map((family) => family.id));
  assert.equal(taxonomy.categories.length, 21);
  for (const category of taxonomy.categories) assert.ok(familyIds.has(category.family), category.id);
  for (const family of taxonomy.families) assert.match(family.color, /^#[0-9A-F]{6}$/i);
});

test("human-reviewed approvals are unique", () => {
  const names = approvals.approvals.map((approval) => approval.username.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test("pipeline data never gets committed", () => {
  assert.match(gitignore, /^\/data\/runtime\/$/m);
  assert.match(gitignore, /^\.env\*$/m);
});

test("the Railway install is reproducible and includes build tooling", () => {
  const malformed = Object.entries(lockfile.packages).filter(
    ([path, record]) => path && !record.version && !record.link,
  );
  assert.deepEqual(malformed, []);
  assert.match(npmConfig, /^include=dev\s*$/);
});
