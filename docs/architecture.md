# Architecture

The shape agreed, the reasoning behind it, and what's built (as of 2026-11-15). The multi-worktree
parts were measured in the spike (`spike-multi-worktree.md`). Where what's built differs from the
shape agreed, both are said; which is kept is Ido's to decide.

## Code principles

We don't yet know what the final product will look like, so the code must be **modular, clean,
decoupled and extensible**, and it must **support plugins**. Every part of it should be
replaceable or extendable without rewriting the rest. That includes views and panels, language
support, agent CLIs, index backends and git features.

**Modular means usable in isolation.** Every part of the system is developed and tested on its
own, so any part could be used as a standalone library if ever needed. A part depends only on what
it declares (its package dependencies and the interfaces it's given), never on Cerebro's global
state.

**Testing comes in layers:**

1. **Unit tests with full coverage**, for every part, first.
2. **Integration and end-to-end tests** after that, defined later, probably on real browsers with
   Playwright.

## Packages

One TypeScript monorepo, `packages/*`. Each package is a library with its own tests:

| package | what it is |
|---|---|
| `reactive` | signal, computed, effect, batch; a MobX-style layer; observable collections and nested objects |
| `jsx` | the JSX runtime: builds DOM directly, binds reactive functions |
| `layout` | the layout model: tool windows in fixed areas, an editor area of tabbed splits |
| `commands` | commands, menus and the keymap |
| `settings` | settings registered with a type and default, set in layers (global, repository, worktree) |
| `theme` | the theme's variables, base styles and bundled fonts |
| `ui-*` | components: the layout view, editor, menus, popups, tree, dialogs, terminal, image viewer, settings and keymap pages, status bar, toolbar, notifications, tooltips, scrollbars |
| `plugin-api` | plugins and their contribution points: views, commands, menus, shortcuts, settings, saving |
| `protocol` | the JSON-RPC 2.0 transport between UI and host: requests, notifications, cancellation; not the messages' types |
| `index` | the shared index: tree-sitter definitions and identifiers, keyed by blob hash |
| `servers` | the language servers Cerebro runs, and how each is started |
| `host` | the host process, one package: files, git, search, the index service, the language server pool, terminals, agents' turns |
| `playground` | the app's page: it assembles the packages, and holds the features |
| `app` | the Electron shell around the page, and the host it starts |
| `e2e` | end-to-end tests: the built app, driven through Playwright |

The rule is that a package can be used without the rest.

**What's built differs from the shape agreed** in two places (open, proposal H of the review of
2026-11-15):

- **The features are in `playground/src`** (84 files, 28,879 lines), not in `plugins/*` built
  against `plugin-api`. Two features are plugins, Notes and Prettier, and they too live in
  `playground/src` (`notes-plugin.ts`, `prettier-plugin.ts`).
- **The host is one package,** not one assembled from host-side packages; its parts are modules
  of it (`packages/host/src`). The index and the language servers' list are packages of their own.

## Processes

```
Electron UI  ──(JSON-RPC over stdio: local child, wsl.exe, or ssh)──  Host (Node)
                                                                       ├─ file system + git (git CLI)
                                                                       ├─ shared index (tree-sitter, keyed by blob hash)
                                                                       ├─ language server pool (per worktree, per language)
                                                                       ├─ terminals (node-pty), the agent's among them (`claude`)
                                                                       └─ agents' turns (snapshots kept by refs in the worktree's git)
```

- The UI never touches the file system; everything goes through the host.
- The host runs next to the repos (laptop, WSL or server), so the index and language servers stay
  local to the files, and only results cross the boundary.
- **State kept in the page's storage, not the host's,** for now: settings (until the host saves
  files: decision "Settings"), the layout, and each worktree's agent session id
  (`playground/src/agents.tsx`). The aim was a session database in the host, beside a local
  database for the worktree layer's settings; it isn't built.

