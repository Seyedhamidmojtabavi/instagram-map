#!/usr/bin/env node
// Production entry point: serves the site and keeps the atlas in sync.
//
// The web server runs as a child process so a crash in either half is
// isolated. The scheduler runs a sync on boot, then every
// SYNC_INTERVAL_MINUTES, and whenever the admin page drops a request file.
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../pipeline/config.mjs";
import { paths, readJson, writeJson } from "../pipeline/store.mjs";
import { runSync } from "../pipeline/sync.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = loadConfig();
const files = paths(config.dataDir);

function log(message) {
  console.log(`[sync] ${message}`);
}

const web = spawn(process.execPath, [`${root}node_modules/vinext/dist/cli.js`, "start"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
web.on("exit", (code, signal) => {
  console.error(`[boot] Web server exited (${signal ?? code}).`);
  process.exit(code ?? 1);
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    web.kill(signal);
    // A sync cut off by a redeploy must not leave its lock behind.
    rm(files.lock, { force: true }).finally(() => setTimeout(() => process.exit(0), 3_000).unref());
  });
}

// Railway runs one container per volume, so a lock that exists at boot belongs
// to a process that is gone (for example a deploy replaced mid-sync).
await rm(files.lock, { force: true });

const hasCredentials = Boolean(config.instagram.authorization || config.instagram.sessionId);
let running = false;
let nextRunAt = null;

async function writeStatus(extra = {}) {
  const previous = await readJson(files.status, {});
  await writeJson(files.status, {
    ...previous,
    scheduler: config.schedule.enabled && hasCredentials ? "on" : "off",
    intervalMinutes: config.schedule.intervalMinutes,
    running,
    nextRunAt,
    updatedAt: new Date().toISOString(),
    ...extra,
  });
}

async function syncNow(trigger) {
  if (running) return;
  running = true;
  await writeStatus({ lastTrigger: trigger, startedAt: new Date().toISOString() });
  let result;
  try {
    result = await runSync({ config, log });
  } catch (error) {
    log(`Sync failed: ${error.stack ?? error.message}`);
    result = { ok: false, error: error.message };
  }
  running = false;
  nextRunAt = new Date(Date.now() + config.schedule.intervalMinutes * 60_000).toISOString();
  await writeStatus({ lastResult: { ...result, finishedAt: new Date().toISOString() } });
}

if (!hasCredentials) {
  log("No IG_AUTHORIZATION or IG_SESSIONID set; serving the last published atlas without syncing.");
  await writeStatus();
} else if (!config.schedule.enabled) {
  log("SYNC_ENABLED is off; serving the last published atlas.");
  await writeStatus();
} else {
  log(`Syncing every ${config.schedule.intervalMinutes} minutes. Data lives in ${config.dataDir}.`);
  // A redeploy should not trigger an extra Instagram sync: keep the existing
  // schedule when the last run finished less than one interval ago.
  const previous = await readJson(files.status, {});
  const lastFinished = Date.parse(previous.lastResult?.finishedAt ?? "");
  const due = Number.isFinite(lastFinished)
    ? lastFinished + config.schedule.intervalMinutes * 60_000
    : Date.now();
  nextRunAt = new Date(Math.max(due, Date.now() + 20_000)).toISOString();
  log(`Next sync at ${nextRunAt}.`);
  await writeStatus();
  setInterval(() => {
    if (!running && nextRunAt && Date.parse(nextRunAt) <= Date.now()) syncNow("schedule");
  }, 30_000);
  setInterval(async () => {
    if (running) return;
    const request = await readJson(files.request, null).catch(() => null);
    if (!request) return;
    await rm(files.request, { force: true });
    syncNow("manual");
  }, 10_000);
}
