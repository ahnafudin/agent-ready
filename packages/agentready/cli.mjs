#!/usr/bin/env node
// agentready — starts a project from agentready, or adds its tooling to a repo that already exists.
// Both fetch the agentready release matching this CLI's version, so the files were tested together.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE = "https://github.com/ahnafudin/agentready.git";
const PKG = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const VERSION = PKG.version;
const RUN = `npx ${PKG.name}`;

const USAGE = `usage:
  ${RUN} init <dir>   start a new project in <dir>
  ${RUN} add [dir]    add the tooling to an existing repo (default: the current directory)

options:
  --source <git url or path>   where to fetch agentready from (default: ${SOURCE})
  --ref <tag or branch>        which version to fetch (default: v${VERSION})`;

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout || r.error?.message || "").trim()}`);
  return r.stdout;
}

/** A shallow clone of agentready at `ref` in `dir`, without its history; returns the tracked files. */
function fetchStarter(dir, { source = SOURCE, ref = `v${VERSION}` } = {}) {
  const url = existsSync(source) ? pathToFileURL(resolve(source)).href : source;
  git(["clone", "--quiet", "--depth", "1", ...(ref ? ["--branch", ref] : []), url, dir]);
  const files = git(["ls-files"], dir).split(/\r?\n/).filter(Boolean);
  rmSync(join(dir, ".git"), { recursive: true, force: true });
  return files;
}

/** A directory name as an npm package name. */
const packageName = (dir) => basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+/, "") || "my-project";

/** Clones agentready into an empty `dir` as a new repository named after the directory. */
export function init(dir, options = {}) {
  const target = resolve(dir);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`${dir} is not empty — to add the tooling to an existing repo, run: ${RUN} add ${dir}`);
  }
  fetchStarter(target, options);
  git(["init", "--quiet"], target);
  const pkgPath = join(target, "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  writeFileSync(pkgPath, raw.replace(/"name"\s*:\s*"[^"]*"/, `"name": "${packageName(target)}"`));
  return { dir: target };
}

/** Adds missing npm scripts (never replacing one) or writes a package.json when there is none. */
function mergePackageJson(path, starter, name) {
  if (!existsSync(path)) {
    const fresh = { name: packageName(name), private: true, version: "0.1.0", engines: starter.engines, scripts: starter.scripts };
    writeFileSync(path, `${JSON.stringify(fresh, null, 2)}\n`);
    return Object.keys(starter.scripts);
  }
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.scripts ??= {};
  const added = Object.keys(starter.scripts).filter((key) => !(key in pkg.scripts));
  for (const key of added) pkg.scripts[key] = starter.scripts[key];
  if (added.length) writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  return added;
}

/** Copies the tooling into an existing repo: adds what is missing, keeps every file that is already there. */
export async function add(dir = ".", options = {}) {
  const target = resolve(dir);
  if (!existsSync(target)) throw new Error(`${dir} does not exist`);
  const tmp = mkdtempSync(join(tmpdir(), "agentready-"));
  try {
    const files = fetchStarter(tmp, options);
    const { UPSTREAM_ONLY } = await import(pathToFileURL(join(tmp, "scripts", "personalize.mjs")).href);
    const renamed = { "README.md": "docs/TOOLING.md", LICENSE: "docs/TOOLING-LICENSE" };
    const skipped = (rel) =>
      rel === "package.json" || rel === "CONTRIBUTING.md" || UPSTREAM_ONLY.some((u) => rel === u || rel.startsWith(`${u}/`));
    const added = [];
    const kept = [];
    for (const rel of files) {
      if (skipped(rel)) continue;
      const to = renamed[rel] ?? rel;
      const dest = join(target, to);
      if (existsSync(dest)) {
        kept.push(to);
        continue;
      }
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(tmp, rel), dest);
      added.push(to);
    }
    const starter = JSON.parse(readFileSync(join(tmp, "package.json"), "utf8"));
    const scripts = mergePackageJson(join(target, "package.json"), starter, target);
    return { added, kept, scripts };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function parse(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.split(/=(.*)/s);
    if (flag === "--source" || flag === "--ref") {
      options[flag.slice(2)] = inline ?? argv[++i] ?? "";
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

async function main(argv) {
  let parsed;
  try {
    parsed = parse(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  const [command, dir] = parsed.positional;
  try {
    if (command === "init" && dir) {
      init(dir, parsed.options);
      process.stdout.write(`Created ${dir}. Next:\n  cd ${dir}\n  npm install\n  npm run setup\n`);
      return 0;
    }
    if (command === "add") {
      const { added, kept, scripts } = await add(dir, parsed.options);
      process.stdout.write(`Added ${added.length} file(s) and ${scripts.length} npm script(s).\n`);
      if (kept.length) process.stdout.write(`Kept your own: ${kept.join(", ")}\n`);
      process.stdout.write("Next:\n  npm install\n  npm run setup\n");
      return 0;
    }
  } catch (error) {
    process.stderr.write(`agentready: ${error.message}\n`);
    return 1;
  }
  process.stdout.write(`${USAGE}\n`);
  return command ? 2 : 0;
}

// Standalone package: the symlink-safe entry check is inline (npx runs bins through a symlink).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
