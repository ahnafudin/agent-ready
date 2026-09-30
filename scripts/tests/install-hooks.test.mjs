// install-hooks refreshes a copy that carries the pre-rename marker, and still never touches another tool's hook.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { at } from "../lib/util.mjs";

const tmp = mkdtempSync(join(tmpdir(), "tooling-hooks-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** A git repo holding only what install-hooks needs, with bd's hooks path and one existing commit-msg. */
function repo(existingCommitMsg) {
  const dir = mkdtempSync(join(tmp, "repo-"));
  cpSync(at(".githooks"), join(dir, ".githooks"), { recursive: true });
  cpSync(at("scripts", "lib"), join(dir, "scripts", "lib"), { recursive: true });
  cpSync(at("scripts", "install-hooks.mjs"), join(dir, "scripts", "install-hooks.mjs"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "core.hooksPath", ".beads/hooks"], { cwd: dir });
  mkdirSync(join(dir, ".beads", "hooks"), { recursive: true });
  writeFileSync(join(dir, ".beads", "hooks", "commit-msg"), existingCommitMsg);
  return dir;
}

const install = (dir, ...args) =>
  spawnSync(process.execPath, [join(dir, "scripts", "install-hooks.mjs"), ...args], { cwd: dir, encoding: "utf8" });
const installed = (dir) => readFileSync(join(dir, ".beads", "hooks", "commit-msg"), "utf8");

describe("install-hooks across the namespace rename", () => {
  it("reports a copy with the old marker as stale, then refreshes it", () => {
    const dir = repo("#!/bin/sh\n# vibe:hook — a copy installed before the rename\nexit 0\n");
    const check = install(dir, "--check");
    assert.equal(check.status, 1, check.stderr);
    assert.match(check.stderr, /STALE copy of commit-msg/);
    assert.equal(install(dir).status, 0);
    assert.equal(installed(dir), readFileSync(at(".githooks", "commit-msg"), "utf8"));
  });

  it("leaves another tool's commit-msg untouched", () => {
    const foreign = "#!/bin/sh\necho another tool\n";
    const dir = repo(foreign);
    assert.match(install(dir).stderr, /already has a different commit-msg — left untouched/);
    assert.equal(installed(dir), foreign);
  });
});
