// Guards that every command printed in a doc or a generated stub works when copy-pasted.
// Trap: `npm run gate --list` does NOT list; npm swallows a leading flag instead of forwarding it.

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { at, isUnrenamed, readIfExists, readJson } from "../lib/util.mjs";
import { detectResolved, loadRegistry, renderDoc } from "../stacks.mjs";
import { renderStub, TARGETS } from "../sync-agents.mjs";

const pkg = readJson(at("package.json"));

/** Every markdown file a human or an agent might copy a command out of. */
function docFiles() {
  const roots = [".", "docs"];
  const out = [];
  for (const dir of roots) {
    for (const name of readdirSync(at(dir))) {
      if (name.endsWith(".md") || name.endsWith(".mdc")) out.push(join(dir, name));
    }
  }
  return out;
}

describe("npm script surface", () => {
  it("exposes a flagless alternative for every flag-taking command", () => {
    // The fix for npm's flag swallowing is a dedicated script, not asking
    // everyone to remember `npm run gate -- --list`.
    for (const script of [
      "gate",
      "gate:list",
      "stack:apply",
      "stack:reapply",
      "agents:sync",
      "agents:check",
      "test:tooling",
    ]) {
      assert.ok(pkg.scripts[script], `package.json is missing the "${script}" script`);
    }
    assert.match(pkg.scripts["gate:list"], /--list/);
    assert.match(pkg.scripts["stack:reapply"], /--force/);
  });

  // Flags that BELONG to npm: it is supposed to consume these, so
  // `npm run test --if-present` is correct usage, not the trap.
  const NPM_OWN_FLAGS = ["--if-present", "--silent", "--workspace", "--workspaces", "--prefix", "--loglevel"];

  /**
   * Lines where a flag meant for OUR script sits where npm will eat it.
   * A line with an uppercase `NOT` is prose warning about the trap, so documenting it stays allowed.
   */
  function swallowedFlagLines(body) {
    return body.split("\n").filter((line) => {
      if (/\bNOT\b/.test(line)) return false;
      return [...line.matchAll(/npm run [a-z][a-z0-9:]* (--[a-z-]+)/g)].some(
        (m) => !NPM_OWN_FLAGS.includes(m[1]),
      );
    });
  }

  it("never documents an `npm run <script> --ourflag` form", () => {
    for (const file of [...docFiles(), ...TARGETS.map((t) => t.path)]) {
      const body = readIfExists(at(file));
      if (!body) continue;
      assert.deepEqual(
        swallowedFlagLines(body),
        [],
        `${file} prints an \`npm run <script> --flag\` form npm will swallow. Use the dedicated ` +
          `script (gate:list / stack:reapply), or — if you are deliberately WARNING about the trap — ` +
          `write NOT in capitals on that line, which this guard treats as prose.`,
      );
    }
  });

  it("keeps the generated stubs free of that form too", () => {
    for (const target of TARGETS) {
      assert.deepEqual(swallowedFlagLines(renderStub(target)), [], target.path);
    }
  });
});

describe("documented commands exist", () => {
  it("every `npm run X` mentioned in a doc is a real script", () => {
    const known = new Set(Object.keys(pkg.scripts));
    const problems = [];
    for (const file of [...docFiles(), ...TARGETS.map((t) => t.path)]) {
      const body = readIfExists(at(file));
      if (!body) continue;
      // `npm run lint --if-present` is CORRECT when `lint` does not exist —
      // tolerating absence is the entire point of the flag, and the generated
      // docs/STACK.md prints exactly that for a project with no lint step.
      for (const m of body.matchAll(/npm run ([a-z][a-z0-9:]*)(\s+--if-present)?/g)) {
        if (m[2]) continue;
        if (!known.has(m[1])) problems.push(`${file}: npm run ${m[1]}`);
      }
    }
    assert.deepEqual(problems, [], "docs reference npm scripts that do not exist");
  });

  it("every gate command in the registry defaults is a non-empty string", () => {
    for (const [key, value] of Object.entries(pkg.vibe.gates)) {
      for (const cmd of [].concat(value ?? [])) {
        assert.equal(typeof cmd, "string", `vibe.gates.${key} must hold strings`);
        assert.ok(cmd.trim().length > 0, `vibe.gates.${key} has an empty command`);
      }
    }
  });
});

describe("the README's honesty claim", () => {
  // The verified count is the basis for trusting the registry, so it is asserted, not kept by hand.
  it("matches what stacks.json actually says", (t) => {
    // Only meaningful here: `personalize.mjs` replaces this README with the
    // project's own, so a derived copy has no such claim to check.
    if (!isUnrenamed()) return t.skip("not agent-ready — its README was replaced");
    const stacks = loadRegistry();
    const verified = stacks.filter((s) => s.verified !== false).length;
    const unverified = stacks.length - verified;
    const readme = readIfExists(at("README.md"));
    // Plain substring, not a regex: escaping the markdown asterisks through a template literal matches nothing.
    if (unverified === 0) {
      assert.ok(
        readme.includes(`**On honesty:** all ${verified} entries are verified`),
        `README states a different verified count; the registry has ${verified}`,
      );
      // With nothing unverified the "N is marked false" clause must be gone, not read `0 are marked`.
      assert.doesNotMatch(
        readme,
        /[*][*][0-9]+ (is|are) marked/,
        "README still advertises an unverified count; the registry has none",
      );
    } else {
      assert.ok(
        readme.includes(`**On honesty:** ${verified} entries are verified`),
        `README states a different verified count; the registry has ${verified}`,
      );
      const verb = unverified === 1 ? "is" : "are";
      assert.ok(
        readme.includes(`**${unverified} ${verb} marked \`"verified": false\`**`),
        `README states a different unverified count; the registry has ${unverified}`,
      );
    }
  });

  it("gets the registry's size and shape right too", (t) => {
    // The headline entry count and framework/base split all go stale when one entry is added.
    if (!isUnrenamed()) return t.skip("not agent-ready — its README was replaced");
    const stacks = loadRegistry();
    const frameworks = stacks.filter((s) => s.tier === "framework").length;
    const readme = readIfExists(at("README.md"));
    assert.ok(readme.includes(`**${stacks.length}-entry framework registry**`), "entry count");
    assert.ok(
      readme.includes(`(${frameworks} frameworks,
${stacks.length - frameworks} language bases)`) ||
        readme.includes(`(${frameworks} frameworks, ${stacks.length - frameworks} language bases)`),
      `README's framework/base split is stale; the registry has ${frameworks} and ${stacks.length - frameworks}`,
    );
  });

  it("does not pin an exact test count, which changes every commit", (t) => {
    if (!isUnrenamed()) return t.skip("not agent-ready — its README was replaced");
    assert.doesNotMatch(readIfExists(at("README.md")), /runs \*\*\d+ tests\*\*/);
  });
});

describe("the generated stack brief", () => {
  // docs/STACK.md is generated, committed and read by agents, so it can silently drift from the gates.
  it("is what the generator would write today", (t) => {
    if (!isUnrenamed()) return t.skip("not agent-ready — a project regenerates its own");
    const expected = renderDoc(detectResolved(), pkg.vibe.gates);
    assert.equal(
      readIfExists(at("docs/STACK.md")),
      expected,
      "docs/STACK.md has drifted from package.json -> vibe.gates. Run `npm run stack:apply`.",
    );
  });
});
