// The npm CLI: `init` makes a fresh repo from a clone, `add` fills in what an existing repo lacks and keeps the rest.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { at, PLACEHOLDER_NAME, ROOT } from "../lib/util.mjs";

const CLI = at("packages", "agentready", "cli.mjs");
const skip = !existsSync(CLI) && "the CLI ships with agentready itself, not with a project made from it";
const tmp = mkdtempSync(join(tmpdir(), "agentready-cli-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// This checkout is the source; `ref: ""` takes its current commit instead of a release tag.
const FROM_HERE = { source: ROOT, ref: "" };
const load = () => import(pathToFileURL(CLI).href);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

describe("agentready init", { skip }, () => {
  it("creates a repo named after its directory, with no history of ours", async () => {
    const { init } = await load();
    const dir = join(tmp, "Fresh App");
    init(dir, FROM_HERE);
    assert.equal(readJson(join(dir, "package.json")).name, "fresh-app");
    assert.ok(existsSync(join(dir, "AGENTS.md")) && existsSync(join(dir, "scripts", "gate.mjs")));
    assert.notEqual(spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir }).status, 0, "no commits yet");
  });

  it("refuses a directory that already has files, and points at add", async () => {
    const { init } = await load();
    const dir = join(tmp, "busy");
    mkdirSync(dir);
    writeFileSync(join(dir, "keep.txt"), "mine");
    assert.throws(() => init(dir, FROM_HERE), /not empty — .*agentready add/);
  });

  it("refuses the placeholder name, which would make the project pass for agentready itself", async () => {
    const { init } = await load();
    const dir = join(tmp, PLACEHOLDER_NAME);
    assert.throws(() => init(dir, FROM_HERE), /is the name agentready uses for itself/);
    assert.ok(!existsSync(join(dir, "AGENTS.md")), "the name is checked before anything is fetched");
  });

  it("keeps its placeholder in step with the tooling it installs", async () => {
    const { PLACEHOLDER } = await load();
    assert.equal(PLACEHOLDER, PLACEHOLDER_NAME);
  });
});

describe("agentready add", { skip }, () => {
  it("adds the tooling and keeps every file and script the repo already has", async () => {
    const { add } = await load();
    const dir = join(tmp, "existing");
    mkdirSync(dir);
    writeFileSync(join(dir, "README.md"), "# mine\n");
    writeFileSync(join(dir, "AGENTS.md"), "my rules\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "mine", scripts: { test: "jest", setup: "make" } }));
    const { added, kept, scripts } = await add(dir, FROM_HERE);

    assert.equal(readFileSync(join(dir, "README.md"), "utf8"), "# mine\n");
    assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), "my rules\n");
    assert.ok(kept.includes("AGENTS.md"));
    assert.ok(added.includes("scripts/gate.mjs") && added.includes("docs/TOOLING.md"));

    const pkg = readJson(join(dir, "package.json"));
    assert.equal(pkg.scripts.test, "jest");
    assert.equal(pkg.scripts.setup, "make", "an existing script is never replaced");
    assert.ok(scripts.includes("gate") && pkg.scripts.gate);

    const { UPSTREAM_ONLY } = await import(pathToFileURL(at("scripts", "personalize.mjs")).href);
    for (const rel of [...UPSTREAM_ONLY, "CONTRIBUTING.md", "LICENSE"]) assert.ok(!existsSync(join(dir, rel)), `${rel} was copied`);
  });

  it("writes a package.json when the repo has none", async () => {
    const { add } = await load();
    const dir = join(tmp, "Go Service");
    mkdirSync(dir);
    await add(dir, FROM_HERE);
    const pkg = readJson(join(dir, "package.json"));
    assert.equal(pkg.name, "go-service");
    assert.ok(pkg.scripts.gate);
  });

  it("refuses a repo whose package.json carries the placeholder name, before copying anything", async () => {
    const { add } = await load();
    const dir = join(tmp, "placeholder-named");
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: PLACEHOLDER_NAME }));
    await assert.rejects(add(dir, FROM_HERE), /choose another project name/);
    assert.ok(!existsSync(join(dir, "AGENTS.md")));
  });
});

describe("the agentready command", { skip }, () => {
  it("refuses a flag it does not know", () => {
    const r = spawnSync(process.execPath, [CLI, "init", "x", "--forse"], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown flag: --forse/);
  });

  it("tells people to run it by the name it is published under", () => {
    const { name } = readJson(at("packages", "agentready", "package.json"));
    const r = spawnSync(process.execPath, [CLI], { encoding: "utf8" });
    assert.ok(r.stdout.includes(`npx ${name} init <dir>`), r.stdout);
  });
});
