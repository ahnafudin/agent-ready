// scripts/lib/slop.mjs — finds comment blocks over the anti-slop limit, using scripts/comments.json.

import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { basename } from "node:path";
import { validate } from "./jsonschema.mjs";
import { at, readJson } from "./util.mjs";

export const DEFAULT_MAX_COMMENT_LINES = 3;

/** Schema errors plus what a schema cannot state (double claims, unreachable entries); [] when sound. */
export function validateCommentRegistry(path = at("scripts", "comments.json"), schemaPath = at("scripts", "comments.schema.json")) {
  const doc = readJson(path);
  if (!doc) return [`cannot parse ${path}`];
  const schema = readJson(schemaPath);
  const errors = schema ? validate(doc, schema).map((e) => `schema ${e}`) : [`cannot parse ${schemaPath}`];
  const ids = new Set();
  const owner = new Map();
  const claim = (kind, key, id) => {
    const prev = owner.get(`${kind} ${key}`);
    if (prev) errors.push(`${kind} "${key}" is claimed by both "${prev}" and "${id}"`);
    owner.set(`${kind} ${key}`, id);
  };
  for (const lang of doc.languages ?? []) {
    if (ids.has(lang.id)) errors.push(`duplicate id "${lang.id}"`);
    ids.add(lang.id);
    if (!(lang.extensions || lang.filenames || lang.interpreters)) errors.push(`"${lang.id}" matches no file`);
    if (!(lang.line || lang.block)) errors.push(`"${lang.id}" has no comment syntax`);
    for (const ext of lang.extensions ?? []) claim("extension", ext, lang.id);
    for (const name of lang.filenames ?? []) claim("filename", name, lang.id);
    for (const bin of lang.interpreters ?? []) claim("interpreter", bin, lang.id);
  }
  for (const group of doc.skipped ?? []) {
    for (const ext of group.extensions) {
      const id = owner.get(`extension ${ext}`);
      if (id) errors.push(`extension "${ext}" is skipped but claimed by "${id}"`);
    }
  }
  return errors;
}

/** The comment registry, indexed by file name, suffix (longest first) and shebang interpreter. */
export function loadRegistry(path = at("scripts", "comments.json")) {
  const { languages } = readJson(path);
  const byName = new Map();
  const byInterpreter = new Map();
  const suffixes = [];
  for (const lang of languages) {
    for (const name of lang.filenames ?? []) byName.set(name, lang);
    for (const bin of lang.interpreters ?? []) byInterpreter.set(bin, lang);
    for (const ext of lang.extensions ?? []) suffixes.push([ext, lang]);
  }
  suffixes.sort((a, b) => b[0].length - a[0].length);
  return { languages, byName, byInterpreter, suffixes };
}

let registry = null;
const defaultRegistry = () => (registry ??= loadRegistry());

/** The program a `#!` line runs: `#!/usr/bin/env -S deno run` → deno, `#!/bin/sh` → sh. */
export function shebangInterpreter(firstLine) {
  if (!firstLine.startsWith("#!")) return null;
  const words = firstLine.slice(2).trim().split(/\s+/);
  let i = 0;
  if (basename(words[0] ?? "") === "env") {
    i = 1;
    while (words[i]?.startsWith("-")) i++;
  }
  return words[i] ? basename(words[i]) : null;
}

/** A file's language: exact name, then longest suffix, then shebang. null means skip the file. */
export function languageOf(path, firstLine = "", reg = defaultRegistry()) {
  const name = basename(path);
  const named = reg.byName.get(name);
  if (named) return named;
  const lower = name.toLowerCase();
  const suffix = reg.suffixes.find(([ext]) => lower.endsWith(ext) && lower.length > ext.length);
  if (suffix) return suffix[1];
  const bin = shebangInterpreter(firstLine);
  return bin ? (reg.byInterpreter.get(bin) ?? null) : null;
}

const startsWithAny = (line, prefixes) => (prefixes ?? []).some((p) => line.startsWith(p));
const hasText = (s) => /[\p{L}\p{N}]/u.test(s);

/** Comment blocks over the limit, as `{ line, lines, doc }`. A blank or code line ends a line-comment run;
 * a block comment's opening and closing lines count only when they carry text. */
export function longComments(text, lang, { max = DEFAULT_MAX_COMMENT_LINES, maxDoc = max } = {}) {
  const found = [];
  let open = null;
  let start = 0;
  let count = 0;
  let doc = false;
  const flush = () => {
    if (count > (doc ? maxDoc : max)) found.push({ line: start, lines: count, doc });
    count = 0;
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (open) {
      const closes = line.includes(open[1]);
      if (!closes || hasText(line.replace(open[1], ""))) count++;
      if (closes) open = null;
      return;
    }
    if ((i === 0 && line.startsWith("#!")) || startsWithAny(line, lang.code)) return flush();
    const block = (lang.block ?? []).find(([opener]) => line.startsWith(opener));
    if (!block && !startsWithAny(line, lang.line)) return flush();
    if (count === 0) {
      start = i + 1;
      doc = startsWithAny(line, lang.doc);
    }
    if (!block) {
      count++;
      return;
    }
    const rest = line.slice(block[0].length);
    if (!rest.includes(block[1])) open = block;
    if (hasText(rest.replace(block[1], ""))) count++;
  });
  flush();
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

const positive = (n, fallback) => (Number.isInteger(n) && n > 0 ? n : fallback);

/** `tooling.slop` from package.json: `{ maxCommentLines, maxDocCommentLines, ignore: RegExp[] }`. */
export function slopConfig(pkgPath) {
  const slop = readJson(pkgPath)?.tooling?.slop ?? {};
  const max = positive(slop.maxCommentLines, DEFAULT_MAX_COMMENT_LINES);
  return {
    maxCommentLines: max,
    maxDocCommentLines: positive(slop.maxDocCommentLines, max),
    ignore: (slop.ignore ?? []).map(globToRegExp),
  };
}

function firstLineOf(path) {
  const buf = Buffer.alloc(256);
  let fd;
  try {
    fd = openSync(path, "r");
    return buf.toString("utf8", 0, readSync(fd, buf, 0, buf.length, 0)).split(/\r?\n/)[0];
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Long comment blocks in one file; [] for an ignored, unreadable or unknown-language file. */
export function checkFile(absPath, relPath, config, reg = defaultRegistry()) {
  const rel = relPath.split("\\").join("/");
  if (config.ignore.some((re) => re.test(rel))) return [];
  const known = languageOf(rel, "", reg);
  const lang = known ?? (basename(rel).includes(".") ? null : languageOf(rel, firstLineOf(absPath), reg));
  if (!lang) return [];
  let text;
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  const limits = { max: config.maxCommentLines, maxDoc: config.maxDocCommentLines };
  return longComments(text, lang, limits).map((hit) => ({ file: rel, language: lang.id, ...hit }));
}

/** One line per finding, the form both the gate and the editor hook print. */
export function describe(hit, config) {
  const max = hit.doc ? config.maxDocCommentLines : config.maxCommentLines;
  const kind = hit.doc ? "doc comment" : "comment";
  return `${hit.file}:${hit.line} — ${hit.lines}-line ${kind} (max ${max}). Say what the code cannot in one line; history belongs in the commit message. See docs/anti-slop/code.md.`;
}
