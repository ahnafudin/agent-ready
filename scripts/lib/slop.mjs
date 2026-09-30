// scripts/lib/slop.mjs — finds comment blocks longer than the anti-slop limit, in any common language.

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { readJson } from "./util.mjs";

export const DEFAULT_MAX_COMMENT_LINES = 3;

const C_FAMILY = { line: ["//"], block: ["/*", "*/"] };
const HASH = { line: ["#"] };
const DASH = { line: ["--"] };

const BY_EXT = {
  ...Object.fromEntries(
    "js mjs cjs jsx ts tsx mts cts java kt kts scala groovy gradle c h cc cpp cxx hpp cs go rs swift dart php scss less vue svelte astro"
      .split(" ")
      .map((e) => [`.${e}`, C_FAMILY]),
  ),
  ".css": { block: ["/*", "*/"] },
  ...Object.fromEntries(
    "py rb sh bash zsh fish ps1 yml yaml toml r pl pm ex exs tf hcl nim cr".split(" ").map((e) => [`.${e}`, HASH]),
  ),
  ...Object.fromEntries("sql lua hs elm".split(" ").map((e) => [`.${e}`, DASH])),
};
const BY_NAME = { Dockerfile: HASH, Makefile: HASH, Gemfile: HASH, Rakefile: HASH };

/** The comment syntax of a file, or null when the checker does not know the language. */
export function commentStyle(path) {
  const name = basename(path);
  return BY_NAME[name] ?? BY_EXT[extname(name).toLowerCase()] ?? (extname(name) === "" ? HASH : null);
}

/** Comment blocks longer than `max` lines, as `{ line, lines }` (1-based start line). */
export function longComments(text, style, max = DEFAULT_MAX_COMMENT_LINES) {
  const found = [];
  const [open, shut] = style.block ?? [];
  let start = 0;
  let count = 0;
  let inBlock = false;
  const close = () => {
    if (count > max) found.push({ line: start, lines: count });
    count = 0;
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const lineNo = i + 1;
    if (inBlock) {
      if (line.includes(shut)) inBlock = false;
      if (!/^\**\/?$/.test(line)) count++; // `*` and `*/` alone are frame, not content
      return;
    }
    const lineComment = !(lineNo === 1 && line.startsWith("#!")) && (style.line ?? []).some((p) => line.startsWith(p));
    const opensBlock = open !== undefined && line.startsWith(open);
    if (!lineComment && !opensBlock) return close();
    if (count === 0) start = lineNo;
    if (opensBlock) {
      inBlock = !line.includes(shut, open.length);
      if (line.slice(open.length).replace(/^\*+/, "").replace(/\*+\/$/, "").trim() !== "") count++;
      return;
    }
    count++;
  });
  close();
  return found;
}

/** Converts a repo-relative glob (`*` within a segment, `**` across them) to a RegExp. */
export function globToRegExp(glob) {
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const body = glob
    .split("**")
    .map((part) => part.split("*").map(esc).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

/** `vibe.slop` from package.json with defaults: `{ maxCommentLines, ignore: RegExp[] }`. */
export function slopConfig(pkgPath) {
  const slop = readJson(pkgPath)?.vibe?.slop ?? {};
  const max = Number.isInteger(slop.maxCommentLines) && slop.maxCommentLines > 0 ? slop.maxCommentLines : DEFAULT_MAX_COMMENT_LINES;
  return { maxCommentLines: max, ignore: (slop.ignore ?? []).map(globToRegExp) };
}

/** Long comment blocks in one file; [] for an ignored, unreadable or unknown-language file. */
export function checkFile(absPath, relPath, { maxCommentLines, ignore }) {
  const rel = relPath.split("\\").join("/");
  if (ignore.some((re) => re.test(rel))) return [];
  const style = commentStyle(rel);
  if (!style) return [];
  let text;
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  return longComments(text, style, maxCommentLines).map((hit) => ({ file: rel, ...hit }));
}

/** One line per finding, the form both the gate and the editor hook print. */
export function describe(hit, max) {
  return `${hit.file}:${hit.line} — ${hit.lines}-line comment (max ${max}). Say what the code cannot in one line; history belongs in the commit message. See docs/anti-slop/code.md.`;
}
