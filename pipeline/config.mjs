import { resolve } from "node:path";

function number(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

/** Railway exposes the mounted volume path; everything else falls back to ./data/runtime. */
export function dataDir() {
  return resolve(
    process.env.DATA_DIR ||
      process.env.RAILWAY_VOLUME_MOUNT_PATH ||
      "./data/runtime",
  );
}

export function loadConfig() {
  return {
    dataDir: dataDir(),
    instagram: {
      // Bearer token copied from the Instagram app ("IGT:2:..."), or a web sessionid cookie.
      authorization: process.env.IG_AUTHORIZATION?.trim() || "",
      sessionId: process.env.IG_SESSIONID?.trim() || "",
      // Whose following list to track. Defaults to the logged-in account.
      targetUsername: process.env.IG_TARGET_USERNAME?.trim().replace(/^@/, "") || "",
      baseUrl: process.env.IG_API_BASE_URL || "https://i.instagram.com",
      requestDelayMs: number("IG_REQUEST_DELAY_MS", 2_500),
      profileBudget: number("IG_PROFILE_BUDGET", 80),
      profileMaxAgeDays: number("IG_PROFILE_MAX_AGE_DAYS", 10),
      fetchPostLocations: bool("IG_FETCH_POST_LOCATIONS", true),
    },
    classifier: {
      apiKey: process.env.GEMINI_API_KEY?.trim() || "",
      // Tried in order; a model that is overloaded falls through to the next.
      models: [
        ...new Set([
          ...(process.env.GEMINI_MODEL || "gemini-2.5-flash").split(",").map((m) => m.trim()).filter(Boolean),
          "gemini-flash-latest",
        ]),
      ],
      batchSize: number("CLASSIFIER_BATCH_SIZE", 25),
    },
    geocoder: {
      neshanApiKey: process.env.NESHAN_API_KEY || "",
      usePwaSearch: bool("NESHAN_PWA_SEARCH", true),
      requestDelayMs: number("NESHAN_REQUEST_DELAY_MS", 450),
    },
    schedule: {
      intervalMinutes: number("SYNC_INTERVAL_MINUTES", 60),
      enabled: bool("SYNC_ENABLED", true),
    },
    publish: {
      includePrivateAccounts: bool("ATLAS_INCLUDE_PRIVATE", false),
    },
  };
}
