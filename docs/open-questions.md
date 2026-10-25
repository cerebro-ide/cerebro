# Open questions

- **Name-based fallback quality**: measured in the spike (measurement 4). Recall is near 100%;
  precision is noisy for common member names. Open: how the UI marks name-based results and swaps
  in tsserver's answer.
- **Language server memory**: measured in the spike (measurement 2), about 1 GB per warm
  whole-repo tsserver on ag-charts. Open: the pool size and idle timeout, and the cost of the other
  languages' servers.
- **3-way merge UI**: Cerebro's own view on CodeMirror; design not started.
- **Host ↔ UI protocol**: JSON-RPC over stdio is proposed. Open: message format details,
  versioning between app and host, and how the host is installed on a remote machine.
- **Agent change inspection**: snapshots per turn are proposed (`architecture.md`). Open: what the
  views look like.
- **Blame in the first version?** `features.md` lists blame as first version; the scope in
  `decisions.md` doesn't.
- **Editing in the first version**: read-mostly inspection with quick fixes, or full editing?
- **Kanban board**: how tasks map to agents, worktrees and sessions.
- **Config layering**: global → repo → worktree; what lives where.
- **Other agent CLIs**: which ones, and how much of hooks/resume/skills maps onto them.
- **Undeclared dependencies**: npm workspaces hoist packages, so a package can import something it
  doesn't declare. That breaks "usable in isolation" silently. How to catch it: a lint rule, a
  check script, or per-package test installs.
- **TypeScript 7**: when to move Cerebro's own build to it (after typescript-eslint supports it).
  Separately, the language-server pool has to serve repos on TS 5–6 (tsserver) and on TS 7, which
  has its own LSP-based server.
- **Native tree-sitter or WASM**: WASM worked without a compiler and is fast enough (spike); native
  is faster but needs per-OS builds.
- **Name before publishing**: other projects already use "Cerebro" on GitHub, including
  `cerebroapp/cerebro` (an Electron launcher app, ~8.5k stars) and `lmenezes/cerebro` (an
  Elasticsearch web admin, ~5.6k stars), measured 2026-10-25. Also the Marvel X-Men device of the
  same name (trademark status not checked). Fine while private; decide before going public.
- **Licence** for a published version.
