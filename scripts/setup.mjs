#!/usr/bin/env node
// scripts/setup.mjs — idempotent, fail-soft project bootstrap. Order matters: hooks go first so
// `bd init` chains them, and steps 2–4 leave changes unstaged because `bd init` commits the index.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  at,
  git,
  isUnrenamed,
  norm,
  note as write,
  PLACEHOLDER_NAME,
  readJson,
  ROOT,
  runTool,
  safeDirectoryHint,
  tryRun,
} from "./lib/util.mjs";

function step(msg) {
  process.stderr.write(`\n[setup] ${msg}\n`);
}
const note = (msg) => write(msg, "  ");

/** Show what a sub-script said; our scripts report on stderr, not stdout. */
function relay(result, fallback = "done") {
  const text = [result.err, result.ok ? "" : result.out].filter(Boolean).join("\n").trim();
  for (const line of (text || fallback).split(/\r?\n/)) note(line);
}

/** bd may be a Windows shim; runTool knows how to launch it. */
const bd = (...args) => runTool("bd", args);

// 0. This folder must be the git toplevel, or every later step acts on a parent repository.
const toplevel = git(["rev-parse", "--show-toplevel"]);
if (!toplevel.ok) {
  if (toplevel.dubious) {
    // Never suggest `git init` here: the repo exists, and a second one would be scaffolded over it.
    step("git refuses to read this repository: it is owned by a different user account.");
    note("The repo is fine — this is an ownership check, not a missing .git. Run:");
    note(`  ${safeDirectoryHint()}`);
    note("then re-run `npm run setup`.");
  } else {
    step("not a git repository — run `git init` first, then re-run `npm run setup`.");
  }
  process.exit(1);
}
if (norm(toplevel.out) !== norm(ROOT)) {
  step(`this folder sits inside another repository (${toplevel.out}).`);
  note("run `git init` here first if this is meant to be its own repo, then re-run `npm run setup`.");
  process.exit(1);
}

// 1. git hooks (auto-version)
step("1/7 git hooks (auto-version)");
relay(tryRun(process.execPath, [at("scripts", "install-hooks.mjs")]));

// 2. personalise a pristine copy: version → 0.1.0, project README.
step("2/7 personalise this copy");
relay(tryRun(process.execPath, [at("scripts", "personalize.mjs")]));

// 3. stack detection → tooling.gates + .gitignore block + docs/STACK.md
step("3/7 framework detection");
relay(tryRun(process.execPath, [at("scripts", "stacks.mjs"), "apply"]));
note("re-run any time with `npm run stack:apply` (`npm run stack:reapply` overwrites hand-tuned gates).");

// 4. agent instruction pointers (AGENTS.md → per-tool stubs)
step("4/7 agent instruction files");
relay(tryRun(process.execPath, [at("scripts", "sync-agents.mjs")]));

