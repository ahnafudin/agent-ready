// Two generators, one file.
//
// `agents:sync` rewrites its pointer files wholesale, which was fine while it
// was the only tool writing them. It is not: the anti-slop installer fences a
// region into GEMINI.md (and CLAUDE.md, and AGENTS.md) between
// `antislop:start` / `antislop:end` markers, and bd writes a BEGIN/END block of
// its own. Before this, installing either one broke `npm run gate` — the
// pointer file no longer matched what the generator produces — and the fix the
// error message suggested, `npm run agents:sync`, deleted the other tool's work.
//
// So the rule is: this repo owns the GENERATED part of those files, not the
// whole file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { at, foreignBlocks, withForeignBlocks } from "../lib/util.mjs";
import { renderStub, sync, TARGETS } from "../sync-agents.mjs";

const ANTISLOP = ["<!-- antislop:start -->", "- **antislop** — core rules.", "<!-- antislop:end -->"].join("\n");
const BEADS = ["<!-- BEGIN BEADS INTEGRATION -->", "bd ready", "<!-- END BEADS INTEGRATION -->"].join("\n");

describe("foreignBlocks", () => {
  it("finds a start/end block", () => {
    const found = foreignBlocks(`# Title\n\n${ANTISLOP}\n`);
    assert.equal(found.length, 1);
    assert.equal(found[0].name, "antislop");
    assert.equal(found[0].text, ANTISLOP);
  });

  it("finds a BEGIN/END block", () => {
    const found = foreignBlocks(`# Title\n\n${BEADS}\n`);
    assert.equal(found.length, 1);
    assert.equal(found[0].text, BEADS);
  });

  it("keeps two tools' blocks separate, in the order they appear", () => {
    // The end marker is back-referenced to its own name, so one tool's opening
    // marker can never swallow another tool's block by closing against its end.
    const found = foreignBlocks(`${ANTISLOP}\n\n${BEADS}\n`);
    assert.deepEqual(
      found.map((b) => b.text),
      [ANTISLOP, BEADS],
    );
  });

  it("ignores a lone comment and an unclosed marker", () => {
    assert.deepEqual(foreignBlocks("<!-- just a comment -->"), []);
    assert.deepEqual(foreignBlocks("<!-- antislop:start -->\nno end marker\n"), []);
  });

  it("returns nothing for an empty or missing file", () => {
    assert.deepEqual(foreignBlocks(null), []);
    assert.deepEqual(foreignBlocks(""), []);
  });
});

describe("withForeignBlocks", () => {
  it("leaves a file nobody else touched byte-identical", () => {
    // Untouched files must not churn: otherwise every `agents:sync` would show
    // seven modified files in `git status` and nobody would read the diff.
    const stub = renderStub(TARGETS[0]);
    assert.equal(withForeignBlocks(stub, []), stub);
  });

  it("appends the foreign block after the generated part", () => {
    const stub = renderStub(TARGETS[0]);
    const out = withForeignBlocks(stub, foreignBlocks(`${stub}\n${ANTISLOP}\n`));
    assert.ok(out.includes(ANTISLOP), "the other tool's block was dropped");
    assert.ok(out.startsWith(stub.trimEnd()), "the generated part must stay first and intact");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const stub = renderStub(TARGETS[0]);
    const once = withForeignBlocks(stub, foreignBlocks(`${stub}\n${ANTISLOP}\n`));
    const twice = withForeignBlocks(stub, foreignBlocks(once));
    assert.equal(twice, once);
  });

  it("never treats the generator's own output as foreign", () => {
    // The bug this pins was self-inflicted: the stub's banner explained the
    // feature by SHOWING the marker syntax, that example was read back as a real
    // block, and the file grew three lines on every run. Prose describing a
    // marker is not a block, whoever wrote it.
    const stub = `${renderStub(TARGETS[0])}\n${ANTISLOP}\n`;
    assert.equal(withForeignBlocks(stub, foreignBlocks(stub)), stub);
  });

  it("carries several tools' blocks across together", () => {
    const stub = renderStub(TARGETS[0]);
    const out = withForeignBlocks(stub, foreignBlocks(`${stub}\n${ANTISLOP}\n\n${BEADS}\n`));
    assert.ok(out.includes(ANTISLOP));
    assert.ok(out.includes(BEADS));
  });
});

describe("sync() on a real pointer file", () => {
  // The unit tests above prove the pieces. This proves they are actually wired
  // together, which is the part that was broken: `sync()` composed renderStub
  // alone, so everything else could be correct and the file still got wiped.
  it("keeps another tool's block instead of deleting it", () => {
    const path = at(TARGETS.find((t) => t.path === "GEMINI.md").path);
    const original = readFileSync(path, "utf8");
    try {
      // 1. Another installer appends its block. The file HAS changed, so `--check`
      //    is right to say so — that contract is exact and stays exact: it
      //    answers "would `agents:sync` rewrite this file?", nothing looser.
      writeFileSync(path, `${original.trimEnd()}\n\n${ANTISLOP}\n`);
      assert.deepEqual(sync({ check: true }).stale, ["GEMINI.md"]);

      // 2. So you run what the message tells you to. THIS is what was broken:
      //    it used to delete the other tool's work, which is why the advice was
      //    worse than the problem.
      sync();
      assert.ok(readFileSync(path, "utf8").includes(ANTISLOP), "agents:sync deleted the other tool's block");

      // 3. And now it settles: the gate is green and stays green.
      assert.deepEqual(sync({ check: true }).stale, [], "the file never reaches a steady state");
      sync();
      assert.ok(readFileSync(path, "utf8").includes(ANTISLOP));
      assert.deepEqual(sync({ check: true }).stale, []);
    } finally {
      writeFileSync(path, original);
    }
  });
});
