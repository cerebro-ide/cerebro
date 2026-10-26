# Overnight log (2026-10-26)

The scheduled 3:20 run never started: Windows restarted and ended the session it lived in. Ido
resumed it by hand at 05:28 GMT, asking for the same instructions without waiting for him. This log
is updated as the work goes.

## PRs

| PR | what | base | state |
|---|---|---|---|
| #13 | Display scale: the OS's by default (Windows' under WSL), a setting to override it | main | CI green |
| #14 | The layout persists between runs | main | CI green |
| #15 | The protocol (JSON-RPC over stdio) and the host, listing worktrees | main | CI green after a flaky e2e rerun; the flaky click is now forced |
| #16 | Plugins: the registry, views, commands, menus, shortcuts; a sample Notes plugin | main | e2e hit the same flake; rerun |
| #17 | CI: e2e on Linux, macOS and Windows | #15 | CI green on all three |
| #18 | Create and remove worktrees | #15 | CI running |

#13, #14 and #16 each touch the e2e suite or the playground's `main.tsx`; whichever merges later may
need `main` merged in. The stacked PRs (#17, #18) carry #15's commits.

## Decisions made (all in `docs/decisions.md`, marked open to change)

- Display scale through Chromium's `--force-device-scale-factor`, read from Windows' registry under
  WSL (measured: 150%, while Electron saw 100%); applies on restart.
- The layout is saved as local data in the browser's storage until the host's database exists.
- One JSON-RPC message per line, LSP-style cancellation; the host runs on Electron's own Node
  (`ELECTRON_RUN_AS_NODE`), not `utilityProcess`, whose stdio has no stdin.
- Plugins contribute through a recording context; a view mounts into a DOM element.
- New worktrees go beside the main one, on a new branch of the same name.

## Open, for Ido

- **Saving settings files** (the global `settings.json5` and the repo's `.cerebro/settings.json5`)
  needs a decision: rewriting a hand-edited JSON5 file from the UI would drop its comments. Options:
  edit the text in place (keeping comments), or keep UI changes elsewhere.
- **An e2e flake on Linux CI:** a click waited forever for the button to be "stable" (Playwright
  measures that over animation frames). Not reproduced locally, even under xvfb. Forced for now.
