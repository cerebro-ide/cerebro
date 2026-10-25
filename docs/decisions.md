# Decisions

Agreed during the 2026-10-25 brainstorm unless dated otherwise. Each entry: the decision, why, and
what was rejected.

## A standalone app, not a plugin or a fork

- **Not a JetBrains plugin.** A plugin limits the UX Cerebro is after and forces every user to pay
  for an IntelliJ licence; Cerebro should be free to use.
- **Not a VS Code fork or extension.** Inheriting a large IDE loses the edge of a simple tool that
  doesn't defocus the user. Open-source building blocks (CodeMirror, language servers) are used
  instead.
- Claude first suggested the plugin route as the cheaper path. Ido rejected it for the reasons
  above.

## Electron

Ido has Electron experience and none with Tauri. Tauri was considered and rejected: it's not
practically the same. It replaces the Node backend with Rust, while the libraries Cerebro needs
(language-server clients, node-pty for terminals, git helpers) are Node. It also renders on each
OS's own webview, and the Linux one (WebKitGTK) is the weak spot. Its memory saving is small next
to the language servers, which are Node processes either way.

## Agents are driven through their CLIs, not the Agent SDK

Cerebro is a wrapper around agent CLIs running in terminals (Claude Code first; other CLI agents
later). Structured events can come from the CLI's hooks. Ido never intended to use the SDK.

The SDK's terms for third-party apps were raised as a concern; with the CLI approach Ido considers
it irrelevant (Cerebro provides a wrapper, users bring their own CLI).

## Host process + UI, for local and remote use

Cerebro must work both locally (repos on the laptop, local terminal) and remotely (connect to a
server such as the NAS and work against repos there). So:

- a **host** process (Node) runs where the repos live and owns git, the file system, language
  servers, agent terminals and the index;
- the **Electron app** is only the UI and talks to the host over one protocol, locally or through
  an SSH tunnel. Local mode = the app starts its own host.
- Rule from day one: **the UI never touches the file system.**

Same shape as VS Code Remote and JetBrains Gateway.

## Language servers, not home-grown analysis

Precise navigation comes from existing language servers (list in `features.md`). Claude first
called matching IntelliJ's quality a multi-year project; that assumed writing analysis from
scratch, which is unnecessary. Wiring up the servers is days of work.

## Many worktrees must be proven solvable before building

Ido: it doesn't matter if it takes more work to perfect, but there must be a proper solution
before committing. Approach:

- agents use their own tools, not Cerebro's language servers, so only worktrees the human is
  inspecting need one: a lazy pool, warm servers for active worktrees, idle ones shut down;
- a Cerebro-owned tree-sitter index keyed by git blob hash, shared across worktrees, gives instant
  search and name-based navigation everywhere, including cold worktrees.

**Validated by the spike on 2026-10-25** (`spike-multi-worktree.md`): on ag-charts, a worktree at
an indexed commit indexes in 25 ms, a warm whole-repo tsserver costs about 1 GB, and name-based
results cover tsserver's ~7 s warm-up (recall near 100%, noisy for common member names).

## First version scope

The GUI, the worktree list with each worktree bound to a resumable session, the agent change
inspection view, and navigation (go to definition, find usages) through language servers.
Kanban, 3-way merge and the rest come after.

**Updated 2026-10-25:** navigation covers **all target languages** in the first version (TS/JS,
HTML, CSS, JSON, Markdown, Bash, Python, YAML), not TypeScript first. Ido chose this over Claude's
suggestion of TS/JS first. Milestones are in `plan-v1.md`.

## Platforms (2026-10-25)

Cerebro runs natively on **macOS, Windows and Linux**, and against repos inside **WSL**. Ido's work
laptop is a Mac, development happens on WSL, and he wants native Windows and Linux too. A host
inside WSL is reached the same way as a remote one, so WSL comes with remote mode.

## Remote mode soon after the shell (2026-10-25)

Not in the very first milestone, but right after the main shell is ready. It's tested on Ido's
development machine (WSL) and his other Windows laptop, **not the NAS**: the rule against
installing this project's tooling on the NAS stays. Testing it there before the work laptop was
considered and dropped by Ido.

## Modular means usable in isolation (2026-10-25)

The code principle in `architecture.md` (modular, clean, decoupled, extensible, plugins) means
specifically: **every part of the system is developed and tested in isolation, so any part could
be used as a standalone library if ever needed.** The reactive core, the JSX runtime, the docking
layout, the tree view, the protocol, the blob index, the LSP client, the session store and so on
each stand on their own, with their own tests and no hidden dependency on the rest of Cerebro.

## Testing in layers (2026-10-25)

1. **Unit tests with full coverage**, first, for every part.
2. **Integration and end-to-end tests** after that, defined later, probably on real browsers with
   Playwright.

## Minimal dependencies: Cerebro writes its own components (2026-10-25)

Ido plans to implement all components and keep dependencies to a minimum; the ecosystem around a UI
framework doesn't matter to him. Cerebro writes: docking, menus, trees, lists, tabs, dialogs, the
diff and merge views, the reactive core, the JSX runtime, the host's LSP client, and git access
(by running the `git` CLI).

Libraries used, because writing them isn't worth it:

| library | for |
|---|---|
| Electron | the app shell |
| CodeMirror 6 | the editor core |
| xterm.js | the terminal emulator |
| node-pty | terminals in the host |
| web-tree-sitter and grammars | the shared index |
| the language servers | precise navigation and diagnostics |
| ripgrep | text search |

