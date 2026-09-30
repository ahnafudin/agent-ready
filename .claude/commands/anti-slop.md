---
description: Review the current changes against the anti-slop rules
---

Review the uncommitted changes (`git diff HEAD` plus untracked files) against `docs/anti-slop/`.
Read only the rule files for the areas the changes touch: `code.md`, `ui.md`, `copy.md`, `human.md`.
If this repository has no `docs/anti-slop/`, read them at https://github.com/ahnafudin/agentready/tree/main/docs/anti-slop.

Report each problem on one line as `file:line — rule — fix`, most serious first. Change nothing.
If there is nothing to fix, say so in one line.
