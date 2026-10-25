# Open questions

- **Name-based fallback quality**: measured in the spike (measurement 4). Recall is near 100%;
  precision is noisy for common member names. Open: how the UI marks name-based results and swaps
  in tsserver's answer.
- **Language server memory**: measured in the spike (measurement 2), about 1 GB per warm
  whole-repo tsserver on ag-charts. Open: the pool size and idle timeout.
- **Docking library**: dockview, FlexLayout, or own implementation?
- **Editor/diff component**: Monaco or CodeMirror. Claim, to verify: Monaco ships a 2-way diff
  editor, but VS Code's 3-way merge editor is part of the VS Code workbench, not standalone Monaco.
- **3-way merge UI**: build on which component?
- **Host ↔ UI protocol**: what transport and message format; how the SSH tunnel is set up for remote
  mode.
- **Agent change inspection**: what "since the session started" means (git snapshot at session
  start? per turn via hooks?), and what the views look like.
- **Kanban board**: how tasks map to agents, worktrees and sessions.
- **Config layering**: global → repo → worktree; what lives where.
- **Other agent CLIs**: which ones, and how much of hooks/resume/skills maps onto them.
- **Name before publishing**: other projects already use "Cerebro" on GitHub, including
  `cerebroapp/cerebro` (an Electron launcher app, ~8.5k stars) and `lmenezes/cerebro` (an
  Elasticsearch web admin, ~5.6k stars), measured 2026-10-25. Also the Marvel X-Men device of the
  same name (trademark status not checked). Fine while private; decide before going public.
- **Licence** for a published version.
