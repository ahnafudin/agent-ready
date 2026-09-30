#!/usr/bin/env node
// .github/assets/demo.mjs — renders demo.svg from a real `npm run slop` run in a scratch copy of the tooling.
// Re-run after changing the checker's output: node .github/assets/demo.mjs

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, ".github", "assets", "demo.svg");

const SLOP = [
  "// Renders the order summary (Checkout Spec §4.1). It used to live on the cart page,",
  "// but moved here when the review step was added, so both pages share it now.",
  "// Shows items, then subtotal, shipping and tax, then the total. Never edits the cart.",
  "// Kept separate from the payment form so each can change on its own schedule.",
  "export function OrderSummary() {}",
];
const CLEAN = ["// Read-only order summary: items, subtotal, shipping, tax, total.", "export function OrderSummary() {}"];

/** A throwaway git repo holding the real checker, so the demo shows exactly what it prints. */
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "agentready-demo-"));
  for (const rel of ["package.json", "scripts/slop-check.mjs", "scripts/lib", "scripts/comments.json", "scripts/comments.schema.json"]) {
    cpSync(join(ROOT, rel), join(dir, rel), { recursive: true });
  }
  mkdirSync(join(dir, "src"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  return dir;
}

/** What `npm run slop` prints: its script is `node scripts/slop-check.mjs`, run here without npm's banner. */
function slop(dir, lines) {
  writeFileSync(join(dir, "src", "checkout.ts"), `${lines.join("\n")}\n`);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  const r = spawnSync(process.execPath, ["scripts/slop-check.mjs"], { cwd: dir, encoding: "utf8" });
  return `${r.stdout}${r.stderr}`.trim().split(/\r?\n/);
}

const dir = workspace();
let before;
let after;
try {
  before = slop(dir, SLOP);
  after = slop(dir, CLEAN);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/** Wraps a line at `width` characters, indenting continuations. */
const wrap = (line, width = 96) => {
  const out = [];
  let rest = line;
  while (rest.length > width) {
    const cut = rest.lastIndexOf(" ", width);
    const at = cut > 20 ? cut : width;
    out.push(rest.slice(0, at));
    rest = `    ${rest.slice(at).trimStart()}`;
  }
  return [...out, rest];
};

const frames = [
  { text: "$ cat src/checkout.ts", kind: "cmd" },
  ...SLOP.map((text) => ({ text, kind: "code" })),
  { text: "$ npm run slop", kind: "cmd" },
  ...before.flatMap((l) => wrap(l)).map((text) => ({ text, kind: "fail" })),
  { text: "# the comment becomes one line", kind: "note" },
  ...CLEAN.map((text) => ({ text, kind: "code" })),
  { text: "$ npm run slop", kind: "cmd" },
  ...after.flatMap((l) => wrap(l)).map((text) => ({ text, kind: "pass" })),
];

const COLOR = { cmd: "#7ee787", code: "#e6edf3", fail: "#ff7b72", pass: "#7ee787", note: "#8b949e" };
const LINE = 21;
const TOP = 44;
const width = 900;
const height = TOP + frames.length * LINE + 20;
const CYCLE = 16;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const styles = frames
  .map((_, i) => {
    const show = ((i + 1) / (frames.length + 4)) * 100;
    return `@keyframes l${i}{0%,${show.toFixed(2)}%{opacity:0}${(show + 0.01).toFixed(2)}%,100%{opacity:1}}.l${i}{animation:l${i} ${CYCLE}s steps(1,end) infinite}`;
  })
  .join("");

const text = frames
  .map((f, i) => `<text class="l${i}" x="20" y="${TOP + i * LINE}" fill="${COLOR[f.kind]}">${esc(f.text)}</text>`)
  .join("\n  ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="A four-line comment fails npm run slop; cut to one line, it passes.">
  <style>text{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}${styles}</style>
  <rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
  <circle cx="22" cy="18" r="6" fill="#ff5f57"/><circle cx="42" cy="18" r="6" fill="#febc2e"/><circle cx="62" cy="18" r="6" fill="#28c840"/>
  ${text}
</svg>
`;
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${frames.length} lines)`);
