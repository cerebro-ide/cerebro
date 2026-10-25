# Open questions

- **Name-based fallback quality**: measured in the spike (measurement 4). Recall is near 100%;
  precision is noisy for common member names. Open: how the UI marks name-based results and swaps
  in tsserver's answer.
- **Language server memory**: measured in the spike (measurement 2), about 1 GB per warm
  whole-repo tsserver on ag-charts. Open: the pool size and idle timeout, and the cost of the other
  languages' servers.
- **Web components and shadow DOM**: whether Cerebro's components and plugins use custom elements
  and shadow roots (for example to isolate plugins' styles), or plain elements. The JSX runtime
  works with either.
- **Observable nested objects**: the exact API (Ido's requirement: a type for nested objects, as
  well as observable collections, without implicit proxies).
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
- **Build and repo tooling**: package manager, bundler, test runner and coverage tool, chosen with
  minimal dependencies in mind.
- **Native tree-sitter or WASM**: WASM worked without a compiler and is fast enough (spike); native
  is faster but needs per-OS builds.
- **Name before publishing**: other projects already use "Cerebro" on GitHub, including
  `cerebroapp/cerebro` (an Electron launcher app, ~8.5k stars) and `lmenezes/cerebro` (an
  Elasticsearch web admin, ~5.6k stars), measured 2026-10-25. Also the Marvel X-Men device of the
  same name (trademark status not checked). Fine while private; decide before going public.
- **Licence** for a published version.
