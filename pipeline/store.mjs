import { mkdir, readFile, rename, rm, writeFile, open } from "node:fs/promises";
import { join } from "node:path";

export const STATE_VERSION = 1;

export function paths(dataDir) {
  return {
    state: join(dataDir, "state.json"),
    atlas: join(dataDir, "atlas.json"),
    status: join(dataDir, "status.json"),
    approvals: join(dataDir, "approvals.json"),
    review: join(dataDir, "review.json"),
    lock: join(dataDir, "sync.lock"),
    request: join(dataDir, "sync-request.json"),
    session: join(dataDir, "ig-session.json"),
    cache: join(dataDir, "geocode-cache.json"),
  };
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

/** Write via a temp file + rename so readers never see half a file. */
export async function writeJson(path, value, { mode } = {}) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
  await rename(temp, path);
}

export function emptyState() {
  return {
    version: STATE_VERSION,
    owner: null,
    target: null,
    following: {},
    profiles: {},
    classifications: {},
    locations: {},
    runs: [],
    backoffUntil: null,
  };
}

export async function loadState(dataDir) {
  const state = await readJson(paths(dataDir).state, null);
  if (!state) return emptyState();
  if (state.version !== STATE_VERSION) {
    throw new Error(`Unsupported state version ${state.version}.`);
  }
  return { ...emptyState(), ...state };
}

export async function saveState(dataDir, state) {
  await writeJson(paths(dataDir).state, state);
}

const STALE_LOCK_MS = 3 * 60 * 60 * 1000;

/** Exclusive lock so a manual trigger never overlaps a scheduled run. */
export async function acquireLock(dataDir) {
  const lockPath = paths(dataDir).lock;
  await mkdir(dataDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await handle.close();
      return async () => rm(lockPath, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readJson(lockPath, null);
      if (existing && Date.now() - existing.at < STALE_LOCK_MS) return null;
      await rm(lockPath, { force: true });
    }
  }
  return null;
}
