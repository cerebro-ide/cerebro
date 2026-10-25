# Architecture (draft)

This records the shape agreed so far and the reasoning behind it. The multi-worktree parts were
measured in the spike (`spike-multi-worktree.md`); the rest is not built yet.

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

One TypeScript monorepo. Each package is a library with its own tests:

| package | what it is |
|---|---|
| `reactive` | signal, computed, effect, batch; MobX-style decorators; observable collections and nested objects |
| `jsx` | the JSX runtime: builds DOM directly, binds reactive functions |
| `ui-*` | components: docking, menus, tree, list, tabs, dialogs, diff and merge views |
| `protocol` | message types and the JSON-RPC transport between UI and host |
| `plugin-api` | contribution points: views, commands, menus, language support, agent CLIs, index backends |
| `host` | the host process, assembled from host-side packages (git, files, index, LSP pool, terminals, sessions) |
| `app` | the Electron shell, assembled from the UI packages |
| `plugins/*` | features, built against `plugin-api` the same way a third party would |

The exact split is settled as the code is written; the rule is that a package can be used without
the rest.

## Processes

```
Electron UI  ──(JSON-RPC over stdio: local child, wsl.exe, or ssh)──  Host (Node)
                                                                       ├─ file system + git (git CLI)
                                                                       ├─ shared index (tree-sitter, keyed by blob hash)
                                                                       ├─ language server pool (per worktree, per language)
                                                                       ├─ agent terminals (node-pty running `claude`, later other CLIs)
                                                                       └─ session DB (worktree → session ID, state)
```

- The UI never touches the file system; everything goes through the host.
- The host runs next to the repos (laptop, WSL or server), so the index and language servers stay
  local to the files, and only results cross the boundary.

**Transport (proposed):** JSON-RPC over the host's stdin and stdout, in every mode.

| mode | how the app starts the host |
|---|---|
| local | as a child process |
| WSL | `wsl.exe cerebro-host --stdio` |
| remote | `ssh <server> cerebro-host --stdio` |

There are no ports or tunnels to manage, and one transport covers all three modes.

## UI

- **No framework.** Plain TypeScript and DOM, with Cerebro's own reactive layer and JSX runtime
  (see `decisions.md`).
- **State:** MobX-style model classes on signals, such as `Worktree`, `Session` and
  `Diagnostics`. Views react to them.
- **Large data:** goes in observable collections that report changes in bulk, which virtualised
  trees and lists consume directly.
- **Editor:** CodeMirror 6. It shows what the host sends: diagnostics through `@codemirror/lint`,
  hover, completions, go to definition, find usages.
- **Diffs and merges:** Cerebro's own views, using CodeMirror for the text.
- **Plugins:** contribute DOM elements and commands through `plugin-api`, never framework
  components.

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

- Each worktree is bound to a session. The host starts the agent CLI in a terminal, records its
  session ID, and can restart it on a CLI update and resume (`claude --resume <id>`).
  - Claim, to verify: `claude --session-id <uuid>` lets Cerebro choose the ID up front.
- Structured events (what the agent changed, when a turn ends) come from the CLI's hooks.
- IDE-wide skills and instructions are placed where the CLI loads them (for Claude Code: user-level
  `CLAUDE.md`, skills, plugins).

## Change inspection

- When a session starts, the host records the worktree's base commit.
- On each turn end (from a hook), the host snapshots the working tree as a git tree object
  (`git write-tree` with a temporary index). That makes no commits and changes nothing the agent
  sees.
- Views are built on these snapshots: changes since the session started, per turn, and per commit.
  Each goes from the file list to the diff, then to the code with full navigation.
