# Overnight log (2026-10-27)

Ido, before going to sleep: "continue work for tonight while I sleep without waiting for my
approval. Make sure you actually stack PRs this time". The order:
1. native window buttons in full screen on macOS;
2. navigation: Back/Forward, Recent Files, Go to Line, select the opened file;
3. language servers.

Every PR is stacked on the one before it. A fix to a lower branch is merged up the stack (no force
pushes).

## PRs

| PR | what | base | CI |
|---|---|---|---|
| #46 | Window buttons in full screen on macOS: AppKit's own (a native module), not drawn | main | green |
| #47 | Back and Forward, as IntelliJ's | #46 | green |
| #48 | Recent Files, as IntelliJ's | #47 | green |
| #49 | Go to Line, as IntelliJ's | #48 | green |
| #50 | Select Opened File in the Project tool window, as IntelliJ's | #49 | green |
| #51 | Language servers, first part: TypeScript 7's own server, the host's LSP client | #50 | green |
| #52 | Python's language server: basedpyright | #51 | green |

Merge them in order. Each includes the ones below it.

## What changed, briefly

- **#46:**
  - In full screen, the macOS window buttons are AppKit's own widgets, moved into the window, as
    JetBrains Runtime does. They're not drawn by the page any more.
  - Measured on CI's macOS: `_NSThemeCloseWidget` etc., 14×14, at (14, 13).
  - It's a small Objective-C Node-API module built with clang, so **building the app on a Mac needs
    Xcode's command-line tools.**
