// The anti-slop comment check: the language registry, the detector, its config, the gate's CLI and the editor hook.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { globToRegExp, languageOf, longComments, shebangInterpreter, slopConfig, validateCommentRegistry } from "../lib/slop.mjs";
import { at, readJson } from "../lib/util.mjs";
import { findSlop } from "../slop-check.mjs";
import { slopReason } from "../slop-guard.mjs";

const dir = mkdtempSync(join(tmpdir(), "slop-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const lines = (...l) => l.join("\n");
const repeat = (n, line) => Array.from({ length: n }, () => line);
const lang = (file, firstLine = "") => languageOf(file, firstLine);
const flagged = (file, text, limits) => longComments(text, lang(file), limits);

describe("the comment registry", () => {
  it("is valid, and no extension, file name or interpreter is claimed twice", () => {
    assert.deepEqual(validateCommentRegistry(), []);
  });

  it("reports a double claim, an unreachable entry and a skipped extension that is claimed", () => {
    const bad = join(dir, "bad-registry.json");
    const entry = (id, extra) => ({ id, line: ["#"], source: `https://${id}.test`, ...extra });
    writeFileSync(bad, JSON.stringify({
      languages: [entry("a", { extensions: [".x"] }), entry("b", { extensions: [".x"] }), entry("c")],
      skipped: [{ extensions: [".x"], reason: "ambiguous" }],
    }));
    const errors = validateCommentRegistry(bad).join("\n");
    assert.match(errors, /extension "\.x" is claimed by both "a" and "b"/);
    assert.match(errors, /"c" matches no file/);
    assert.match(errors, /extension "\.x" is skipped but claimed/);
  });

  // A new language base must come with its comment syntax; add it to BASES and to scripts/comments.json.
  const BASES = {
    node: "index.js", deno: "main.ts", bun: "index.ts", python: "app.py", php: "index.php", go: "main.go",
    rust: "main.rs", maven: "App.java", gradle: "build.gradle.kts", dotnet: "Program.cs", ruby: "app.rb",
    elixir: "app.ex", dart: "main.dart", swift: "main.swift", cpp: "main.cpp",
  };
  const TEMPLATES = {
    vue: "App.vue", sveltekit: "+page.svelte", astro: "index.astro", nextjs: "page.tsx", laravel: "welcome.blade.php",
    symfony: "base.html.twig", django: "base.html", rails: "index.html.erb", phoenix: "page.html.heex",
    blazor: "Index.razor", terraform: "main.tf", helm: "_helpers.tpl", "docker-compose": "compose.yaml",
    godot: "player.gd", android: "MainActivity.kt",
  };
  const stacks = readJson(at("scripts", "stacks.json")).stacks;

  it("covers every language base in the stack registry", () => {
    const bases = stacks.filter((s) => s.tier === "language").map((s) => s.id).sort();
    assert.deepEqual(Object.keys(BASES).sort(), bases, "update BASES and scripts/comments.json together");
    for (const [id, file] of Object.entries(BASES)) assert.ok(lang(file), `${id}: nothing reads ${file}`);
  });

  it("covers the template languages frameworks bring", () => {
    for (const [id, file] of Object.entries(TEMPLATES)) {
      assert.ok(stacks.some((s) => s.id === id), `${id} is no longer in stacks.json`);
      assert.ok(lang(file), `${id}: nothing reads ${file}`);
    }
  });
});

describe("languageOf", () => {
  it("prefers an exact name, then the longest suffix", () => {
    assert.equal(lang("Makefile.PL").id, "perl");
    assert.equal(lang("CMakeLists.txt").id, "cmake");
    assert.equal(lang("welcome.blade.php").id, "blade");
    assert.equal(lang("index.php").id, "php");
    assert.equal(lang("build.gradle.kts").id, "kotlin");
  });

  it("reads the shebang of a file with no extension", () => {
    assert.equal(shebangInterpreter("#!/usr/bin/env -S deno run --allow-read"), "deno");
    assert.equal(lang("pre-commit", "#!/bin/sh").id, "shell");
    assert.equal(lang("tool", "#!/usr/bin/env python3").id, "python");
  });

  it("skips what it cannot read with certainty", () => {
    assert.equal(lang("model.m"), null, ".m is Objective-C, MATLAB or Octave");
    assert.equal(lang("README.md"), null);
    assert.equal(lang("data.json"), null);
    assert.equal(lang("NOTES"), null, "no extension and no shebang");
  });
});

describe("longComments", () => {
  it("allows three comment lines and flags four, from the block's first line", () => {
    assert.deepEqual(flagged("a.ts", lines(...repeat(3, "// c"), "f();")), []);
    assert.deepEqual(flagged("a.ts", lines("f();", ...repeat(4, "// c"), "f();")), [{ line: 2, lines: 4, doc: false }]);
  });

  it("ends a block at a blank line or code, and ignores a trailing comment", () => {
    assert.deepEqual(flagged("a.go", lines("// a", "// b", "", "// c", "// d")), []);
    assert.deepEqual(flagged("a.go", lines(...repeat(5, "f() // why"))), []);
  });

  it("counts a block comment's text, not its frame", () => {
    assert.deepEqual(flagged("a.java", lines("/**", " * a", " * b", " * c", " */", "void f();")), []);
    assert.equal(flagged("a.java", lines("/*", " * a", " *", " * b", " * c", " * d", " */")).length, 1);
    assert.equal(flagged("a.tsx", lines("{/*", "  a", "  b", "  c", "  d", "*/}")).length, 1);
    assert.equal(flagged("page.html", lines("<!--", "a", "b", "c", "d", "-->")).length, 1);
  });

  it("opens a block before a line comment that shares its prefix", () => {
    assert.equal(flagged("a.lua", lines("--[[", "a", "b", "c", "d", "]]")).length, 1);
    assert.equal(flagged("a.jl", lines("#=", "a", "b", "c", "d", "=#")).length, 1);
    assert.equal(flagged("_helpers.tpl", lines("{{/*", "a", "b", "c", "d", "*/}}")).length, 1);
  });

  it("does not read code as comments", () => {
    assert.deepEqual(flagged("a.c", lines(...repeat(6, "#include <x.h>"))), [], "preprocessor");
    assert.deepEqual(flagged("a.rs", lines(...repeat(6, "#[derive(Debug)]"))), [], "attributes");
    assert.deepEqual(flagged("a.php", lines(...repeat(6, "#[Route('/x')]"))), [], "PHP 8 attributes");
    assert.deepEqual(flagged("dump.sql", lines(...repeat(6, "/*!40101 SET NAMES utf8 */;"))), [], "MySQL hints");
    assert.deepEqual(flagged("a.hs", lines(...repeat(6, "{-# LANGUAGE GADTs #-}"))), [], "pragmas");
    assert.deepEqual(flagged("a.css", lines(...repeat(6, "#main { color: red }"))), [], "selectors");
    assert.deepEqual(flagged("a.py", lines('"""', ...repeat(6, "Docstrings are strings."), '"""')), []);
    assert.deepEqual(longComments(lines("#!/bin/sh", "# a", "# b", "# c", "echo"), lang("hook", "#!/bin/sh")), [], "shebang");
  });

  it("knows hash, dash and semicolon languages", () => {
    for (const [file, prefix] of [["a.py", "#"], ["Dockerfile", "#"], ["q.sql", "--"], ["a.hs", "--"], ["a.clj", ";"], ["x.ini", ";"]]) {
      assert.equal(flagged(file, lines(...repeat(4, `${prefix} c`))).length, 1, file);
    }
  });

  it("gives doc comments their own limit", () => {
    const docs = lines(...repeat(5, "/// documents the next item"), "fn f() {}");
    assert.deepEqual(flagged("a.rs", docs), [{ line: 1, lines: 5, doc: true }]);
    assert.deepEqual(flagged("a.rs", docs, { max: 3, maxDoc: 8 }), []);
    assert.equal(flagged("a.rs", lines(...repeat(5, "// narrative")), { max: 3, maxDoc: 8 }).length, 1);
  });
});

describe("configuration", () => {
  it("matches ignore globs within and across folders", () => {
    assert.ok(globToRegExp("vendor/**").test("vendor/a/b.js"));
    assert.ok(globToRegExp("*.min.js").test("app.min.js"));
    assert.ok(!globToRegExp("src/*.ts").test("src/deep/a.ts"));
  });

  it("reads tooling.slop, falling back to three lines for both limits", () => {
    const pkg = join(dir, "config.json");
    writeFileSync(pkg, JSON.stringify({ tooling: { slop: { maxCommentLines: 5, maxDocCommentLines: 9, ignore: ["legacy/**"] } } }));
    const config = slopConfig(pkg);
    assert.deepEqual([config.maxCommentLines, config.maxDocCommentLines], [5, 9]);
    assert.ok(config.ignore[0].test("legacy/old.js"));
    writeFileSync(pkg, JSON.stringify({ tooling: { slop: { maxCommentLines: "lots" } } }));
    assert.deepEqual([slopConfig(pkg).maxCommentLines, slopConfig(pkg).maxDocCommentLines], [3, 3]);
  });
});

describe("the gate check and the editor hook", () => {
  const project = join(dir, "project");
  mkdirSync(join(project, "legacy"), { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ tooling: { slop: { ignore: ["legacy/**"] } } }));
  writeFileSync(join(project, "long.js"), lines(...repeat(5, "// c"), "f();"));
  writeFileSync(join(project, "short.js"), lines("// fine", "f();"));
  writeFileSync(join(project, "legacy", "old.js"), lines(...repeat(9, "// c"), "f();"));

  it("reports long comments with file, line and language, and skips ignored paths", () => {
    const { hits } = findSlop(["long.js", "short.js", "legacy/old.js"], project);
    assert.deepEqual(hits, [{ file: "long.js", language: "javascript", line: 1, lines: 5, doc: false }]);
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
    writeFileSync(long, lines(...repeat(6, "// c"), "f();"));
    const out = JSON.parse(run(JSON.stringify({ tool_input: { file_path: long } })).stdout);
    assert.equal(out.decision, "block");
    assert.match(out.reason, /6-line comment/);
    assert.equal(run("not json").stdout, "");
  });

  it("turns each finding into a GitHub annotation when run as the Action", (t) => {
    const action = at("slop", "run.mjs");
    if (!existsSync(action)) return t.skip("the Action ships with agentready itself");
    const env = { ...process.env, GITHUB_WORKSPACE: project, INPUT_PATHS: "long.js short.js" };
    const r = spawnSync(process.execPath, [action], { encoding: "utf8", env });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /^::error file=long\.js,line=1::long\.js:1 — 5-line comment/m);
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
