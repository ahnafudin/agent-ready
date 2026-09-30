#!/usr/bin/env node
// scripts/read-guard.mjs — a Claude Code PreToolUse hook that refuses an
// unbounded Read of a long file.
//
// Why this exists: a tool result stays in the agent's context for the rest of
// the session — nothing but compaction takes it back out. Measured over 93
// sessions of one real project, results over 5,000 characters were 7.5% of the
// tool calls and 59% of everything tool calls put into context, and the largest
// single entries were whole 2,000-line source files read to find one function.
// Scoring relevance afterwards cannot win that back: the file is what the agent
// asked for. The only lever is to read less in the first place.
//
// So a Read with no offset and no limit, of a text file longer than the
// threshold, is denied with a reason that says what to do instead. Passing
// offset or limit is the explicit way through, so nothing is ever locked away —
// a refusal costs one extra round trip. Every failure (unparseable input, a
// missing or unreadable file) lets the Read proceed: this hook may only ever
// save context, never break a session.
//
// READ_GUARD_MAX_LINES in the environment moves the threshold (default 400).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_MAX_LINES = 400;

// Read renders these as images, pages or cells, not as lines of text.
const NOT_TEXT = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|ipynb)$/i;

/** Lines in a file as an editor counts them; null when it cannot be read. */
export function countLines(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    return null;
  }
  if (bytes.length === 0) return 0;
  let lines = 0;
  for (const b of bytes) if (b === 10) lines++;
  return bytes[bytes.length - 1] === 10 ? lines : lines + 1;
}

/** The threshold from the environment; anything but a positive integer keeps the default. */
export function maxLinesFrom(env) {
  const n = Number(env.READ_GUARD_MAX_LINES);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_LINES;
}

/** The deny reason for one PreToolUse payload, or null to let the call through. */
export function refusal(payload, { maxLines = DEFAULT_MAX_LINES, lines = countLines } = {}) {
  if (payload?.tool_name !== "Read") return null;
  const args = payload.tool_input ?? {};
  if (args.offset != null || args.limit != null) return null;
  const file = args.file_path;
  if (typeof file !== "string" || file === "" || NOT_TEXT.test(file)) return null;
  const n = lines(resolve(payload.cwd ?? ".", file));
  if (n == null || n <= maxLines) return null;
  return (
    `read-guard: ${file} has ${n} lines (more than ${maxLines}). Grep it with line numbers for ` +
    `what you need, then Read that window with offset/limit (about 200 lines). To survey the ` +
    `whole file, hand it to a subagent. If you really need all of it, Read again with ` +
    `offset: 1, limit: ${n}.`
  );
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // not a payload we understand — let the call through
  }
  const reason = refusal(payload, { maxLines: maxLinesFrom(process.env) });
  if (!reason) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