Rejected: dockview or FlexLayout for docking (Claude's earlier suggestion), since Cerebro builds its
own.

## No UI framework: own reactive core, MobX-style (2026-10-25)

The UI is plain TypeScript and DOM with Cerebro's own reactive layer. Ido's original Cerebro was
React; he asked for Claude's opinion and agreed with it. Why:

- **The plugin boundary is the DOM.** Plugins hand Cerebro DOM elements, not components tied to
  a framework and its version.
- **IDE components are imperative anyway.** The editor, the terminal, virtualised trees of 12k+
  files and drag-to-dock all end up as direct DOM control.
- **Precedent.** VS Code's workbench is vanilla TypeScript with its own component layer (claim,
  from Claude's knowledge).

Shape of the reactive layer:

- **Core:** signal, computed, effect and batch, with automatic dependency tracking.
- **On top, a MobX-style layer:** observable model objects with computed values and actions. How
  they are declared is open (`open-questions.md`); decorators were Claude's suggestion, not a
  decision.
- **No implicit deep observability through proxies**, as in MobX. It's slow and surprising for
  IDE-sized data.
- **Instead, two explicit types:**
  - observable collections (array, map, set) that report changes in bulk, for example "these 40
    nodes changed", which virtualised views need;
  - an observable type for nested objects (Ido's requirement), opt-in per object rather than
    applied by a proxy.

Rejected:

- **React:** ties plugins to a framework.
- **Solid:** offered as a middle ground with one dependency; not needed.

## JSX that builds DOM directly (2026-10-25)

Ido likes JSX, so the UI uses it. TypeScript compiles JSX to calls into Cerebro's own runtime
(`jsxImportSource`), which creates real DOM elements: no library, no virtual DOM.

- **Reactivity is bound explicitly.** JSX builds the DOM once; a reactive part is a function,
  `{() => worktree.branch}`, which becomes an effect updating just that node.
- **It works with web components and shadow DOM:**
  - custom elements are created like any tag;
  - rich data is set as properties rather than attributes, with explicit `prop:` / `attr:` for the
    ambiguous case;
  - JSX can render into a shadow root.
- "No templating" means no string templates and no compiler step beyond TypeScript's own JSX
  transform.

## CodeMirror 6, not Monaco (2026-10-25)

Monaco is overkill for Cerebro. Why:

- **Its bundled language services don't help.** They run in the UI on the files they're given, and
  don't see the worktree's tsconfig, `node_modules` or other packages, so they're wrong in a
  monorepo. Using them would also break "the UI never touches the file system".
- **Diagnostics come from the host's language servers anyway.** The editor only draws them:
  squiggles, gutter markers, hover messages, a problems panel.
- **Monaco's LSP integration buys nothing**, because the host, not the UI, talks to language
  servers.
- **Neither editor ships a 3-way merge**, so Cerebro builds its own diff and merge views either
  way.
- **CodeMirror is modular and small; Monaco brings VS Code's workers and look.**

CodeMirror's official packages cover the editor-side pieces: `@codemirror/lint` for diagnostics,
`@codemirror/autocomplete`, and `@codemirror/merge` for 2-way diffs. These were checked on npm on
2026-10-25: all three are from CodeMirror's author.

## Build tooling: the minimal, mainstream set (2026-10-25)

Ido's approach is minimal: no new tools or exotic libraries without a good reason. The
minimal-dependencies rule applies to **runtime** dependencies; development tools are chosen for
productivity, but still from the mainstream.

| need | choice |
|---|---|
| package manager | npm workspaces (built into Node) |
| type checking, library output | TypeScript 6.0.3, `tsc -b` with project references |
| bundling the app | Vite (already required by Vitest, as its peer dependency) |
| unit tests | Vitest: in Node for host packages, browser mode on Playwright's Chromium for DOM packages; coverage thresholds at 100% per file |
| lint and format | ESLint + typescript-eslint + Prettier |
| task running | npm scripts and `tsc -b`; no Nx or Turborepo for now |
| packaging Electron | decided in milestone 3 |

Why:

- **TypeScript 6, not 7.** TypeScript 7.0 (the native Go compiler) has no API ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).
  - typescript-eslint needs that API: every release line on npm declares TypeScript
    `>=4.8.4 <6.1.0` as its peer dependency (checked 2026-10-25).
  - Microsoft's own workaround is TS 6 and TS 7 side by side through npm aliases. That's two
    compilers, which is against the minimal approach.
  - Move to 7 once typescript-eslint supports it; the 7.1 beta with an API came out on 2026-10-20.
- **Vitest over `node:test`.** DOM packages need tests in a real browser with layout, which
  `node:test` can't run. Vitest runs both environments with one runner and enforces per-file
  coverage ([coverage config](https://vitest.dev/config/coverage)).
- **Rejected:**
  - **pnpm:** its stricter `node_modules` and shared store weren't worth a non-default tool. How
    to catch a package importing something it doesn't declare is open (`open-questions.md`).
  - **Biome:** newer, and its type-aware rules use its own inference rather than TypeScript.
  - **Nx and Turborepo:** they don't pay for themselves at this size; can be added later.
  - **esbuild:** Vite covers bundling, so it would be a separate tool for nothing.

## Name: Cerebro

The name Ido used for his earlier tool. Fine while private; check before publishing (see
`open-questions.md`).

## Where it lives and where it's developed

- Private GitHub repo `iMoses/cerebro`; a copy on the NAS so a session there can work on it any
  time (the NAS is always on).
- **No tooling for this project is installed on the NAS**; it isn't a proper development
  environment. Development and the spike run on another machine. Remote mode is tested on Ido's
  development machine and Windows laptop, not the NAS (see above).

## Goal: a tool first, ideally published

Primarily a tool for Ido, ideally published so others find it useful. Ido is willing to spend time
on it and has spare Claude subscription capacity to put into it.
