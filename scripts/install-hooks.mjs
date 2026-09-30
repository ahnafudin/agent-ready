#!/usr/bin/env node
// scripts/install-hooks.mjs — makes every hook in .githooks/ the one git actually runs; idempotent, fail-soft.
// `bd init` runs hooks from COPIES in .beads/hooks, which go stale, so those are kept in sync.
// Never touches a foreign hook manager, a parent repo, or a hook that is not ours.

import { chmodSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { at, git, hooksDirFor, norm, note as write, parseFlags, ROOT, safeDirectoryHint, writeIfChanged } from "./lib/util.mjs";

const HOOK_DIR = at(".githooks");
/** Present in every hook agent-ready owns, so a foreign one is never clobbered. */
const MARKER = "vibe:hook";

const note = (msg) => write(msg, "[hooks] ");

// `--check` writes nothing; it fails the lint gate when the copy git runs has fallen behind .githooks/.
const { flags, problems } = parseFlags(process.argv.slice(2), { known: ["--check"] });
if (problems.length) {
  note(problems.join("; "));
  note("usage: install-hooks.mjs [--check]");
  process.exit(2);
}
const CHECK = flags.has("--check");
let outOfDate = 0;

const toplevel = git(["rev-parse", "--show-toplevel"]);
if (!toplevel.ok) {
  if (toplevel.dubious) {
    note("git refuses to read this repository: it is owned by a different user account.");
    note("This is NOT a missing repo — do not run `git init`. Fix the ownership exception:");
    note(`  ${safeDirectoryHint()}`);
    note("then re-run `npm run setup`.");
  } else {
    note("not a git work tree — skipping hook install");
  }
  process.exit(0);
}

if (norm(toplevel.out) !== norm(ROOT)) {
  note(`this folder sits inside another repository (${toplevel.out}) — skipping hook install`);
  note("run `git init` here first if this is meant to be its own repo, then `npm run setup`.");
  process.exit(0);
}

if (!existsSync(HOOK_DIR)) {
  note(".githooks/ missing — nothing to install");
  process.exit(0);
}

const ours = readdirSync(HOOK_DIR).filter((f) => !f.startsWith("."));
if (ours.length === 0) {
  note(".githooks/ is empty — nothing to install");
  process.exit(0);
}

const current = git(["config", "--get", "core.hooksPath"]);
const hooksPath = current.ok ? current.out : "";

/** Copy our hooks into the directory git actually reads, when that is not ours. */
function syncInto(dir, label) {
  const added = [];
  const refreshed = [];
  const foreign = [];
  for (const name of ours) {
    const source = readFileSync(join(HOOK_DIR, name), "utf8");
    const target = join(dir, name);
    const existing = existsSync(target) ? readFileSync(target, "utf8") : null;
    // `version.mjs` recognises the copy bd made of our post-commit BEFORE the
    // marker existed, so an already-set-up repo migrates instead of stalling.
    const isOurs = existing === null || existing.includes(MARKER) || existing.includes("version.mjs");
    if (!isOurs) {
      foreign.push(name); // somebody else's hook of the same name — leave it alone
      continue;
    }
    if (existing === source) continue;
    (existing === null ? added : refreshed).push(name);
    if (CHECK) outOfDate++;
    else writeIfChanged(target, source);
  }
  if (added.length) note(`${label}: ${CHECK ? "MISSING" : "installed"} ${added.join(", ")}`);
  if (refreshed.length) {
    note(`${label}: ${CHECK ? "STALE copy of" : "refreshed a stale copy of"} ${refreshed.join(", ")}`);
  }
  if (foreign.length) {
    note(`WARNING: ${label} already has a different ${foreign.join(", ")} — left untouched.`);
    note(`Merge .githooks/${foreign[0]} into it by hand if you want both to run.`);
  }
  if (!added.length && !refreshed.length && !foreign.length) note(`${label}: all hooks current`);
}

if (hooksPath === ".githooks") {
  note(`already installed (core.hooksPath=.githooks; ${ours.join(", ")})`);
} else if (hooksPath.endsWith(".beads/hooks") || hooksPath.endsWith(".beads\\hooks")) {
  syncInto(hooksDirFor(hooksPath), `beads owns the chain (${hooksPath})`);
} else if (hooksPath) {
  note(`core.hooksPath is already "${hooksPath}" (another hook manager?) — not overwriting.`);
  note("to enable agent-ready's hooks manually: git config core.hooksPath .githooks");
} else {
  if (CHECK) {
    // Not installed is not drift: a CI checkout that never ran postinstall must pass the gate.
    note("hooks are not installed here (core.hooksPath unset) — nothing to compare");
  } else {
    const set = git(["config", "core.hooksPath", ".githooks"]);
    note(set.ok ? `installed: core.hooksPath → .githooks (${ours.join(", ")})` : `install skipped: ${set.out}`);
  }
}

// Best-effort exec bit (required on POSIX; a no-op on Windows).
for (const name of ours) {
  try {
    chmodSync(join(HOOK_DIR, name), 0o755);
  } catch {
    /* ignore — Windows / restricted FS */
  }
}

if (CHECK) {
  if (outOfDate) {
    note(`${outOfDate} hook(s) git runs are not what .githooks/ says — run \`npm run hooks:install\``);
    process.exit(1);
  }
  note("the hooks git runs match .githooks/");
}
