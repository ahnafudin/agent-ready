# Anti-slop: code

Slop is code that looks finished and says little. The comment rule is enforced: `npm run gate` runs
`npm run slop` first in every project, and in Claude Code `scripts/slop-guard.mjs` flags a long
comment right after the edit. The rest is checked in review (`/anti-slop`).

`package.json` → `vibe.slop` sets `maxCommentLines` (default 3), `maxDocCommentLines` (API doc comments
such as `/**` and `///`; defaults to the same) and `ignore`, a list of globs for code you do not own.

The check knows 76 languages from `scripts/comments.json`, one entry per language with a link to its
official comment syntax. A file it cannot place with certainty, such as `.m`, is skipped, not guessed.

## Comments

- A comment is a short summary of what the code cannot say: what a module is for, why a
  non-obvious choice was made, or the trap it avoids. One line; three at most.
- Never narrate. No history ("found the hard way", "was renamed"), no list of callers, no spec
  section numbers, no restating the next line. History goes in the commit message, design in `docs/`.
- A comment that needs more than three lines means the code needs a better name, a smaller
  function, or a doc.

Slop:

```ts
// Renders the order summary card (Checkout Spec §4.1). Originally this lived in
// the cart page, but it moved here when the review step was added, so both the
// review step and the confirmation page use it now. It shows the items, then the
// subtotal, shipping and tax, then the total, and it never changes the cart.
```

To the point:

```ts
// Read-only order summary: items, subtotal, shipping, tax, total.
```

## Code

- Names say what a thing is. If a comment explains a name, rename it instead.
- No speculative code: no option, parameter, abstraction or config that nothing uses yet.
- No wrapper that only forwards to one call, and no helper with one caller unless it names an idea.
- Do not catch an error you cannot handle, and never swallow one silently.
- No dead code, no commented-out code, no TODO without an issue.
- An error message says what failed and what to do next, in one sentence.
- A test asserts behaviour someone relies on, not how it is implemented.
- Follow the style of the code around you instead of bringing a new one.
