#!/usr/bin/env node
// scripts/personalize.mjs — turn a pristine copy of agent-ready into THIS
// project. Runs once, early in `npm run setup`.
//
// Every bug found by generating real apps from agent-ready had the same
// shape: agent-ready's own scaffolding surviving into the project that was made from it.
// The beads identity. The gates. The npm `test` script. And the four this file
// fixes — the version, the README, the licence and the contribution guide.
//
//   version   a new project starts at 0.1.0, not at whatever release
//             agent-ready itself had reached (0.2.x, and climbing)
//   README    agent-ready's README describes agent-ready itself. Left in place, an
//             agent opening the project reads "a project boilerplate … 70-entry
//             framework registry" and concludes the project IS agent-ready.
//             It moves to docs/AGENT-READY.md — still needed, since it documents
//             the tooling — and a project README takes its place.
//   LICENSE   agent-ready's MIT licence names agent-ready's author; left at
//             the root it would claim the new project. MIT requires the notice
//             to travel with the copied tooling, so it moves to
//             docs/AGENT-READY-LICENSE, and the root is left for the owner's choice.
//   CONTRIBUTING.md  explains how to contribute to agent-ready — noise in a
//             project, and GitHub would show it on every new issue. Removed.
//
// Two conditions, both required, so this can never fire on a real project:
//   - package.json no longer carries the placeholder name (someone renamed it)
//   - `vibe.pristine` is still set (nothing has personalised it yet)
// `scripts/stacks.mjs` clears that flag immediately afterwards in setup, when it
// swaps agent-ready's gates for the detected framework's.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isAgentReadyItself, note as write, parseFlags, readJson, ROOT, writeIfChanged } from "./lib/util.mjs";

/** Marks a README as still being agent-ready's own, and therefore replaceable. */
export const OWN_README_MARKER = "<!-- agent-ready:readme -->";
/** Marks a CONTRIBUTING.md as agent-ready's own, and therefore removable. */
export const OWN_CONTRIBUTING_MARKER = "<!-- agent-ready:contributing -->";
/**
 * Agent-ready's LICENSE, recognised by its holder line — a licence the owner
 * wrote names someone else and is never moved. (The marker trick is not used
 * here: a comment in LICENSE would stop GitHub recognising it as MIT.)
 */
const OWN_LICENSE = /^Copyright \(c\) [\d, -]+ ahnafudin$/m;
export const FRESH_VERSION = "0.1.0";
const KEPT_AS = join("docs", "AGENT-READY.md");
const LICENSE_KEPT_AS = join("docs", "AGENT-READY-LICENSE");

const note = (msg) => write(msg, "[personalize] ");

function projectReadme(pkg) {
  const name = pkg?.name ?? "this project";
  const description = pkg?.description?.startsWith("TODO:fill") ? "" : (pkg?.description ?? "");
  return [
    `# ${name}`,
    "",
    description || "<!-- TODO:fill — one paragraph on what this project is and who it is for. -->",
    "",
    "## Getting started",
    "",
    "```bash",
    "npm install",
    "npm run setup     # git hooks, framework detection, agent docs, issue tracker",
    "npm run gate      # lint → typecheck → test → build, whatever the language",
    "```",
    "",
    "## Where things are",
    "",
    "| For | Read |",
    "|---|---|",
    "| Rules every AI coding agent follows here | [`AGENTS.md`](AGENTS.md) |",
    "| The detected framework, where logic belongs, the gate commands | [`docs/STACK.md`](docs/STACK.md) |",
    "| Product scope and guardrails | [`docs/PRD.md`](docs/PRD.md) |",
    "| Architecture and key decisions | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |",
    "| What is being built next | [`docs/TASKS.md`](docs/TASKS.md) |",
    "| How the tooling in `scripts/` works | [`docs/AGENT-READY.md`](docs/AGENT-READY.md) |",
    "| The licence that tooling came with — keep it beside `scripts/` | [`docs/AGENT-READY-LICENSE`](docs/AGENT-READY-LICENSE) |",
    "",
  ].join("\n");
}

/**
 * Personalise a fresh copy. Returns `{ skipped, changed }`; `changed` lists the
 * files rewritten. Safe to call repeatedly — it does nothing once the project
 * has been personalised, and nothing at all in agent-ready itself.
 */
export function personalize({ root = ROOT } = {}) {
  const changed = [];
  if (isAgentReadyItself(root)) {
    return { skipped: "this IS agent-ready (package.json still has the placeholder name)", changed };
  }
  const pkgPath = join(root, "package.json");
  const raw = existsSync(pkgPath) ? readFileSync(pkgPath, "utf8") : null;
  const pkg = raw ? readJson(pkgPath) : null;
  if (!pkg?.vibe?.pristine) {
    return { skipped: "already personalised", changed };
  }

  // 1. Start this project's version history at 0.1.0. Targeted replacement, so
  //    package.json keeps its formatting exactly as `version.mjs` would leave it.
  if (pkg.version !== FRESH_VERSION) {
    const next = raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${FRESH_VERSION}"`);
    if (writeIfChanged(pkgPath, next)) changed.push(`package.json (version → ${FRESH_VERSION})`);
  }

  // 2. Keep agent-ready's README as tooling documentation, and give the project
  //    a README about itself. Guarded by the marker: a README someone has
  //    already written is never touched.
  const readmePath = join(root, "README.md");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
  if (readme.includes(OWN_README_MARKER)) {
    const keptPath = join(root, KEPT_AS);
    mkdirSync(dirname(keptPath), { recursive: true });
    if (writeIfChanged(keptPath, readme)) changed.push(`${KEPT_AS.split("\\").join("/")} (agent-ready's docs kept here)`);
    if (writeIfChanged(readmePath, projectReadme(pkg))) changed.push("README.md (now describes this project)");
  }

  // 3. Keep agent-ready's licence with the tooling it covers, and leave the
  //    root for the licence the owner picks for THIS project.
  const licensePath = join(root, "LICENSE");
  const license = existsSync(licensePath) ? readFileSync(licensePath, "utf8") : "";
  if (OWN_LICENSE.test(license)) {
    writeIfChanged(join(root, LICENSE_KEPT_AS), license);
    rmSync(licensePath);
    changed.push(`LICENSE (agent-ready's, kept as ${LICENSE_KEPT_AS.split("\\").join("/")}; choose your own)`);
  }

  // 4. A guide to contributing to agent-ready has no place in a project.
  const contributingPath = join(root, "CONTRIBUTING.md");
  if (existsSync(contributingPath) && readFileSync(contributingPath, "utf8").includes(OWN_CONTRIBUTING_MARKER)) {
    rmSync(contributingPath);
    changed.push("CONTRIBUTING.md (agent-ready's, removed)");
  }

  return { skipped: null, changed };
}

function main(argv = []) {
  // It took no arguments at all, so anything typed at it disappeared without
  // comment — including a `--force` somebody might reasonably expect to exist.
  const { problems } = parseFlags(argv, { known: [] });
  if (problems.length) {
    write(`${problems.join("; ")} — personalize takes no flags`);
    return 2;
  }
  const { skipped, changed } = personalize();
  if (skipped) {
    note(`nothing to do — ${skipped}.`);
    return 0;
  }
  if (!changed.length) {
    note("already personalised.");
    return 0;
  }
  for (const c of changed) note(`updated ${c}`);
  note(`agent-ready's own README is now ${KEPT_AS.split("\\").join("/")} — it documents scripts/.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