// 5. beads workspace
step("5/7 beads (bd) issue tracker");
let beadsReady = false;
const bdVersion = bd("version");
if (!bdVersion.ok) {
  note("bd not found — skipping the beads steps (everything above is already done).");
  note("bd is OPTIONAL. To add it later, install the official release binary:");
  note("  https://github.com/gastownhall/beads  (or `brew install beads`)");
  note("Avoid CGO-less `go install` builds — embedded Dolt refuses to open with them.");
  note("Then re-run `npm run setup`.");
} else if (isUnrenamed()) {
  // `bd init` commits the project identity; on the placeholder name every copy would inherit it.
  note(`package.json is still named "${PLACEHOLDER_NAME}" — skipping \`bd init\` on purpose.`);
  note("bd bakes the project name into the issue prefix and commits .beads/ (identity +");
  note("sync remote), so initializing before renaming would ship this workspace to every");
  note("copy of the repo. Rename the project, then re-run `npm run setup`.");
} else {
  note(bdVersion.out);
  // `bd where` walks up ancestor directories, so the reported workspace must be exactly ours.
  const where = bd("where");
  const reportedWs = where.ok ? (where.out.split(/\r?\n/)[0] ?? "").trim() : "";
  const ownWs = at(".beads");
  const isOwnWorkspace = where.ok && reportedWs && norm(reportedWs) === norm(ownWs);

  if (isOwnWorkspace) {
    note("workspace already active — skipping `bd init`.");
  } else {
    if (where.ok && reportedWs) {
      note(`note: an ANCESTOR beads workspace exists at ${reportedWs} — this project still gets its own.`);
    }
    if (existsSync(join(ownWs, "config.yaml"))) {
      // Second machine / fresh clone: the config is committed, only the local DB
      // is missing — bootstrap it, never re-init.
      const boot = bd("bootstrap");
      if (!boot.ok) {
        note(`bd bootstrap failed:\n${boot.out}`);
        note("fix the error above and re-run `npm run setup` (do NOT run `bd init` — the");
        note("workspace config is already committed).");
        process.exit(1);
      }
      note("bootstrapped the local DB from the committed .beads config.");
    } else {
      // Brand-new project. GUARD: `bd init` auto-commits everything staged.
      if (!tryRun("git", ["diff", "--cached", "--quiet"]).ok) {
        note("ABORT: you have STAGED changes, and `bd init` auto-commits everything staged.");
        note("Commit or unstage them first, then re-run `npm run setup`.");
        process.exit(1);
      }
      const init = bd("init", "--quiet", "--skip-agents");
      if (!init.ok) {
        note(`bd init failed:\n${init.out}`);
        note("If the error mentions CGO: this bd build lacks embedded Dolt — install the");
        note("official release binary (or use `bd init --proxied-server`).");
        process.exit(1);
      }
      note("initialized (embedded Dolt; --skip-agents so it cannot overwrite AGENTS.md).");
    }
  }
  beadsReady = true;
}

// 6. Claude Code hooks. Check our own settings, not `bd setup claude --check`: it only matches
// a literal `bd prime`, so trusting it would replace the guarded wrapper on every run.
step("6/7 Claude Code integration");
const settings = readJson(at(".claude", "settings.json"));
const wrapperInstalled = JSON.stringify(settings?.hooks ?? {}).includes("bd-prime.mjs");
if (wrapperInstalled) {
  note("guarded priming hook already installed (.claude/settings.json → scripts/bd-prime.mjs).");
  note("`bd setup claude --check` will still say 'not installed' — it matches a literal");
  note("`bd prime`. That is expected; do NOT run `bd setup claude` to 'fix' it, or a machine");
  note("without bd goes back to opening every session with an error in context.");
} else {
  const claudeSetup = bd("setup", "claude");
  note(claudeSetup.ok ? "installed (SessionStart/PreCompact → bd prime)." : `skipped: ${claudeSetup.out}`);
  note("NOTE: `bd setup claude` may insert its own managed block into CLAUDE.md; the");
  note('"Beads Issue Tracker" section of AGENTS.md OVERRIDES it wherever they conflict.');
}

// 7. Dolt sync remote (per machine — it lives in the local DB, not in git)
step("7/7 beads sync remote");
if (!beadsReady) {
  note("no beads workspace yet — nothing to point at a remote.");
  finish();
}
const origin = git(["remote", "get-url", "origin"]);
if (!origin.ok) {
  note("no git `origin` yet — after you add one, run:");
  note('  bd dolt remote add origin "$(git remote get-url origin)"');
} else {
  const remotes = bd("dolt", "remote", "list");
  if (remotes.ok && /(^|\s)origin(\s|$)/m.test(remotes.out)) {
    note("dolt remote `origin` already configured.");
  } else {
    // `runTool` refuses a URL a Windows shell would reinterpret, so this step
    // can fail for a good reason — always show the manual fallback when it does.
    const add = bd("dolt", "remote", "add", "origin", origin.out);
    if (add.ok) {
      note(`dolt remote → ${origin.out}`);
    } else {
      note(`skipped: ${add.out}`);
      note(`add it yourself:  bd dolt remote add origin "${origin.out}"`);
    }
  }
}

finish();

function finish() {
  step("done.");
  note("Next: fill the TODO:fill sections in AGENTS.md and docs/ (checklist in SETUP.md).");
  note("Check the detected stack in docs/STACK.md, then verify with `npm run gate`.");
  process.exit(0);
}
