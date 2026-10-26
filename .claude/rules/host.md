---
paths:
  - "packages/host/**"
  - "packages/app/**"
  - "packages/protocol/**"
---

# The host and the app

- **The host** (`packages/host`) is a Node process the app starts as a child, with
  `ELECTRON_RUN_AS_NODE` (Electron's own binary as Node). It speaks JSON-RPC over stdio
  (`protocol`); methods are registered in `host.ts` (`connection.onRequest('git.diff', ...)`), and
  bad parameters fail with `InvalidParams`. It runs from `packages/host/dist`: rebuild it
  (`npx tsc -b packages/host/tsconfig.build.json`) before running the app.
- **Notifications reach the page only if listed** in `FORWARDED` (`packages/app/src/host.ts`).
- **Platforms:** macOS, Windows and Linux. A function that differs by platform takes a `platform`
  parameter (default `process.platform`), so each branch is tested everywhere.
- **Terminals** (`terminals.ts`, node-pty) don't inherit `UNINHERITED` variables: the host's own
  `ELECTRON_RUN_AS_NODE`, and Claude Code's session variables, with which `claude` kept no
  transcript (measured). node-pty's macOS `spawn-helper` ships without its executable bit; the host
  sets it.
- **Agents' hooks:** `claude` is started with `--settings` hooks that run the host's own entry
  (`main.js hook <event>`), which reports over a local socket. The prompt's hook waits for the
  host's reply (the snapshot before a turn); keep the others quick.
- **Git:** through `git()` in `git.ts`, given as a `Git` function so tests can pass their own.
  Refs Cerebro keeps go under `refs/worktree/cerebro/`.
