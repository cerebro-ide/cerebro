# First version plan

Scope and choices are in `decisions.md`; the shape is in `architecture.md`. Each milestone ends
with something usable on ag-charts. Every part is built as a standalone package with unit tests at
full coverage. End-to-end tests drive the built desktop app through Playwright (`packages/e2e`, `npm run e2e`).

Models with many operations (the editor area, tool windows, environments, settings layers) also
have randomized tests: seeded runs of random operations, checking after each step the model's
invariants and what the operation promises, or a plain model of the expected state. Each was shown
to catch a bug planted in the model.

UI packages test their key flows with real keyboard and mouse input as well (`real-input.test.tsx`,
Playwright's input through Vitest's `userEvent`), so the browser's own behaviour takes part: focus,
Enter and Space pressing buttons, typing. Hand-made events stay for edge cases that need exact
values. Drags go by window coordinates, since Vitest can resolve two similar elements to the same
target.

## 1. Foundations and the shell

- **The base libraries:**
  - the reactive core: signal, computed, effect, batch;
  - the MobX-style layer;
  - observable collections and observable nested objects;
  - the JSX runtime.
- **The protocol:** JSON-RPC over stdio, with the host started as a local child process.
- **The plugin registry and the first contribution points:** views, commands, menus.
- **The IntelliJ-style window** (`features.md`, "The window's parts"):
  - a menu bar with mnemonics, `…` for dialogs, nesting, hidden by default;
  - context menus on the same menus;
  - a main toolbar with branch and worktree selection;
  - docked tool windows (own docking);
  - two layers of tabs: environments, then files;
  - a status bar;
  - keyboard navigation everywhere, with configurable shortcuts.
- **Dialogs and popups** (Ido, 2026-10-25), built before the protocol and the plugin registry, since
  the toolbar's Search Everywhere and Settings buttons have nothing behind them yet:
  - a modal dialog, as IntelliJ's: a title bar, focus kept inside, Escape and Enter, OK and Cancel,
    draggable. It replaces the playground's `window.prompt` calls (New Worktree, New Branch);
  - a popup with a search field over a keyboard-navigable list, non-modal, closing on Escape or a
    click outside: Search Everywhere, Go to File, and searchable branch and worktree pickers, on
    sample data until search lands in milestone 2.
- **Display scale** (Ido, 2026-10-26): the app takes the OS's display scale by default, and a
  setting overrides it. Under WSLg the OS scale doesn't reach Electron (measured: scale factor 1),
  so the default there must come from Windows.
- **The layout persists** (Ido, 2026-10-26): the layout (tool windows, sizes, environment tabs,
  editor splits and tabs) keeps its state and stays consistent between runs; today a reload resets
  it. Stored as local data (see `decisions.md`, settings).
- **Settings** layered global → repo → worktree, with the Settings dialog (a tree of pages on the
  left, the page on the right).
- **The build tooling** (`decisions.md`): npm workspaces, TypeScript 6, Vite, Vitest, ESLint and
  Prettier.
- **CI** from the start: unit tests on Linux. macOS and Windows runs come with the end-to-end
  tests, which are the tests that depend on the OS.

## 2. Worktrees and files

- **The worktree list**, from `git worktree list`, with create and remove.
- **The project tree**, a virtualised tree on observable collections.
- **The CodeMirror editor**, with syntax highlighting for all target languages.
- **Find file and text search** (ripgrep).
- Per-OS details: paths, line endings (CRLF checkouts, as met in the spike), and per-OS binaries.

## 3. WSL and remote

- **The host over `wsl.exe` and `ssh`**, using the same stdio transport.
- **Packaging the host**, so it can be started on another machine.
- Tested on Ido's development machine (WSL) and his Windows laptop, not the NAS.

## 4. Shared index

- **The spike's blob-keyed tree-sitter index**, moved into the host, with grammars for every
  target language.
- **Symbol search.**
- **Name-based go to definition and find usages**, labelled as name matches in the UI.
- **Persisted to disk** and reloaded on start.

## 5. Language servers

- **The lazy pool**, per worktree and per language, loading every project in the worktree.
- **The host's own LSP client.**
- **Servers for all target languages:** tsserver (vtsls or typescript-language-server),
  vscode-langservers-extracted (HTML, CSS, JSON), marksman, bash-language-server, basedpyright or
  pyright, yaml-language-server.
- **In the editor:** diagnostics, hover, completions, go to definition, find usages. Results switch
  from name matches to precise ones when the server is ready.

## 6. Agent sessions

- **A terminal tool window** (xterm.js, node-pty) running `claude`.
- **The session database**, worktree → session ID → state, with restart-and-resume on a CLI update.
- **Hooks** for turn ends and changes.
- **IDE-wide skills and instructions.**

## 7. Change inspection

- **Snapshots:** the base commit at session start, and a working-tree snapshot on each turn end.
- **Views:** changes since the session started, per turn, and per commit. Each goes from the file
  list to the diff, then to the code with full navigation. Diffs open as views (an editor tab or
  their own window), as in IntelliJ, not in a modal.
