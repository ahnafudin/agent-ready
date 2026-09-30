# agent-ready

Start a repo that AI coding agents follow, or add that tooling to a repo you already have: one
`AGENTS.md` every agent reads, one `npm run gate` for any of 70 stacks, and anti-slop checks that
fail the gate.

```bash
npx @ahnafudin/agent-ready init my-project   # a new project, with a history of its own
npx @ahnafudin/agent-ready add               # into the repo in the current directory; your files stay
```

Then `npm install` and `npm run setup`. `add` copies only what is missing: a file you already have
(`AGENTS.md`, `.gitignore`, a workflow) is kept and listed, and npm scripts are added without
replacing any of yours.

Both commands fetch the agent-ready release that matches the CLI's version. Git and Node 22 or later
are required.

Source, docs and issues: https://github.com/ahnafudin/agent-ready