**Transport:** JSON-RPC 2.0 over the host's stdin and stdout, one message per line, in every mode
(see `decisions.md`, "The protocol and the host"). Local mode is built; WSL and remote are not.

| mode | how the app starts the host |
|---|---|
| local | as a child process |
| WSL | `wsl.exe cerebro-host --stdio` |
| remote | `ssh <server> cerebro-host --stdio` |

There are no ports or tunnels to manage, and one transport covers all three modes.

## UI

- **No framework.** Plain TypeScript and DOM, with Cerebro's own reactive layer and JSX runtime
  (see `decisions.md`).
- **State:** MobX-style model classes on signals, such as `Environments`, `Layout` and the Git
  Log's `Log`, declared with `makeObservable(this)`. Views react to them. Nested data is
  observable only when wrapped explicitly (see `decisions.md`).
- **Large data:** goes in observable collections that report changes in bulk, which virtualised
  trees and lists consume directly.
- **Editor:** CodeMirror 6. It shows what the host sends: diagnostics through `@codemirror/lint`,
  hover, completions, go to definition, find usages.
- **Diffs and merges:** Cerebro's own views, using CodeMirror for the text.
- **Plugins:** contribute DOM elements and commands through `plugin-api`, never framework
  components. The plugins built so far are Notes and Prettier; Settings has a Plugins page.

## Indexing across worktrees

- Worktrees of one repo share git objects, so most files across worktrees are byte-identical and
  have the same blob hash.
- The index is keyed by blob hash: each distinct file content is parsed once (tree-sitter: symbols,
  definitions, references by name), and a worktree's index is a mapping from path to blob hash.
- A new worktree only parses the files whose content is new. Uncommitted edits are hashed the same
  way.
- This gives instant file, symbol and text search and name-based navigation in every worktree, cold
  or warm.
- Measured on ag-charts (WASM tree-sitter):
  - a worktree at an indexed commit takes 25 ms;
  - one a week behind takes 3.9 s;
  - a from-scratch build takes 2.7 s on 8 threads.
- Every target language needs a tree-sitter grammar in the index, not only TS/JS.

## Language servers

- Precise answers (type-aware go to definition, find usages, diagnostics) come from language
  servers, for all target languages in the first version.
- Language servers are not built to share an index across worktrees. One tsserver with every
  ag-charts package loaded costs about 1 GB, measured.
- **A lazy pool:**
  - the host starts a server for a worktree *and a language* when the human opens a file in that
    language in that worktree;
  - it keeps the server warm while the worktree is active, and shuts it down when idle;
  - agents don't use these servers.
- **Every project in the worktree is loaded.** tsserver only finds usages in projects it has
  loaded: 27 files with one package loaded, against 170 with all.
- **While a server warms up, the shared index answers by name.** The UI marks those results as
  name matches and replaces them when the server answers.

## Agent sessions

- Each worktree is bound to a session. The agent CLI runs in a host terminal; the page keeps its
  session ID and resumes it (`claude --resume <id>`).
  - Claim, to verify: `claude --session-id <uuid>` lets Cerebro choose the ID up front.
- Structured events (what the agent changed, when a turn ends) come from the CLI's hooks.
- IDE-wide skills and instructions are placed where the CLI loads them (for Claude Code: user-level
  `CLAUDE.md`, skills, plugins).

## Change inspection

- As IntelliJ's, it follows what's uncommitted (decision "Phase 1 is WebStorm's functionality");
  views since the session started and per commit were dropped on 2026-11-03.
- **An agent's turns** (`host/src/turns.ts`): the host snapshots the worktree when a prompt is
  sent and when the turn ends (from the CLI's hooks), so what the turn changed is the difference
  between the two, whoever else touched the files. A snapshot is a commit of every file git
  doesn't ignore, made through a copy of the worktree's index (what's staged is untouched), and
  kept by a ref under `refs/worktree/`, so other worktrees don't see it. The Agent Changes window
  lists a turn's files, and goes from a file to its diff, then to the code.
