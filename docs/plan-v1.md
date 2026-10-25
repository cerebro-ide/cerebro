# First version plan

Scope and choices are in `decisions.md`; the shape is in `architecture.md`. Each milestone ends
with something usable on ag-charts. Every part is built as a standalone package with unit tests at
full coverage. Integration and end-to-end tests (probably Playwright) are defined later.

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
- **Settings** layered global → repo → worktree.
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
  list to the diff, then to the code with full navigation.
