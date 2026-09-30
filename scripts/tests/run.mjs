#!/usr/bin/env node
// scripts/tests/run.mjs — runs the suite with explicit file paths, so no shell has to expand a glob.
// Usage: node scripts/tests/run.mjs [extra node --test flags]

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => join(HERE, f));

if (files.length === 0) {
  process.stderr.write("[tests] no *.test.mjs found\n");
  process.exit(1);
}

const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
