#!/usr/bin/env node
// scripts/design-check.mjs — fails when DESIGN.md breaks its format or a component's text misses WCAG AA.
// `npm run gate` runs it after the comment check; `npm run design` runs it alone.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { designProblems } from "./lib/design.mjs";
import { isMain, note as write, ROOT } from "./lib/util.mjs";

const note = (msg) => write(msg, "[design] ");

/** Prints what breaks DESIGN.md; returns the exit code the gate should see. */
export function reportDesign(root = ROOT) {
  const path = join(root, "DESIGN.md");
  if (!existsSync(path)) {
    note("no DESIGN.md — nothing to check");
    return 0;
  }
  const { problems, notes, pairs } = designProblems(readFileSync(path, "utf8"));
  for (const msg of notes) note(msg);
  for (const msg of problems) note(`DESIGN.md: ${msg}`);
  if (problems.length) {
    note(`${problems.length} problem(s) — rules: docs/anti-slop/ui.md`);
    return 1;
  }
  note(pairs ? `format ok; ${pairs} text/background pair(s) meet WCAG AA` : "format ok; no component sets both a text and a background colour yet");
  return 0;
}

if (isMain(import.meta.url)) {
  process.exit(reportDesign());
}
