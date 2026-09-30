// scripts/lib/glob.mjs — the one path expander for stack detection and version syncing.
// `*` works in any segment (build files often sit in `app/`) but never crosses a `/`.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP = new Set(["node_modules", ".git", "target", "vendor", "dist", "build", ".venv"]);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function segmentMatcher(segment) {
  return new RegExp(`^${segment.split("*").map(escapeRe).join("[^/]*")}$`, "i");
}

/** Every existing path under `base` matching the `/`-split `segments`. */
export function expandSegments(base, segments) {
  if (segments.length === 0) return [base];
  const [head, ...rest] = segments;
  if (!head.includes("*")) {
    const next = join(base, head);
    return existsSync(next) ? expandSegments(next, rest) : [];
  }
  const re = segmentMatcher(head);
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return []; // unreadable directory — nothing to match there
  }
  const out = [];
  for (const e of entries) {
    if (!re.test(e.name) || SKIP.has(e.name)) continue;
    const next = join(base, e.name);
    if (rest.length === 0) out.push(next);
    else if (e.isDirectory()) out.push(...expandSegments(next, rest));
  }
  return out;
}

/** Existing paths under `root` matching one repo-relative glob pattern. */
export function expandGlob(root, pattern) {
  return expandSegments(root, pattern.split("/"));
}

export function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
