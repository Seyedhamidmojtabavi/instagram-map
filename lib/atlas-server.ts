import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { familyForCategory, type Atlas, type Place } from "./atlas-types";

/** Same resolution as pipeline/config.mjs so the site reads what the sync writes. */
export function dataDir() {
  return resolve(
    process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "./data/runtime",
  );
}

export function dataPath(name: string) {
  return join(dataDir(), name);
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(path: string, value: unknown) {
  await mkdir(dataDir(), { recursive: true });
  const temp = `${path}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

type SeedFeature = {
  geometry: Place["geometry"];
  properties: Omit<Place["properties"], "pk" | "family" | "color"> & { color?: string };
};

/** First boot, before any sync: show the pins that were curated by hand. */
async function seedAtlas(): Promise<Atlas> {
  const candidates = [
    join(process.cwd(), "public", "locations.geojson"),
    join(process.cwd(), "dist", "client", "locations.geojson"),
  ];
  let seed: { metadata?: { generatedAt?: string; reviewCount?: number }; features: SeedFeature[] } | null = null;
  for (const path of candidates) {
    seed = await readJsonFile(path);
    if (seed) break;
  }
  const features: Place[] = (seed?.features ?? []).map((feature) => {
    const family = familyForCategory(feature.properties.primaryCategory);
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        pk: feature.properties.username,
        family: family.id,
        color: family.color,
      },
    };
  });
  return {
    type: "FeatureCollection",
    generatedAt: seed?.metadata?.generatedAt ?? null,
    lastSyncAt: seed?.metadata?.generatedAt ?? null,
    source: null,
    stats: {
      following: features.length,
      listed: features.length,
      located: features.length,
      awaitingReview: seed?.metadata?.reviewCount ?? 0,
      hidden: 0,
      pendingProfiles: 0,
    },
    sync: null,
    features,
    directory: features.map((feature) => ({
      pk: feature.properties.pk,
      username: feature.properties.username,
      fullName: feature.properties.fullName,
      categories: feature.properties.categories,
      primaryCategory: feature.properties.primaryCategory,
      family: feature.properties.family,
      verified: false,
      bio: String(feature.properties.biography ?? "").replace(/\s+/g, " ").slice(0, 180),
      located: true,
      pending: false,
    })),
  };
}

export async function loadAtlas(): Promise<{ atlas: Atlas; live: boolean }> {
  const live = await readJsonFile<Atlas>(dataPath("atlas.json"));
  if (live && Array.isArray(live.features) && Array.isArray(live.directory)) {
    return { atlas: live, live: true };
  }
  return { atlas: await seedAtlas(), live: false };
}

/** Constant-time check of the admin token sent as `Authorization: Bearer <token>`. */
export function isAdmin(request: Request) {
  const expected = process.env.ADMIN_TOKEN ?? "";
  if (expected.length < 12) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.replace(/^Bearer\s+/i, "");
  if (given.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ given.charCodeAt(index);
  }
  return mismatch === 0;
}
