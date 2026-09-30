// The read guard denies an unbounded Read of a long file and nothing else: the threshold, the way through,
// fail-open, and the wiring in .claude/settings.json.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { countLines, DEFAULT_MAX_LINES, maxLinesFrom, refusal } from "../read-guard.mjs";
import { at } from "../lib/util.mjs";

const dir = mkdtempSync(join(tmpdir(), "read-guard-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A file of exactly `n` lines, each ending in a newline. */
function fileOf(n, name = `lines-${n}.txt`) {
  const path = join(dir, name);
  writeFileSync(path, "x\n".repeat(n));
  return path;
}

const read = (file_path, extra = {}) => ({ tool_name: "Read", tool_input: { file_path, ...extra } });

describe("refusal", () => {
  it("denies an unbounded Read over the threshold, naming the count and the way through", () => {
    const reason = refusal(read(fileOf(DEFAULT_MAX_LINES + 1)));
    assert.match(reason, new RegExp(`has ${DEFAULT_MAX_LINES + 1} lines`));
    assert.match(reason, new RegExp(`offset: 1, limit: ${DEFAULT_MAX_LINES + 1}`));
  });

  it("lets a file of exactly the threshold through", () => {
    assert.equal(refusal(read(fileOf(DEFAULT_MAX_LINES))), null);
  });

  it("lets any size through once offset or limit is given", () => {
    const big = fileOf(5000);
    assert.equal(refusal(read(big, { limit: 200 })), null);
    assert.equal(refusal(read(big, { offset: 1 })), null);
    assert.equal(refusal(read(big, { offset: 0 })), null, "offset 0 is still an explicit window");
  });

  it("never judges another tool", () => {
    const big = fileOf(5000);
    assert.equal(refusal({ tool_name: "Grep", tool_input: { path: big } }), null);
    assert.equal(refusal({ tool_name: "Edit", tool_input: { file_path: big } }), null);
  });

  it("lets the Read proceed whenever it cannot judge", () => {
    assert.equal(refusal(read(join(dir, "missing.txt"))), null, "a missing file is Read's error to report");
    assert.equal(refusal(read(fileOf(5000, "scan.pdf"))), null, "a PDF is paged, not counted in lines");
    assert.equal(refusal({ tool_name: "Read", tool_input: {} }), null);
    assert.equal(refusal(null), null);
  });

  it("resolves a relative path against the payload's cwd", () => {
    fileOf(5000, "relative.txt");
    assert.match(refusal({ ...read("relative.txt"), cwd: dir }), /has 5000 lines/);
  });

  it("honours a lower threshold", () => {
    assert.match(refusal(read(fileOf(50)), { maxLines: 10 }), /more than 10/);
  });
});

describe("countLines", () => {
  const write = (name, text) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };

  it("counts like an editor: a final newline ends a line, it does not start one", () => {
    assert.equal(countLines(write("a.txt", "a\nb\n")), 2);
    assert.equal(countLines(write("b.txt", "a\nb")), 2);
    assert.equal(countLines(write("c.txt", "a\r\nb\r\n")), 2);
    assert.equal(countLines(write("d.txt", "")), 0);
  });

  it("returns null for a file it cannot read", () => {
    assert.equal(countLines(join(dir, "nope.txt")), null);
    assert.equal(countLines(dir), null, "a directory");
  });
});

describe("maxLinesFrom", () => {
  it("takes a positive integer and falls back on anything else", () => {
    assert.equal(maxLinesFrom({}), DEFAULT_MAX_LINES);
    assert.equal(maxLinesFrom({ READ_GUARD_MAX_LINES: "600" }), 600);
    // A NaN threshold would make `lines <= max` false for every file and deny
    // them all — the one misconfiguration that turns the guard into a wall.
    for (const bad of ["abc", "0", "-5", "12.5", ""]) {
      assert.equal(maxLinesFrom({ READ_GUARD_MAX_LINES: bad }), DEFAULT_MAX_LINES, bad);
    }
  });
});

describe("the script as the hook runs it", () => {
  const run = (input, env = {}) =>
    spawnSync(process.execPath, [at("scripts", "read-guard.mjs")], {
      input,
      encoding: "utf8",
      env: { ...process.env, READ_GUARD_MAX_LINES: "", ...env },
    });

  it("prints a PreToolUse deny for a long file", () => {
    const r = run(JSON.stringify(read(fileOf(DEFAULT_MAX_LINES + 1))));
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.hookEventName, "PreToolUse");
    assert.equal(out.permissionDecision, "deny");
    assert.match(out.permissionDecisionReason, /read-guard:/);
  });

  it("prints nothing and exits 0 for anything it lets through", () => {
    for (const input of ["not json", "", JSON.stringify(read(fileOf(3)))]) {
      const r = run(input);
      assert.equal(r.status, 0, input);
      assert.equal(r.stdout, "", input);
    }
  });

  it("reads the threshold from the environment", () => {
    const r = run(JSON.stringify(read(fileOf(20))), { READ_GUARD_MAX_LINES: "10" });
    assert.match(r.stdout, /more than 10/);
  });
});

describe("the wiring in .claude/settings.json", () => {
  const settings = JSON.parse(readFileSync(at(".claude", "settings.json"), "utf8"));
  const guards = (settings.hooks?.PreToolUse ?? [])
    .filter((g) => g.matcher === "Read")
    .flatMap((g) => g.hooks);

  it("runs the guard on every Read", () => {
    assert.equal(guards.length, 1, "exactly one Read guard");
  });

  it("reaches the script from the project root, not the current directory", () => {
    // Hooks run in the agent's current directory, so a relative path silently loses the guard after a `cd`.
    const [guard] = guards;
    assert.equal(guard.command, "node", "exec form: no shell has to parse the path");
    assert.deepEqual(guard.args, ["${CLAUDE_PROJECT_DIR}/scripts/read-guard.mjs"]);
    const script = guard.args[0].replace("${CLAUDE_PROJECT_DIR}", at("."));
    assert.ok(existsSync(script), `the hook points at ${script}, which does not exist`);
  });
});
