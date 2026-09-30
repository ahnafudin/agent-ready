// slop/run.mjs — GitHub Action entry: the slop check on the caller's checkout, one annotation per finding.

import { describe } from "../scripts/lib/slop.mjs";
import { findSlop } from "../scripts/slop-check.mjs";

const root = process.env.GITHUB_WORKSPACE || process.cwd();
const paths = (process.env.INPUT_PATHS ?? "").split(/\s+/).filter(Boolean);
const { config, hits, skipped } = findSlop(paths, root);

if (skipped) {
  console.log(`::warning::slop check skipped — ${skipped}`);
} else {
  for (const hit of hits) console.log(`::error file=${hit.file},line=${hit.line}::${describe(hit, config)}`);
  console.log(hits.length ? `${hits.length} comment block(s) over the limit` : `no comment block over ${config.maxCommentLines} lines`);
  process.exitCode = hits.length ? 1 : 0;
}
