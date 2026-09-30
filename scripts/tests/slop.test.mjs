// The anti-slop comment check: the detector, its config, the gate's CLI and the editor hook.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { commentStyle, globToRegExp, longComments, slopConfig } from "../lib/slop.mjs";
import { at } from "../lib/util.mjs";
import { findSlop } from "../slop-check.mjs";
import { slopReason } from "../slop-guard.mjs";

const dir = mkdtempSync(join(tmpdir(), "slop-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const lines = (...l) => l.join("\n");
const JS = commentStyle("a.js");
const comments = (n, prefix = "//") => Array.from({ length: n }, (_, i) => `${prefix} line ${i + 1}`);

describe("longComments", () => {
  it("allows three comment lines and flags four, from the block's first line", () => {
    assert.deepEqual(longComments(lines(...comments(3), "code();"), JS), []);
    assert.deepEqual(longComments(lines("code();", ...comments(4), "code();"), JS), [{ line: 2, lines: 4 }]);
  });

  it("ends a block at a blank line or a line of code", () => {
    assert.deepEqual(longComments(lines(...comments(2), "", ...comments(2)), JS), []);
    assert.deepEqual(longComments(lines(...comments(3), "x();", ...comments(3)), JS), []);
  });

  it("counts the content of a block comment, not its frame", () => {
    assert.deepEqual(longComments(lines("/**", " * a", " * b", " * c", " */", "f();"), JS), []);
    assert.deepEqual(longComments(lines("/**", " * a", " * b", " * c", " * d", " */"), JS), [{ line: 1, lines: 4 }]);
    assert.deepEqual(longComments(lines("/* one-liner */", "f();"), JS), []);
  });

  it("does not count a trailing comment after code", () => {
    assert.deepEqual(longComments(lines(...Array(5).fill("f(); // why")), JS), []);
  });

  it("knows hash and dash languages, and skips a shebang", () => {
    assert.deepEqual(longComments(lines("#!/bin/sh", ...comments(3, "#"), "echo"), commentStyle("hook")), []);
    assert.equal(longComments(lines(...comments(4, "#")), commentStyle("x.py")).length, 1);
    assert.equal(longComments(lines(...comments(4, "--")), commentStyle("q.sql")).length, 1);
    assert.equal(longComments(lines(...comments(4, "#")), commentStyle("Dockerfile")).length, 1);
  });

  it("leaves languages it does not know alone", () => {
    assert.equal(commentStyle("README.md"), null);
    assert.equal(commentStyle("data.json"), null);
  });
});

describe("configuration", () => {
  it("matches ignore globs within and across folders", () => {
    assert.ok(globToRegExp("vendor/**").test("vendor/a/b.js"));
    assert.ok(globToRegExp("*.min.js").test("app.min.js"));
    assert.ok(!globToRegExp("src/*.ts").test("src/deep/a.ts"));
  });

  it("reads vibe.slop, falling back to three lines", () => {
    const pkg = join(dir, "config.json");
    writeFileSync(pkg, JSON.stringify({ vibe: { slop: { maxCommentLines: 5, ignore: ["legacy/**"] } } }));
    const config = slopConfig(pkg);
    assert.equal(config.maxCommentLines, 5);
    assert.ok(config.ignore[0].test("legacy/old.js"));
    writeFileSync(pkg, JSON.stringify({ vibe: { slop: { maxCommentLines: "lots" } } }));
    assert.equal(slopConfig(pkg).maxCommentLines, 3);
  });
});

describe("the gate check and the editor hook", () => {
  const project = join(dir, "project");
  mkdirSync(join(project, "legacy"), { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ vibe: { slop: { ignore: ["legacy/**"] } } }));
  writeFileSync(join(project, "long.js"), lines(...comments(5), "f();"));
  writeFileSync(join(project, "short.js"), lines("// fine", "f();"));
  writeFileSync(join(project, "legacy", "old.js"), lines(...comments(9), "f();"));

  it("reports long comments with file and line, and skips ignored paths", () => {
    const { hits } = findSlop(["long.js", "short.js", "legacy/old.js"], project);
    assert.deepEqual(hits, [{ file: "long.js", line: 1, lines: 5 }]);
  });

  it("gives the editor hook a reason naming the file and line", () => {
    const reason = slopReason({ tool_input: { file_path: join(project, "long.js") } }, project);
    assert.match(reason, /long\.js:1 — 5-line comment \(max 3\)/);
    assert.equal(slopReason({ tool_input: { file_path: join(project, "short.js") } }, project), null);
    assert.equal(slopReason({ tool_input: { file_path: join(project, "missing.js") } }, project), null);
    assert.equal(slopReason({ tool_input: {} }, project), null);
  });

  it("prints a PostToolUse block decision when run as the hook", () => {
    const run = (input) => spawnSync(process.execPath, [at("scripts", "slop-guard.mjs")], { input, encoding: "utf8" });
    const long = join(dir, "hook-long.js");
    writeFileSync(long, lines(...comments(6), "f();"));
    const out = JSON.parse(run(JSON.stringify({ tool_input: { file_path: long } })).stdout);
    assert.equal(out.decision, "block");
    assert.match(out.reason, /6-line comment/);
    assert.equal(run("not json").stdout, "");
  });
});

describe("the wiring", () => {
  it("runs slop-guard after every Edit and Write, from the project root", () => {
    const settings = JSON.parse(readFileSync(at(".claude", "settings.json"), "utf8"));
    const [guard] = (settings.hooks?.PostToolUse ?? []).filter((g) => g.matcher === "Edit|Write").flatMap((g) => g.hooks);
    assert.equal(guard?.command, "node");
    assert.deepEqual(guard.args, ["${CLAUDE_PROJECT_DIR}/scripts/slop-guard.mjs"]);
    assert.ok(existsSync(guard.args[0].replace("${CLAUDE_PROJECT_DIR}", at("."))));
  });

  it("lists slop first in every gate run", () => {
    const r = spawnSync(process.execPath, [at("scripts", "gate.mjs"), "--list"], { encoding: "utf8" });
    const listed = r.stderr.split("\n").filter((l) => /^\s{2}\S/.test(l));
    assert.match(listed[0], /^\s+slop\s+node scripts\/slop-check\.mjs/);
  });
});
