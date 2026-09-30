#!/usr/bin/env node
// scripts/slop-guard.mjs — Claude Code PostToolUse hook: flags a long comment the moment an edit writes one.
// Same check as the gate (lib/slop.mjs); failing to read the payload or the file never blocks.

import { isAbsolute, relative, resolve } from "node:path";
import { checkFile, describe, slopConfig } from "./lib/slop.mjs";
import { isMain, ROOT } from "./lib/util.mjs";

/** The block reason for one PostToolUse payload, or null when the edit is clean. */
export function slopReason(payload, root = ROOT) {
  const file = payload?.tool_input?.file_path;
  if (typeof file !== "string" || file === "") return null;
  const abs = resolve(payload.cwd ?? root, file);
  const rel = relative(root, abs);
  const config = slopConfig(resolve(root, "package.json"));
  const hits = checkFile(abs, rel.startsWith("..") || isAbsolute(rel) ? abs : rel, config);
  if (hits.length === 0) return null;
  return ["slop-guard: shorten these comments now.", ...hits.map((h) => describe(h, config))].join("\n");
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  // As a plugin this file lives outside the project; the project's own config comes from its root.
  const reason = slopReason(payload, process.env.CLAUDE_PROJECT_DIR || ROOT);
  if (reason) process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

if (isMain(import.meta.url)) {
  await main();
}
