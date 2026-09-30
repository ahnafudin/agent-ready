#!/usr/bin/env node
// scripts/slop-check.mjs — fails when a tracked file holds a comment block over the limit.
// `npm run gate` runs it first in every project; `npm run slop [paths…]` runs it alone.

import { join } from "node:path";
import { checkFile, describe, slopConfig, validateCommentRegistry } from "./lib/slop.mjs";
import { isMain, note as write, ROOT, tryRun } from "./lib/util.mjs";

const note = (msg) => write(msg, "[slop] ");

/** Findings in the given repo-relative paths, or in every tracked file when none are given. */
export function findSlop(paths = [], root = ROOT) {
  const config = slopConfig(join(root, "package.json"));
  let files = paths;
  if (files.length === 0) {
    const listed = tryRun("git", ["ls-files"], { cwd: root });
    if (!listed.ok) return { config, hits: [], skipped: `cannot list tracked files (${listed.out})` };
    files = listed.out.split(/\r?\n/).filter(Boolean);
  }
  const hits = files.flatMap((rel) => checkFile(join(root, rel), rel, config));
  return { config, hits, skipped: null };
}

/** Prints the findings; returns the exit code the gate should see. */
export function reportSlop(paths = [], root = ROOT) {
  const invalid = validateCommentRegistry();
  if (invalid.length) {
    for (const error of invalid) note(`scripts/comments.json: ${error}`);
    return 1;
  }
  const { config, hits, skipped } = findSlop(paths, root);
  if (skipped) {
    note(`skipped — ${skipped}`);
    return 0;
  }
  for (const hit of hits) note(describe(hit, config));
  if (hits.length) {
    note(`${hits.length} comment block(s) over ${config.maxCommentLines} lines — rules: docs/anti-slop/`);
    return 1;
  }
  note(`no comment block over ${config.maxCommentLines} lines`);
  return 0;
}

if (isMain(import.meta.url)) {
  process.exit(reportSlop(process.argv.slice(2)));
}
