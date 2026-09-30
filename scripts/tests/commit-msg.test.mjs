// Guards .githooks/commit-msg, the tool-agnostic net that keeps agents out of the contributor list.
// What it must NOT delete matters as much as what it must.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { at } from "../lib/util.mjs";

const HOOK = at(".githooks", "commit-msg");
const trash = [];
after(() => trash.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Run the hook over a message and return what it left behind. */
function run(message) {
  const dir = mkdtempSync(join(tmpdir(), "vibe-msg-"));
  trash.push(dir);
  const file = join(dir, "COMMIT_EDITMSG");
  writeFileSync(file, message);
  const r = spawnSync("sh", [HOOK, file], { encoding: "utf8" });
  return { out: readFileSync(file, "utf8"), status: r.status, error: r.error };
}

describe("commit-msg strips agent attribution", () => {
  it("removes bot co-authors, session trailers and the generated-with line", () => {
    const { out, error } = run(
      [
        "feat: a real change",
        "",
        "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>",
        "Co-authored-by: Cursor Agent <cursoragent@cursor.com>",
        "Co-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>",
        "Claude-Session: https://claude.ai/code/session_abc",
        "",
        "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
        "",
      ].join("\n"),
    );
    if (error) return; // no POSIX shell on this machine
    assert.doesNotMatch(out, /anthropic\.com/);
    assert.doesNotMatch(out, /cursor\.com/);
    assert.doesNotMatch(out, /Copilot@/);
    assert.doesNotMatch(out, /Claude-Session/);
    assert.doesNotMatch(out, /Generated with \[Claude Code\]/);
    assert.match(out, /^feat: a real change/);
  });

  it("removes EVERY co-author line, not only an agent's", () => {
    // One author per commit: telling agents from people by name ("Amp" in "example.com") or bot list is unreliable.
    const { out, error } = run(
      [
        "fix: something",
        "",
        "Co-authored-by: A Person <person@example.test>",
        "Co-authored-by: Some Agent <noreply@anthropic.com>",
        "",
      ].join("\n"),
    );
    if (error) return;
    assert.doesNotMatch(out, /Co-authored-by:/i, "no co-author trailer may survive");
    assert.match(out, /^fix: something/);
  });

  it("leaves prose that merely discusses attribution alone", () => {
    // The hook is anchored at line start, so a body that mentions these trailers is never rewritten.
    const body = 'Explains how "Generated with Claude Code" and Co-authored-by: appear in commits.';
    const { out, error } = run(`docs: explain attribution\n\n${body}\n`);
    if (error) return;
    assert.match(out, /Generated with Claude Code/);
    assert.match(out, /Co-authored-by:/);
  });

  it("never blanks a message, and never fails a commit", () => {
    const only = run("Co-Authored-By: Claude <noreply@anthropic.com>\n");
    if (only.error) return;
    assert.equal(only.status, 0);
    assert.ok(only.out.trim().length > 0, "a message reduced to nothing must be left as it was");

    const missing = spawnSync("sh", [HOOK, join(tmpdir(), "definitely-not-here")], { encoding: "utf8" });
    if (!missing.error) assert.equal(missing.status, 0, "a missing message file must not block a commit");
  });

  it("trims the blank lines the removed trailers leave behind", () => {
    const { out, error } = run(
      ["feat: x", "", "body", "", "Co-Authored-By: Claude <noreply@anthropic.com>", "", ""].join("\n"),
    );
    if (error) return;
    assert.equal(out, "feat: x\n\nbody\n");
  });
});
