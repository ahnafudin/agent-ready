#!/usr/bin/env node
// scripts/check-attribution.mjs — CI check that fails when a commit carries an attribution trailer.
// It backs up the commit-msg hook, which a fresh or --ignore-scripts clone may not have installed.
// The rule is the hook's own PATTERN line, read at run time, so the hook and this check cannot drift.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { at, note as write, parseFlags } from "./lib/util.mjs";

const note = (msg) => write(msg, "[attribution] ");

/** The hook's PATTERN value; throws when missing, so a check that cannot find its rule never passes. */
export function hookRule(hookSource) {
  const m = /^PATTERN="(.+)"\s*$/m.exec(hookSource);
  if (!m) throw new Error('cannot find the PATTERN="…" line in .githooks/commit-msg');
  return m[1];
}

/** The hook's POSIX ERE as a JS regexp: `[[:space:]]` is the only construct JS lacks. */
export function attributionRe(ere) {
  return new RegExp(ere.replace(/\[\[:space:\]\]/g, "[ \\t]"), "iu");
}

/** Offending lines in one message, empty when it is clean. */
export function offendingLines(message, re) {
  return message.split("\n").filter((line) => re.test(line));
}

// One `git log` for the whole range, since this runs on every push.
// \x1e separates fields and \x1f records: neither can occur in a commit message.
function commits(range) {
  let out;
  try {
    out = execFileSync("git", ["log", "--format=%H%x1e%s%x1e%B%x1f", ...(range ? [range] : [])], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    // Report git's own first line (no repo, bad --range, empty history), not a stack trace.
    const reason = (err.stderr ?? "").toString().trim().split("\n")[0] || err.message;
    throw new Error(`git log failed: ${reason}`);
  }
  return out
    .split("\x1f")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, subject, message] = record.split("\x1e");
      return { sha, subject, message: message ?? "" };
    });
}

function main(argv) {
  const { flags, problems } = parseFlags(argv, { known: ["--quiet"], valued: ["--range"] });
  if (problems.length) {
    note(problems.join("; "));
    note("usage: check-attribution.mjs [--range A..B] [--quiet]");
    return 2;
  }

  let re;
  try {
    re = attributionRe(hookRule(readFileSync(at(".githooks", "commit-msg"), "utf8")));
  } catch (err) {
    note(`cannot read the rule: ${err.message}`);
    return 2;
  }

  // A brand-new branch pushes with a null "before" SHA; a range built from it is
  // meaningless, so the caller passes nothing and every commit is checked.
  let all;
  try {
    all = commits(flags.get("--range"));
  } catch (err) {
    note(err.message);
    return 2;
  }
  const bad = all
    .map((c) => ({ ...c, lines: offendingLines(c.message, re) }))
    .filter((c) => c.lines.length);

  if (bad.length) {
    note(`${bad.length} of ${all.length} commit(s) carry an attribution trailer:`);
    for (const { sha, subject, lines } of bad) {
      note(`  ${sha.slice(0, 8)} ${subject}`);
      for (const line of lines) note(`      ${line.trim()}`);
    }
    note("");
    note("A Co-authored-by trailer adds that account to this repository's");
    note("GitHub contributor list. This project's commits have one author.");
    note("Install the hook so it cannot happen again:  npm run hooks:install");
    note("Then rewrite the messages before anyone clones — while it is still cheap:");
    note("  git rebase -i --root   (or git filter-repo --message-callback …)");
    return 1;
  }

  if (!flags.has("--quiet")) note(`clean: no attribution trailers in ${all.length} commit(s)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
