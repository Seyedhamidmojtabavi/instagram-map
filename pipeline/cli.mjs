#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { paths, readJson } from "./store.mjs";
import { runSync } from "./sync.mjs";

const command = process.argv[2] ?? "sync";
const config = loadConfig();

if (command === "sync") {
  const result = await runSync({ config });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok || result.skipped ? 0 : 1);
} else if (command === "status") {
  const atlas = await readJson(paths(config.dataDir).atlas, null);
  const state = await readJson(paths(config.dataDir).state, null);
  console.log(JSON.stringify({
    dataDir: config.dataDir,
    target: state?.target ?? null,
    lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt ?? null,
    backoffUntil: state?.backoffUntil ?? null,
    stats: atlas?.stats ?? null,
    lastRun: state?.runs?.at(-1) ?? null,
  }, null, 2));
} else {
  console.error("Usage: node pipeline/cli.mjs [sync|status]");
  process.exit(2);
}