- **#47–#50:** the navigation stage, each as IntelliJ's, with e2e tests:
  - Back/Forward: Ctrl+Alt+Left/Right, Cmd+[ / Cmd+] on macOS, and the mouse's buttons;
  - Recent Files: Ctrl/Cmd+E;
  - Go to Line: Ctrl+G, Cmd+L on macOS;
  - Select Opened File: the locate button in the Project tool window's header.
  - The editor no longer takes Cmd+[ / Cmd+] for indenting (CodeMirror's default). Tab and
    Shift+Tab still indent.
- **#51:**
  - Go to definition and find usages ask the file's language server first, with the editor's text
    (unsaved edits count). When no server answers within 3 s, the index's "Name matches" show, as
    before.
  - TypeScript/JavaScript use TypeScript 7's own `tsc --lsp`, not vtsls or
    typescript-language-server as the plan said. Why: the decision "Language servers, first part".
  - Measured on Cerebro's repo: the first answer, including starting the server, took 91 ms.
  - One server per worktree and language, started when a file opens, stopped after 10 minutes
    unused.
- **#52:** Python through basedpyright, run by the host's own Node.

Bugs found by looking at the app and fixed, each with a test that failed first:
- TypeScript's server sees only the open files when there's no `tsconfig.json`/`jsconfig.json`, so
  Find Usages said "No usages". Such files now get name matches.
- basedpyright answers as if only the open files existed until it has found the folder's files.
  Questions now wait for the line it logs then.

Found on CI and fixed (in #51, so #52 has them too):
- Stopping a language server now resolves once its process has exited. CI once failed to delete
  a test's folder because a server was still writing to it. A test failed before this fix.
- `search.ts` was at 100% branch coverage only on some runs: whether ripgrep printed lines after
  the limit depended on how its output was split. It now stops listening at the limit.
- A click under xvfb waited forever for "stable" (Search Everywhere's toolbar button). It's forced
  now, as the testing rules say.
- On macOS, the host e2e never got `run.sh` highlighted in Go to File (#52 only). The likely
  cause, a claim: Control+click is also a right click on macOS, so the editor's context menu stayed
  open and took the keys. The test now presses Escape first, and prints the popups and focus if it
  fails again.

## Open, for Ido

- **Testing the name-match fallback end to end.** The e2e test of it now uses a shell script, the
  one indexed language without a server. Once Bash gets a server, no file type is left for it.
  Options:
  - a switch that turns servers off for that test;
  - a fallback test only in the playground's own tests;
  - nothing.
  Not done: it adds something you didn't ask for.
- **The other servers:**
  - bash-language-server 5.8.1 (2026-09-19) fits the rules, checked in a scratch install:
    - 36 packages, 27 MB;
    - none with install scripts;
    - none under two weeks old (scoped packages not checked);
    - it brings web-tree-sitter 0.27.0, a second copy beside the index's 0.25.10.
    Not added: adding it leaves the fallback with no e2e test (above).
  - vscode-langservers-extracted's latest is from 2024 and depends on TypeScript 4.
  - marksman is a binary from GitHub releases, not npm, so it needs a download step.
  - yaml-language-server is unchecked.
- **TypeScript files outside a tsconfig project** get name matches only. IntelliJ handles them; a
  synthesised project may be possible later.
- **Claims to check:** the 3 s patience, the 10-minute idle stop, and 50 places in Back/Forward
  history.
- **Packaging** (when it comes) has to ship TypeScript 7's per-platform binary package and
  basedpyright (27.9 MB).
- **Local `npm run check` glitches, twice:**
  - once, a failed test file with no failed test;
  - once, 22 browser test files not run (0% coverage for the UI packages).
  Both passed when run again. Never seen on CI. Cause unknown; my guess is the browser tests
  starting while another run was still busy.

---

# Overnight log (2026-10-26)

The scheduled 3:20 run never started: Windows restarted and ended the session it lived in. Ido
resumed it by hand at 05:28 GMT, asking for the same instructions without waiting for him. This log
is updated as the work goes.

## PRs

| PR | what | base | state |
|---|---|---|---|
| #13 | Display scale: the OS's by default (Windows' under WSL), a setting to override it | main | CI green |
| #14 | The layout persists between runs | main | CI green |
| #15 | The protocol (JSON-RPC over stdio) and the host, listing worktrees | main | CI green |
| #16 | Plugins: the registry, views, commands, menus, shortcuts; a sample Notes plugin | main | CI green |
| #17 | CI: e2e on Linux, macOS and Windows | #15 | CI green on all three |
| #18 | Create and remove worktrees | #15 (+#17 merged in) | CI green |
| #19 | The project tree: a virtualised tree, folders listed by the host | #18 | CI green |
| #20 | The code editor: CodeMirror, read-only, in a shadow root (for the CSP) | #19 | CI green |
| #21 | Find file: the worktree's files from git, faster matching | #20 | CI green |
| #22 | The shared index, first part: Go to Symbol, go to definition, find usages, by name | #21 | CI green (all three OSes) |
| #23 | The index: Python and Bash | #22 | CI not checked |
| #24 | Index warm-up and progress in the status bar (ag-charts: 14 s first indexing) | #23 | CI not checked |

#13, #14 and #16 each touch the e2e suite or the playground's `main.tsx`; whichever merges later may
need `main` merged in. #18–#22 are stacked: each includes the ones below it, and #17's CI matrix,
so their e2e tests run on all three OSes; all green on Linux, macOS and Windows as of #21.

Fixes found by running on all three OSes: paths are written with `/` everywhere, as git writes them
(Windows mixed separators, and an 8.3 short temp path in the tests); and Electron's default menu is
suppressed on Windows and Linux (the page has its own), after which the Linux e2e flake stopped.

## Decisions made (all in `docs/decisions.md`, marked open to change)

- Display scale through Chromium's `--force-device-scale-factor`, read from Windows' registry under
  WSL (measured: 150%, while Electron saw 100%); applies on restart.
- The layout is saved as local data in the browser's storage until the host's database exists.
- One JSON-RPC message per line, LSP-style cancellation; the host runs on Electron's own Node
  (`ELECTRON_RUN_AS_NODE`), not `utilityProcess`, whose stdio has no stdin.
- Plugins contribute through a recording context; a view mounts into a DOM element.
- New worktrees go beside the main one, on a new branch of the same name.
- The project tree is virtualised (10,003 rows draw 28 elements) with IntelliJ's keyboard.
- The editor is read-only for now, and lives in a shadow root: CodeMirror's `<style>` elements are
  blocked by the page's CSP in a document, not in a shadow root (measured).
- New dependencies: CodeMirror's packages, each pinned to a version at least two weeks old.
- Find file uses `git ls-files` (no new dependency); matching is 1.5–10× faster on 50,000 paths.
- The index is the spike's, TS/TSX/JS only, rebuilt per host run (persisting it needs the local
  database); everything it finds is labelled "Name matches". web-tree-sitter at the spike's
  measured version; the grammars' native install scripts are denied, only their WASM is used.

## Open, for Ido

- **Text search:** ripgrep (as planned) means a per-OS binary dependency; `git grep` needs none
  but only searches what git knows about.

- **Saving settings files** (the global `settings.json5` and the repo's `.cerebro/settings.json5`)
  needs a decision: rewriting a hand-edited JSON5 file from the UI would drop its comments. Options:
  edit the text in place (keeping comments), or keep UI changes elsewhere.
- **The Linux e2e flake** (a click waiting forever for "stable") stopped after Electron's default
  menu was removed; the click is still forced. A claim that the menu was the cause.
- **The local database** (session DB, persisted index, layout and worktree settings as local data)
  isn't built: it needs a choice of storage (SQLite would be a native dependency).

## Where it stopped (usage limit)

- **In progress, not committed:** a Keymap page in Settings (configurable shortcuts, from Ido's
  original requirements). The first piece, custom pages in the Settings dialog, is in a local git
  stash ("keymap settings page…") on branch `feat/keymap-settings` (off #24), without tests yet.
  Still to do: the `ui-keymap` package (a draft of user bindings: add by recording keys, remove,
  reset, conflicts), wiring and persisting it in the playground, tests.
- **CI for #23 and #24** wasn't checked after opening.
