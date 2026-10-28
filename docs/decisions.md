# Decisions

Agreed during the 2026-10-25 brainstorm unless dated otherwise. Each entry: the decision, why, and
what was rejected.

Read the index, then the entries that bear on the work at hand.

## Index

- [A standalone app, not a plugin or a fork](#a-standalone-app-not-a-plugin-or-a-fork): not a JetBrains plugin, not a VS Code fork
- [Electron](#electron): over Tauri
- [Agents are driven through their CLIs, not the Agent SDK](#agents-are-driven-through-their-clis-not-the-agent-sdk): Claude Code in a terminal, wrapped
- [Host process + UI, for local and remote use](#host-process--ui-for-local-and-remote-use): the host does the work; the UI talks to it
- [Language servers, not home-grown analysis](#language-servers-not-home-grown-analysis): navigation from existing language servers
- [Many worktrees must be proven solvable before building](#many-worktrees-must-be-proven-solvable-before-building): the spike's reason
- [First version scope](#first-version-scope): what v1 holds
- [Platforms (2026-10-25)](#platforms-2026-10-25): macOS, Windows, Linux, and repos in WSL
- [Remote mode soon after the shell (2026-10-25)](#remote-mode-soon-after-the-shell-2026-10-25): repos on another machine, after the shell
- [Modular means usable in isolation (2026-10-25)](#modular-means-usable-in-isolation-2026-10-25): each package works on its own
- [Testing in layers (2026-10-25)](#testing-in-layers-2026-10-25): unit, browser and end-to-end; CI
- [Pull requests (2026-10-25)](#pull-requests-2026-10-25): changes through PRs, Ido merges
- [Minimal dependencies: Cerebro writes its own components (2026-10-25)](#minimal-dependencies-cerebro-writes-its-own-components-2026-10-25): few dependencies
- [No UI framework: own reactive core, MobX-style (2026-10-25)](#no-ui-framework-own-reactive-core-mobx-style-2026-10-25): plain DOM and Cerebro's reactive core
- [The MobX-style API (2026-10-25)](#the-mobx-style-api-2026-10-25): the reactive core's API
- [JSX that builds DOM directly (2026-10-25)](#jsx-that-builds-dom-directly-2026-10-25): Cerebro's JSX runtime
- [The shell window (2026-10-25)](#the-shell-window-2026-10-25): the window's parts: stripes, tool windows, editor
- [Commands, menus and shortcuts (2026-10-25)](#commands-menus-and-shortcuts-2026-10-25): the command registry, keymaps, menus
- [Environment tabs (2026-10-25)](#environment-tabs-2026-10-25): a tab per open worktree
- [The main toolbar (2026-10-25)](#the-main-toolbar-2026-10-25): the menu, environment and branch selectors
- [The status bar (2026-10-25)](#the-status-bar-2026-10-25): its items' layout
- [The Electron app (2026-10-25)](#the-electron-app-2026-10-25): the main process; the toolbar as the title bar
- [Dialogs (2026-10-25)](#dialogs-2026-10-25): drawn in the page, not OS windows
- [Popups (2026-10-25)](#popups-2026-10-25): a search field over a list, not modal
- [Settings (2026-10-25)](#settings-2026-10-25): global, repository and worktree levels
- [The layout persists (2026-10-26)](#the-layout-persists-2026-10-26): the layout saved between runs
- [The shared index, first part (2026-10-26)](#the-shared-index-first-part-2026-10-26): one index for many worktrees, in the host
- [Find file (2026-10-26)](#find-file-2026-10-26): go to a file by name
- [The code editor (2026-10-26)](#the-code-editor-2026-10-26): CodeMirror, read-only, highlighted
- [The project tree (2026-10-26)](#the-project-tree-2026-10-26): a virtualised tree of the worktree's files
- [Creating and removing worktrees (2026-10-26)](#creating-and-removing-worktrees-2026-10-26): from git worktree list
- [The protocol and the host (2026-10-26)](#the-protocol-and-the-host-2026-10-26): JSON-RPC over stdio
- [Plugins (2026-10-26)](#plugins-2026-10-26): the registry and its contribution points
- [Language servers, first part (2026-10-27)](#language-servers-first-part-2026-10-27): TypeScript 7's own server, basedpyright, bash-language-server, a lazy pool in the host, name matches meanwhile
- [Navigation (2026-10-27)](#navigation-2026-10-27): Back and Forward, Recent Files, Go to Line, Select Opened File, as IntelliJ's
- [Usages at the caret, and links with Ctrl held (2026-10-28)](#usages-at-the-caret-and-links-with-ctrl-held-2026-10-28): the language server's document highlights, IntelliJ's colours; a word with a definition as a link
- [Gutter markers: what a member implements or overrides (2026-10-28)](#gutter-markers-what-a-member-implements-or-overrides-2026-10-28): worked out from the servers' symbols, definitions and implementations; IntelliJ's icons
- [Scrollbars over the content (2026-10-27)](#scrollbars-over-the-content-2026-10-27): Cerebro's own thumbs, as IntelliJ's; the browser's hidden; tracks clear of the corner and the gutters, shown faintly under the pointer, pressed to page
- [Window buttons in full screen on macOS (2026-10-27)](#window-buttons-in-full-screen-on-macos-2026-10-27): real ones kept in the window, as IntelliJ's
- [The window's colours follow the theme (2026-10-27)](#the-windows-colours-follow-the-theme-2026-10-27): the window controls in the theme's colours
- [Tabs that don't fit (2026-10-27)](#tabs-that-dont-fit-2026-10-27): the strip scrolls, the cut edge fades, a chevron lists every tab
- [Several terminals (2026-10-27)](#several-terminals-2026-10-27): the Terminal tool window's shells as tabs, a + button
- [Islands Dark and Islands Light (2026-10-27)](#islands-dark-and-islands-light-2026-10-27): the light theme measured; chosen in Settings, or synced with the OS
- [Ready-made keymaps (2026-10-27)](#ready-made-keymaps-2026-10-27): IntelliJ's and VS Code's, for Windows and Linux and for macOS, chosen in Settings
- [Search Everywhere (2026-10-27)](#search-everywhere-2026-10-27): double Shift; tabs for All, Classes, Files, Symbols, Actions and Text, as IntelliJ's
- [Search (2026-10-26)](#search-2026-10-26): Find in Files over ripgrep; Find and Replace in a file, as IntelliJ's
- [Editing and saving (2026-10-26)](#editing-and-saving-2026-10-26): documents that outlive tabs; saving on its own, as IntelliJ; conflicts with the disk asked about; deleted files' tabs closed; the Edit menu, Undo named
- [Opening a project (2026-10-26)](#opening-a-project-2026-10-26): projects as tabs in a window, a host per project; the Welcome window
- [A basic IDE before git and agent management (2026-10-26)](#a-basic-ide-before-git-and-agent-management-2026-10-26): open, edit, search, navigate, language servers first
- [The Commit tool window's toolbar (2026-10-26)](#the-commit-tool-windows-toolbar-2026-10-26): open a file or its diff, group, roll back
- [Instructions for Claude: rules and skills (2026-10-26)](#instructions-for-claude-rules-and-skills-2026-10-26): CLAUDE.md, rules by path, skills
- [Agent turns (2026-10-26)](#agent-turns-2026-10-26): a snapshot before and after each turn
- [Agent status and resuming (2026-10-26)](#agent-status-and-resuming-2026-10-26): from Claude Code's hooks; sessions resumed
- [Changes and diffs (2026-10-26)](#changes-and-diffs-2026-10-26): the Commit tool window, side-by-side diffs
- [Terminals and the Claude tool window (2026-10-26)](#terminals-and-the-claude-tool-window-2026-10-26): xterm's headless core, Cerebro's renderer
- [The look: WebStorm's Islands theme (2026-10-26)](#the-look-webstorms-islands-theme-2026-10-26): matched to WebStorm, pixel by pixel
- [CI: quick, and few minutes (2026-10-26)](#ci-quick-and-few-minutes-2026-10-26): one Linux job first, then macOS and Windows
- [End-to-end tests (2026-10-25)](#end-to-end-tests-2026-10-25): the built app, driven by Playwright
- [Desktop conventions in the UI (2026-10-25)](#desktop-conventions-in-the-ui-2026-10-25): an application, not a website
- [CodeMirror 6, not Monaco (2026-10-25)](#codemirror-6-not-monaco-2026-10-25): why CodeMirror
- [Build tooling: the minimal, mainstream set (2026-10-25)](#build-tooling-the-minimal-mainstream-set-2026-10-25): TypeScript, Vite, Vitest, ESLint, Prettier
- [Name: Cerebro](#name-cerebro): to check before publishing
- [Where it lives and where it's developed](#where-it-lives-and-where-its-developed): the WSL development distro; nothing installed on the NAS
- [Goal: a tool first, ideally published](#goal-a-tool-first-ideally-published): for Ido first
- [Process: lean until the foundation runs (2026-10-25)](#process-lean-until-the-foundation-runs-2026-10-25): pieces land before they're perfect

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

**CI (2026-10-25):** GitHub Actions, one Linux job running `npm run check` and the build. Per-OS
runs (macOS, Windows) are only needed for the end-to-end browser tests, so they come with those
(Ido's call). Unit tests don't depend on the OS. This replaced the plan's "CI on all three OSes
from the start".

CI skips changes that touch only Markdown files (`paths-ignore: ['**.md']`), since no check covers
them (Prettier ignores `*.md`). If checks are ever made required for merging, this needs revisiting:
a skipped workflow's checks stay "Pending" and block the PR ([workflow syntax docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).

## Pull requests (2026-10-25)

Changes go through pull requests, so `main` stays green: commit on a branch, push, open a PR, CI
runs on it, and **Ido merges; Claude never merges**. Why now: it keeps broken code off `main`, and
it's how Cerebro itself is meant to be used (agents work on branches, a human inspects before the
work lands).

- **Exception (Ido):** changes that touch only Markdown files may go straight to `main`. PRs are
  mostly for CI, and Markdown files don't go through CI.
- **Not enforced yet.** The repo is private in a free GitHub organization, which doesn't get
  protected branches ([transfer docs](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)),
  so this is a working rule (`CLAUDE.md`), not a lock. It can be enforced once the repo is public
  or the org is on a paid plan.
- **Tooling:** Claude opens PRs and reads CI results with the `gh` CLI, installed in
  `~/.local/bin` on Ido's development machine (no sudo), logged in as Ido.

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
| xterm.js's headless terminal (`@xterm/headless`) | the terminal emulator's parser and screen state; Cerebro draws it (2026-10-26) |
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
- **On top, a MobX-style layer:** observable model objects with computed values and actions.
  Its API is in the next entry; decorators were Claude's suggestion, not a decision.
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

## The MobX-style API (2026-10-25)

Ido chose each of these from options Claude laid out.

- **Models are inferred.** A class calls `makeObservable(this)` once in its constructor:
  - fields become observable;
  - getters become computed values;
  - methods become auto-actions.

  **Changed 2026-10-25:** methods were plain actions, which are untracked, so a query method such as
  `toolWindows.isVisible(id)` called from a binding never updated. Found while writing the layout
  model. Methods are now auto-actions, as in MobX's `makeAutoObservable`: a plain, tracked call from
  inside an effect or computed value, a batched and untracked action anywhere else. Explicit
  `action()` stays untracked.

  Reads and writes are plain property access (`wt.branch = 'feature'`), and JSX binds them as
  `{() => wt.label}`. It works with `Object.defineProperty` on the instance, after class fields are
  initialised. A subclass calls it again for its own fields.
  - Rejected: an annotation map (MobX's `makeObservable(this, {...})`, each name written twice)
    and signal fields (`wt.branch()`, `wt.branch.set(x)`, noisy at every use).
- **Nested objects are stored as-is.** Assigning a plain object to an observable field makes the
  field observable, not the object's contents. Nested data is observable only when wrapped
  explicitly:
  - in `observableObject({...})`, which has a fixed shape: its keys are made observable when it's
    created;
  - or in a nested model.

  Adding keys later needs an observable map.
  - Rejected: deep conversion on assignment, which is implicit and costs time proportional to the
    object's size.
- **Collections have explicit methods.**
  - `ObservableArray` has `get(i)`, `set(i, x)`, `push`, `splice` and iteration; without proxies,
    `arr[i] = x` can't be tracked.
  - `ObservableMap` and `ObservableSet` follow the built-in `Map` and `Set` API.
  - Each collection reports changes in bulk (for example, a splice of 40 items at index 120) for
    virtualised views.
- **Effects run synchronously**, right after the outermost action or batch ends, as in MobX.
- **Settled after the test review (2026-10-25),** choices of Claude's, open to change, each
  pinned by a test:
  - **A run that throws keeps what it read before:** an effect or computed value that throws partway
    through still depends on what its previous run read, so a change to any of it runs it again
    and it can recover. Before, it lost what the failed run didn't reach and stopped reacting to it
    (as MobX does).
  - **Computed values never write,** not even from an `untracked` part or an action; before, those
    got past the check.
  - **Effects don't own effects created inside them:** they live until disposed. Ownership is the
    JSX runtime's (regions own what they render); owning them in the core would dispose the views
    `EnvironmentEditors` renders inside its effect.
  - **Plain arrays and objects in a model aren't observed** (as decided above; the test covers
    `push` on a plain array).
  - Rejected: running on a microtask, which coalesces more but makes tests wait and ordering
    harder to follow.

Smaller defaults, proposed by Claude; Ido didn't comment on them:

- Writes are allowed anywhere, and actions only batch them. A development-time warning for writes
  outside actions (MobX's strict mode) can come later.
- A computed value notifies only when its value changes (`Object.is`), with an optional custom
  comparison.
- Every effect returns a disposer that fits the `Disposable` pattern.

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

**The runtime's API (2026-10-25)**, chosen by Ido from options Claude laid out:

- **Events are written `on:<event>`**, with the DOM event name exactly as dispatched:
  `on:click`, and `on:dock-change` for a custom element's event. Rejected: React's `onClick`,
  which mangles custom event names.
- **Components run once and receive reactive values as functions**, the same rule as in JSX
  itself: `<Label text={() => wt.label} />` updates, while a plain value is static. Rejected:
  passing models for components to read.
- **No list or conditional helpers yet.** `<For>` (keyed lists) and `<Show>` are added with the UI
  components that need them, designed against `ObservableArray`'s bulk changes. Until then,
  function children cover dynamic content.

Also needed, without a choice to make:

- effects created while rendering belong to an owner, and are disposed when their part of the DOM
  is replaced or removed; `render()` returns a disposer;
- `ref` callbacks;
- `style` as a string or an object;
- SVG: known SVG tag names are created in the SVG namespace, because JSX creates children before
  their parents.

## The shell window (2026-10-25)

Ido chose each of these from options Claude laid out.

- **IntelliJ's fixed docking areas, not free docking.**
  - Tool windows live in left, right and bottom areas, each showing at most a primary and a
    secondary window. Left and right stack them (primary on top); bottom puts them side by side
    (primary on the left).
  - As in IntelliJ's new UI, the icons sit only on the sides, in a stripe on the left and one on
    the right. Each stripe's top part holds its side's area, split into primary and secondary.
    Its bottom part holds the bottom area: the left stripe its primary (left) part, the right
    stripe its secondary (right) part.
  - **Corrected 2026-10-25:** Ido first added a top area, then withdrew it. The new UI has no top
    stripe.
  - The bottom area spans the full width between the stripes; the left and right areas stop above
    it, as in IntelliJ (Ido, correcting Claude's first version, where the side areas took the full
    height).
  - The editor area sits in the centre, with tabbed splits.
  - Why: it matches "same GUI", and it's much simpler than letting any panel dock anywhere.
  - Rejected: free docking, as in dockview or VS Code's editor groups everywhere.
- **Plain elements, not web components.**
  - Components are functions that return DOM.
  - CSS is plain, with a `cerebro-` class prefix.
  - Why: a dense IDE UI would otherwise fight shadow roots on focus, keyboard navigation, events
    and styling.
  - Plugins may still use shadow DOM inside their own panels.
- **Themes are CSS custom properties.**
  - Colours, sizes and fonts are `--cerebro-*` variables, and a theme is a set of values. The first
    themes are IntelliJ-like dark and light.
  - Plugins use the same variables.
- **Browser first, Electron later.**
  - `npm run dev` serves the shell, viewed in a browser (WSL forwards `localhost` to Windows).
  - Electron wraps the same page as the last step (done; see "The Electron app").

**The editor area's view** (built 2026-10-25, while Ido tried the tool windows):

- Each group has a tab strip and shows its active tab's content.
- Tabs activate on click and close with their button or a middle-click.
- Dragging a tab:
  - reorders it within its strip;
  - moves it into another group's strip at a position, or into a group by dropping on its content;
  - splits a group when dropped near one of its edges, within 25% of the width or height. An
    overlay shows the half the new group will take.
- Each group's view is rendered once and moved when the tree changes, so its content isn't
  recreated by splits and moves elsewhere. A known limit: moving a node out of the page and back
  resets scroll positions inside it.
- Switching tabs re-renders the content. Keeping each tab's content alive comes with the real
  editor.

Build order:

1. the layout model (pure TypeScript, tested in Node);
2. the layout view, with a dev page (`npm run dev`, `packages/playground`), brought forward so Ido
   can try the UI as it grows. First focus, at Ido's request: tool windows (drag and drop between
   groups, opening and closing) and the theme CSS;
3. the menu bar and status bar;
4. the Electron wrapper.

Until code review starts, a PR may bundle several of these commits (`CLAUDE.md`).

## Commands, menus and shortcuts (2026-10-25)

Built for Ido's requirements in `features.md` ("The window's parts").

- **One registry behind everything.** Menus, context menus, toolbars and shortcuts all trigger
  commands (`@cerebro-ide/commands`), as IntelliJ's actions do.
  - A command has an id, a label with `&` before its mnemonic, a handler, and optionally an
    enabled check, a checked state (for toggles) and `dialog` (shown with `…`).
- **Menus are built from contributions.**
  - Each contribution names a menu id (`main`, `main/file`, `editor/tab`), a group and an order.
  - Groups are separated automatically; submenus refer to other menus.
  - Hidden items and stranded separators are removed.
- **The keymap:**
  - **Keys:** shortcuts are read from the physical key, so they work on any keyboard layout; `Mod`
    is Cmd on macOS and Ctrl elsewhere.
  - **Sequences:** multi-chord shortcuts such as `Ctrl+K Ctrl+S` work, as in IntelliJ.
    Fixed after the test review (2026-10-25), where probes found a chord bound alone was
    unreachable once it also started a sequence, and a started sequence swallowed the next key
    however much later:
    - a sequence waits only if an enabled command is bound to a longer one;
    - a started sequence is abandoned after 2 seconds (claim: IntelliJ's default wait, not
      checked), or when the window loses focus;
    - a chord also bound alone runs when the wait times out, or when the next chord breaks the
      sequence;
    - a chord that breaks a started sequence is swallowed, so it doesn't type or run something
      else (as before).
  - **Layers:** the user's bindings come first, and can remove defaults; then a ready-made keymap's
    (decision "Ready-made keymaps", 2026-10-27).
- **The menu component** (`@cerebro-ide/ui-menu`) is the menu bar's dropdowns and every context
  menu.
  - Full keyboard navigation, including mnemonic letters (several items sharing a letter cycle,
    as on Windows).
  - Keys an open menu handles don't reach the app's shortcuts.
  - It stays inside the window, and gives focus back when it closes.
- **The hidden menu bar expands in place, as in IntelliJ** (Ido's screenshot):
  - clicking ☰ shows the bar where the button was, with File open below its name;
  - Alt plus a letter, or Alt alone, expands it the same way;
  - it collapses back to ☰ when the menu closes.

  Mnemonics in the bar are underlined while a menu is open or Alt is held. Claude first opened a
  separate vertical menu from ☰; Ido pointed to IntelliJ's behaviour instead.
- **Expanded, the hidden bar takes over the whole toolbar row**, as IntelliJ does on Windows, rather
  than sitting beside the toolbar's other items (Ido).
- **On macOS, the menu belongs in the system menu bar** (Ido's preference): hidden at the top of the
  screen until the pointer goes there.
  - Built in the desktop app from the same registry (see "The Electron app"). Electron's docs:
    `Menu.setApplicationMenu` sets the macOS application menu, whose first submenu always has the
    app's name.
  - Claim, still to check on a Mac: in full screen the system menu bar hides until the pointer
    goes to the top, as the OS's own behaviour.
  - Windows and Linux keep the ☰ behaviour.
- **Menu items as in IntelliJ, matched by measurement** (Ido's screenshot), in units of the
  height of a capital letter, since the screenshot's display scale is unknown:
  - item spacing was already IntelliJ's (2.8× there, 2.9× here), so the height stayed;
  - separators shrank to IntelliJ's ~0.4×, from 1×;
  - commands may have an icon, drawn at ~1.4× in the check mark's column, through an `icon`
    callback in the menu services.
- **Views stay free of the menu package.** They report events such as `onTabContextMenu`, and the
  app opens the menu.

## Environment tabs (2026-10-25)

The outer of the two tab layers (`features.md`): one tab per open environment (a worktree with its
session), in a row under the main toolbar across the full width. IntelliJ has no equivalent, since
it gives each project its own window, so the design is Claude's.

- **Model:** `Environments` in `@cerebro-ide/layout`.
  - Each `Environment` has its own `EditorArea`; the tool-window layout stays shared, as Ido
    confirmed.
  - Opening a worktree that's already open switches to its tab.
  - Closing a tab activates the next one, or the previous for the last.
- **Tabs** (`EnvironmentTabs`), styled as IntelliJ's window tabs (Ido's screenshot):
  - equal widths filling the row, the label centred;
  - labelled by the app: the playground shows "environment – active file", as IntelliJ shows
    "project – file";
  - the active tab is a rounded pill on the editor colour;
  - the row shows only with two or more environments open;
  - click or Enter to switch, × (on hover) or middle-click to close, drag to reorder;
  - a **+** opens another environment, and tabs have a context menu.

  Claude's first version had a badge, name and branch per tab and was always shown; Ido pointed to
  IntelliJ's instead.
- **Editor areas** (`EnvironmentEditors`): each open environment's is rendered once and kept, hidden,
  while inactive, so switching back finds its splits, tabs and content exactly as they were.
- **The toolbar's environment selector** shows the active environment and opens worktrees as
  tabs; the branch selector acts on the active one.
- **For later:**
  - tool-window contents are re-rendered on a switch rather than kept alive;
  - agent-session status on the tabs comes with agent sessions (milestone 6).

## The main toolbar (2026-10-25)

`@cerebro-ide/ui-toolbar`, across the top of the window (the shell's `header`), as in IntelliJ's
new UI.

- **Left:** the menu bar (☰), the environment selector and the branch selector.
  - The environment selector is IntelliJ's project widget: the worktree's initials on a colour that
    stays the same for its name, then the name.
- **Right:** icon buttons that run commands, such as Search Everywhere and Settings, with tooltips
  that show their shortcuts.
- **The selectors are menus from the registry**, so choosing gets keyboard navigation, mnemonics and
  a check mark on the current choice.
  - Dynamic lists, such as worktrees and branches, register a command per entry.
  - A searchable picker like IntelliJ's branch popup can come later.
- **The playground's worktrees and branches are samples** until the host can list real ones.
  Switching updates the branch selector and the status bar.

## The status bar (2026-10-25)

`@cerebro-ide/ui-statusbar`, at the bottom of the window across its full width (the shell's
`footer`), as in IntelliJ.

- **It only lays items out.** What goes on it is still to be discussed; Ido expects it to show
  running background tasks, services, and basic information about the active environment, session
  and file.
- **Apps and plugins add items:**
  - left or right (right by default, where IntelliJ keeps most widgets), ordered;
  - reactive text and an optional icon;
  - a tooltip with the command's shortcut;
  - a command run on click;
  - an optional progress bar, determinate or indeterminate, for background tasks. It stops
    animating when the user prefers reduced motion.
- **The playground's items are samples only:** environment, active file, a fake indexing task,
  position, separator, encoding, indent and file type.

## The Electron app (2026-10-25)

`packages/app`: the main process and a preload script, around the same page `npm run dev` serves.

- **Electron 44.9.3**, pinned; 45.0.0 was out for under two weeks.
- **The toolbar is the title bar**, as in IntelliJ's new UI. From Electron's docs:
  - `titleBarStyle: 'hidden'` removes the title bar; on Windows and Linux `titleBarOverlay` draws
    the window controls over the page, coloured as the toolbar; macOS keeps its traffic lights,
    placed with `trafficLightPosition`;
  - the toolbar has `app-region: drag`, and its buttons and menus `no-drag`;
  - CSS `env(titlebar-area-x)` and `env(titlebar-area-width)` give the room the controls leave. The
    toolbar pads its right side by what they take, and its left by 80px on macOS.

  Measured on Linux (WSLg) at 1440px: the controls take 113px and the toolbar pads 119px.
- **The page is locked down**: context isolation, the sandbox, no Node. The preload script only
  tells the page it's in the app and on which platform (`window.cerebro`); the page tags `<html>`
  with `cerebro-app` and `cerebro-platform-<platform>` for its CSS. The window opens no other
  windows and navigates only within its own origin (files, for the built page).
- **Sandboxed preloads must be CommonJS** (Electron's docs), so the preload is a `.cts` file.
- **Two ways to run it:**
  - `npm run app` builds the main process, starts Vite on the playground and opens Electron on it,
    so the page reloads as the code changes; stopping either stops both.
  - Otherwise it loads the built page (`npm run build:web -w @cerebro-ide/playground`), so the
    page is built with relative URLs.
- **Tests:** the window's options and the main process, with Electron mocked; the preload and the
  real window by a smoke run with Playwright's Electron support, not yet in CI.
- **The macOS application menu** shows the page's `main` menu (ui-menu's `syncNativeMenu`):
  - the page turns its menus into a plain tree (labels without mnemonics, `…` for dialogs, enabled
    and checked states, shortcuts as accelerators) and sends it over IPC whenever it changes; the
    main process rebuilds the menu each time, since Electron's docs say a set menu's items can't be
    added or removed;
  - the main process takes only known fields from the tree, never roles, and frames it with the
    system's app menu (named from `productName`, "Cerebro") and Window menu;
  - a click sends the command back to the page, which runs it with the menu bar's context;
  - **shortcuts stay the page's**: the menu shows them, but clicks an accelerator triggers are
    ignored (Electron reports `triggeredByAccelerator`), so the keymap is the only thing that runs
    them, with its chords and user bindings. Sequences of several chords show no accelerator.
  - The in-window menu bar isn't shown there.
- **Windows and Linux have no native application menu** (2026-10-26): the menu bar is the page's
  own, and Electron's default menu (with its own Alt handling and shortcuts) is suppressed with
  `Menu.setApplicationMenu(null)`, which Electron's docs say also removes the window's menu bar.
  Found while chasing a CI flake on Linux where, after Alt+F, clicks waited forever; a claim that
  the default menu caused it, measured only by the flake stopping.

  Measured on Linux: the IPC both ways, and Electron building the template (roles, checkboxes,
  accelerators such as `Command+Plus`). Claims, still to check on a Mac:
  - the page still receives the keys of shortcuts the menu shows (if the menu took them first,
    those commands would do nothing);
  - copy and paste in text fields work without an Edit menu of Electron's roles.
- **A Content-Security-Policy** (2026-10-26) in the built page: only the page's own scripts, styles,
  images and fonts (the last two also as data: URLs); no inline scripts or styles, no eval, no
  objects, no `<base>`, no forms. Added by a Vite plugin at build time only, since the dev server
  injects inline styles. The page's inline `<style>` moved to `playground.css`. Measured with an e2e
  test: the policy is there, Electron's warning is gone, and opening the popups, dialogs and menus
  breaks no rule. Inline `style` strings set through JSX would break it (the JSX runtime sets those
  with `setAttribute`); none are used, and the e2e test would catch one.
- **The display scale** (2026-10-26; Ido: the OS's scale by default, a setting to override it):
  - **Measured under WSLg:** Electron saw a scale of 1 while Windows was at 150% (AppliedDPI 144),
    so the app looked zoomed out. WSLg doesn't pass Windows' scale on.
  - **Auto** leaves the scale to Electron natively. Under WSL (the kernel's version names
    Microsoft) it reads Windows' `AppliedDPI` from the registry through `reg.exe` (0.1 s; PowerShell
    took 2.6 s) and forces it, falling back to Electron's if that fails.
  - **The setting** Appearance › Display scale is global only: Auto, or 100% to 300%.
  - **Applied with Chromium's `--force-device-scale-factor`** before the app is ready. It isn't in
    Electron's list of switches, but `appendSwitch` passes it to Chromium. Measured: device pixel
    ratio and Electron's scale factor both 1.5, and the window controls overlay stays consistent,
    since everything scales together. Chosen over the page's zoom factor, which would scale the
    page but not the window controls drawn over it (a claim, from how zoom works; not measured).
  - **On macOS the switch is ignored** (measured in CI, 2026-10-26: the switch set to 1.25, the
    screen's scale and the page's device pixel ratio both 1). There the page is zoomed instead,
    by the scale chosen over the screen's, through the window's `zoomFactor`; the traffic lights
    keep the OS's size, which is how macOS draws them anyway. The zoom is worked out from the
    primary display when a window opens. Claude's choice, open to change.
    With no scale forced the zoom is set to 1, and it's set again once the page has loaded: a zoom
    kept from the last run overrode the window's `zoomFactor` (measured in CI: 1.25 after going
    back to Auto, with `zoomFactor` 1).
  - **Applies on the next start,** since Chromium fixes the scale when it starts; the setting says
    so. Until settings files exist, the page sends the choice to the main process, which keeps it
    in `display.json` in its data folder.
  - E2E tests: the default matches Windows' scale under WSL (Electron's elsewhere), and a chosen
    125% applies after a restart. Both fail without the feature.
- **Still to do:** packaging is milestone 3.

## Dialogs (2026-10-25)

`ui-dialog`: modal dialogs, as IntelliJ's, first of the dialogs and popups added to milestone 1
(`plan-v1.md`).

- **In the page, not separate OS windows.** IntelliJ's dialogs are their own windows; Cerebro's
  are drawn over the window, so they work the same in the browser and in Electron.
  - Nothing behind takes the pointer: a layer covers the window, without dimming it, since
    IntelliJ doesn't.
  - Presses on the layer don't take the focus from the dialog.
  - The layer is `app-region: no-drag`, so the title-bar toolbar doesn't drag the desktop window
    from under a dialog. (Claim: Chromium subtracts a covering no-drag element from the drag
    region; not yet checked by dragging.)
- **The keyboard stays in the dialog:**
  - Tab and Shift+Tab cycle through its controls;
  - Escape cancels; Enter accepts, unless the focus is on a button (which Enter presses) or in a
    multi-line field, or OK is disabled;
  - keys don't reach the app's shortcuts. The menu bar, which listens to the whole window, stands
    aside while any `aria-modal` element is open. Measured in the app: Alt+F and Ctrl+Shift+N do
    nothing while a dialog is open.
  - Closing gives the focus back to what had it.
- **Layout:** a title bar with a close button, the content, then the buttons at the bottom right:
  Cancel then OK on macOS, OK then Cancel elsewhere, as IntelliJ on each. The primary button is
  the accent colour. Opens centred; the title bar drags it, always keeping 40px of it in the
  window.
- **API:** `openDialog({ title, content, ok: { label, enabled, accept }, cancelLabel, width })`
  returns a handle whose `result` resolves with what OK accepted, or undefined. Dialogs stack.
- **`prompt()`** asks for a line of text: OK is enabled once the text is non-blank and valid, and
  the reason it isn't shows under the field in the error colour. It replaced the playground's
  `window.prompt` for New Worktree and New Branch.
- New theme variables: `--cerebro-input`, `--cerebro-input-border`, `--cerebro-error`.
- **Not yet:** while a dialog is open, the macOS native menu's commands still run, and button
  mnemonics aren't supported.

## Popups (2026-10-25)

`ui-popup`: a search field over a list, as IntelliJ's Search Everywhere, Go to File and branch
popup; the second of the dialogs and popups added to milestone 1.

- **Not modal:** a press outside, leaving the window, or resizing it closes the popup. Presses in
  its owner (the button it opened from) are left to the owner, which toggles it.
- **Keyboard:** the search field keeps the focus (clicks on items don't take it). Up and Down move,
  wrapping; Page Up and Page Down jump 10; Enter chooses; Escape closes. Keys typed into it don't
  reach the app's shortcuts. Closing gives the focus back.
- **Placement:** at the top centre (15% down, 600px wide) for Search Everywhere and Go to File;
  below an element (360px) for pickers, kept inside the window.
- **The caller searches:** `openPicker({ items: (query) => … })`, read reactively, so a list in
  hand uses `fuzzyFilter` and the host's search can come later without changing the popup. Items
  have a label, a muted detail and shortcut, an icon, and a group, shown with a header over each.
- **Matching** (`match`, `fuzzyFilter`): the query's characters in order, ignoring case. Scores
  favour adjacent runs and word starts (after a separator, or a camelCase capital), then shorter
  names. Each character's placement is searched among its likely spots (right after the previous
  match, a word start, or its first occurrence), since taking the first occurrence greedily ranked
  `st` higher in `pasta` than in `src/styles.css` (found by a test). Matched letters show in the
  accent colour, bold. IntelliJ's matching is richer; this is the start.
- **Toolbar dropdowns** can open a popup instead of a menu (`popup` instead of `menu`). The
  environment and branch dropdowns now open searchable pickers: an action (New Worktree…, New
  Branch…), then the list, the current one checked.
- **In the playground:** Go to File (Ctrl+Shift+N) and Search Everywhere (Ctrl+Shift+A; files, then
  enabled actions with their shortcuts) use it; Go to File no longer uses `window.prompt`. Actions
  run from there without a context, so tab commands don't show; a proper action context comes with
  the real Search Everywhere.
- **Not yet:** the list isn't virtualised (all matches render); that comes with the lists of
  milestone 2.

## Settings (2026-10-25)

`settings` (the model) and `ui-settings` (the Settings dialog), from milestone 1's "settings layered
global → repo → worktree".

- **Registered settings:** each has an id (`editor.fontSize`), a title, a page, a type (boolean,
  number with optional min, max and integer, string, or enum with options) and a default. A setting
  may name the scopes it can be set in; a theme is global only.
- **Layers:** global (the user's), repo (shared by its worktrees) and worktree. An environment sees
  the narrowest layer that sets a valid value, then the default. All of it is reactive.
- **Values from files are checked:** invalid values of known settings are dropped; values of
  unknown settings are kept, since their plugin may not be loaded yet, and are checked again when
  read.
- **The dialog**, as IntelliJ's: a search field over a tree of pages, the page's settings on the
  right, and OK, Cancel and Apply. Above the page, the scope being edited: Global, Repository,
  Worktree (named after the repo and worktree). Choices of Claude's, open to change:
  - each setting shows its value at the scope being edited, inherited unless set there; one set
    there has its title in the accent colour and a Reset;
  - one set in a narrower scope says "Overridden in …", since that's what the environment sees;
  - one that can't be set in the scope is disabled there ("Global only");
  - edits are a draft until Apply or OK; Cancel drops them;
  - the search filters the tree by page and setting titles.
- **Apply on dialogs:** `openDialog` takes an `apply` button, which OK also runs. Button order:
  OK, Cancel, Apply elsewhere; Cancel, Apply, OK on macOS (claim: IntelliJ's macOS order, not
  checked).
- **In the playground:** sample settings (theme, soft wrap, tab size, font size, a branch prefix),
  saved per layer in the browser's storage until the host saves files. The theme toggle writes the
  global setting; each environment's sample code follows its font size, soft wrap and tab size.
  Measured in the app: font size 18 set at Worktree scope applied, was saved to that worktree's
  layer only, and survived a reload.
- **Where the files live** (Ido, 2026-10-25):
  - global: the user's config directory (`~/.config/Cerebro/settings.json` on Linux);
  - repo: **in the repo, committed** (like `.vscode/` or `.idea/`), so it can be shared and travels
    with clones to other machines. Considered and rejected: the repo's git directory
    (`.git/cerebro/`), shared by its worktrees but lost with the clone, and impossible to share or
    clone elsewhere. Later, maybe: a combination with Cerebro's own data directory, for settings
    that shouldn't be committed.
  - Since each worktree is its own checkout, each reads the committed file from its own branch.
  - **Settings files live in two places only:** in the repo or in the app's directory (Ido). The
    location could later be configurable, through a global setting (the global file is the one
    at a fixed path).
  - **Local data goes in the local database** (Ido): the host's database, beside the session
    database. It isn't shared, since it can be recreated on another machine. Read as covering the
    worktree layer: a worktree's settings are local data, not a file.
  - **The repo file is `.cerebro/settings.json5`, in JSON5** (Ido): JSON with comments, trailing
    commas and unquoted keys, so people can annotate shared settings. The global file takes the same
    format, `settings.json5` in the app's directory. The extension is `.json5` rather than the
    proposed `.json`, so editors don't flag the comments. Reading it needs a JSON5 parser in the
    host (the `json5` package, or a small one of Cerebro's; to choose then). Saving needs the host.
- Keybindings aren't settings pages yet.

## The layout persists (2026-10-26)

Ido: the layout should keep its state and stay consistent between runs; a reload reset it.

- **What's kept:** tool windows (anchor, slot, order, which are open, area sizes and splits), the
  open environments and the active one, and each environment's editor area (splits and sizes,
  groups, tabs, active tab and group).
- **The models save and restore themselves** as plain data (`state()` and `restore()` on
  `ToolWindows`, `EditorArea` and `Environments`). Restoring keeps only what's still valid, a
  choice of Claude's, open to change:
  - tool windows: places of registered windows (new ones keep their own, after the saved ones),
    sizes and splits clamped, open windows only if registered and in that slot;
  - environments: only those the app still resolves (a removed worktree is dropped);
  - editor areas: tabs that still exist (a repository's files are all kept and read again from
    disk, one that's gone saying so; of the samples, untitled files aren't kept: their contents
    aren't),
    groups with tabs, splits with two or more children, merged into a parent of the same
    direction, and positive sizes (others get an equal share). Saved sizes are kept even below
    `MIN_PANE`, since repeated splits can make them so.
- **Stored as local data** (as decided for settings): the browser's storage for now, until the
  host's local database exists. Saved 200 ms after a change settles, and when the page goes away.
- **Tests:** the randomized tests save every few steps, through JSON, restore into a new model
  (tool windows registered in another order) and compare. Unit tests cover invalid and outdated
  data. An e2e test rearranges the window (a tool window closed, another opened, another
  environment, a file opened), reloads, and finds the same layout; it fails without saving.

## The shared index, first part (2026-10-26)

Milestone 4's index, from the spike (`spike-multi-worktree.md`), moved into the host. Choices of
Claude's, open to change:

- **`index`:** the spike's blob-keyed tree-sitter index. Each distinct file content (git blob) is
  parsed once, whichever worktrees have it. Per blob: definitions (the grammars' tags queries, plus
  the type aliases, enums, fields and top-level constants the spike added) and every identifier's
  positions by name.
- **TypeScript, TSX and JavaScript**, as the spike measured; **Python and Bash** added after
  (`tree-sitter-python` 0.25.0 with its tags query, `tree-sitter-bash` 0.25.1 with a query of
  Cerebro's: functions as definitions; variables, functions and command names as identifiers).
  Measured: their ABI 15 grammars load in web-tree-sitter 0.25.10. JSON, YAML, CSS, HTML and
  Markdown have nothing to navigate by name, so they aren't indexed. The grammars' native install
  scripts are denied, as for the others.
- **The working tree counts:** tracked files take their blob hash from git's index (`git ls-files
  -s`); modified and untracked source files are hashed with `git hash-object` and parsed from disk;
  deleted ones drop out.
- **The host** keeps one index per repository and indexes a worktree on first use, then again
  (incrementally) once its last indexing is over 2 seconds old, so a search doesn't run git on every
  key. Methods: `index.symbols` (names containing the query; exact, then prefix, then shorter
  names; at most 200), `index.definitions` and `index.usages` (exact name). Paths are the
  worktree's, joined with `/`.
- **In the UI, everything says "Name matches":** Go to Symbol (Ctrl+Alt+Shift+N, as IntelliJ), go to
  definition (Ctrl+B or Ctrl+click on a word: one definition opens directly, several show a list)
  and find usages (Alt+F7). The editor scrolls to the place, selects it and takes the focus, as
  IntelliJ does after navigating.
- **Popups can ask elsewhere** (`onQueryChange`): Go to Symbol asks the host as the query changes,
  and only the latest query's answer counts. `items` itself can't start a search: it runs as a
  computed value, which may not write.
- **Dependencies:** `web-tree-sitter` 0.25.10, `tree-sitter-typescript` 0.23.2 and
  `tree-sitter-javascript` 0.23.1, the versions the spike measured (newer `web-tree-sitter` exists;
  its compatibility with these grammars isn't measured). The grammars' install scripts build native
  addons Cerebro doesn't use (it loads their `.wasm`); they're denied in `allowScripts`, and their
  optional native `tree-sitter` peer isn't installed.
- **Warmed up, with progress** (2026-10-26): measured on ag-charts (5,231 source files), the first
  indexing took 14 s (re-indexing 0.15 s, a search 24 ms, 473 MB), so a first Go to Symbol would
  wait. A worktree is now indexed as soon as it becomes active (`index.warm`), and the host reports
  progress every 200 files (`index.progress`, forwarded by the main process to the page), yielding
  between batches so its other requests aren't held up. The status bar shows "Indexing… n / total"
  with a bar, then "Indexed". (The status bar's contents are still Ido's to settle; this replaces
  its sample background task in the app.)
- **Not yet:** persisting the index to disk (it's rebuilt per host run).
- **Measured in the app (e2e):** the tree-sitter WASM loads in the host on Electron's Node; Go to
  Symbol, Ctrl+click and Alt+F7 work on a throwaway repository, and fail without the index.

## Find file (2026-10-26)

Milestone 2's find file. Choices of Claude's, open to change:

- **The host lists a worktree's files** (`git.files`) with `git ls-files --cached --others
  --exclude-standard`: tracked files, and untracked ones git doesn't ignore. No new dependency, and
  `.gitignore` is honoured as git does it.
- **Go to File and Search Everywhere** search the active worktree's files in the app (the samples
  in a browser). The list is fetched each time a popup opens, so new files show; the previous list
  shows meanwhile.
- **Matching got faster** (measured on 50,000 paths in Chromium, per keystroke): broad queries
  (`f`, `file`) from about 85–110 ms to 50–70 ms, selective ones (`sub3file9`) from 240 ms to 24 ms.
  How: a plain in-order check rules out non-matches before the scoring search; word starts are
  found by character code for ASCII; the search's memo and word-start buffers are shared and reused
  rather than allocated per path. Results are unchanged (the matching tests pass as before).
- **A popup draws at most 200 rows** and counts the rest ("N more; type more to narrow them
  down"): drawing tens of thousands of matches for one letter would be slow and of no use.
- **Text search** (the plan's ripgrep) isn't done: shipping ripgrep means a binary for each OS
  (a new dependency), while `git grep` needs none but searches only what git knows about. Ido's to
  decide.

## The code editor (2026-10-26)

Milestone 2's CodeMirror editor, with syntax highlighting for the target languages (`ui-editor`).
Choices of Claude's, open to change:

- **Read-only for now.** Files open from the project tree and show their text; saving needs its
  own design (conflicts with what agents change, encodings, line endings). (Changed 2026-10-26:
  editable, see "Editing and saving".)
- **Languages by extension:** TypeScript and JavaScript (`ts`, `tsx`, `mts`, `cts`, `js`, `jsx`,
  `mjs`, `cjs`), JSON, CSS, HTML, Markdown, Python, YAML, and Bash through CodeMirror's legacy
  shell mode. Anything else is plain text.
- **Colours are theme variables** (`--cerebro-syntax-*`, `--cerebro-editor-*`), taken from
  IntelliJ's dark and light themes, so the editor follows the theme.
- **The editor settings apply live:** font size, soft wrap and tab size, per environment.
- **In a shadow root.** CodeMirror adds its styles with `style-mod`, which uses constructable
  stylesheets inside a shadow root but `<style>` elements in a document (read in its source), and
  the page's Content-Security-Policy blocks those: in the app, no syntax colours or font size
  applied. In a shadow root, measured in the app: the colours and settings apply and the policy
  reports no violation. Rejected: allowing inline styles, and a fixed nonce, which is no
  protection in a static page.
- **The host reads files** (`fs.read`) as UTF-8, refusing binary files (a NUL byte in the first
  8 KB, as git decides) and files over 10 MB, with the reason, which the editor shows.
- **New dependencies:** CodeMirror's packages (`state`, `view`, `language`, `commands`, the language
  packages and `legacy-modes`) and `@lezer/highlight`, all by CodeMirror's author, each pinned to a
  version at least two weeks old. Three packages pulled in by them were newer, so they're pinned too
  (`@codemirror/autocomplete` 6.20.3, `@lezer/common` 1.5.3, `@lezer/markdown` 1.8.0), as
  `ui-editor` dependencies and root `overrides`.
- The bundle grew past 500 kB with the grammars; loading languages on demand can come later.

## The project tree (2026-10-26)

Milestone 2's project tree: a virtualised tree on observable collections. Choices of Claude's, open
to change:

- **`ui-tree`:** a model (expanded nodes, children loaded lazily the first time a folder opens,
  the visible rows, the selection) apart from the view, so it's tested without the DOM. Children
  come from a source, synchronously or not. A failed load keeps its error, and reloading retries.
- **Virtualised:** fixed-height rows (24 px); only the rows in view, plus 8 either side, are in the
  DOM, in a spacer as tall as all the rows. Measured in the tests: 10,003 rows draw 28 elements,
  36 after scrolling to the middle.
- **Keyboard as IntelliJ's project tree:** Up and Down, Home and End, Page Up and Page Down (a
  screen less one row), Right expands or steps in, Left collapses or steps out, Enter opens a file
  or toggles a folder. Click selects, double click opens or toggles, the arrow toggles. Collapsing a
  folder moves a selection inside it to the folder, as IntelliJ does.
- **The host lists a folder** (`fs.list`): folders first, then files, by name ignoring case;
  `.git` isn't listed. Ignored files show, in the ignored colour (changed 2026-10-27, from Ido:
  "the file viewer is missing indication of ignored files (different font color)"): `fs.list`
  marks the entries git ignores, files in an ignored folder too, asking `git check-ignore -z
  --stdin` (names on its input, so none is quoted and no command line is too long; `-z` works only
  with `--stdin`, measured). The colour is the Commit window's `--cerebro-vcs-ignored`, on the name
  alone.
- **Every row is as wide as the widest drawn row** (changed 2026-10-27, from Ido: the selection
  "doesn't reach all the way to the end"): rows are absolutely placed, so a long name scrolled the
  tree sideways while the rows, and the selection's colour, stayed as wide as the view. Only the
  rows drawn are measured; the widest seen is kept while the rows stay the same, so scrolling down
  past a long row doesn't narrow them (Ido: "the problem appears when scrolling vertically"). It
  starts again when a folder opens or closes, the tree is refreshed, or it's resized.
- **The Project tool window** shows the active environment's tree, one per environment so each keeps
  its open folders. Files come from the host in the app, and from the sample paths in a browser.
  Opening a file opens a tab named after it, known by its path; its contents are still the sample
  text until the editor reads files.
- **Tests:** the model (with a randomized test: the selection always shows, rows only under open
  folders), the view (virtualisation, keys, mouse, real input), the host listing a real folder, and
  e2e: a throwaway repository's tree, a folder opened, a file opened. Fails without the host's
  files.

## Creating and removing worktrees (2026-10-26)

Milestone 2's first item: the worktree list, from `git worktree list`, with create and remove.
Choices of Claude's, open to change:

- **The host** adds `git.addWorktree` (a path and a branch, new from a starting point or existing)
  and `git.removeWorktree` (a path; `force` for one with changes). Each answers with the
  worktrees after. Git's own rules hold: a worktree with changes isn't removed unless forced, and
  the main one never is.
- **New Worktree** asks for a name (letters, digits, dots, dashes, underscores) and creates the
  worktree beside the main one (`<main's parent>/<name>`), on a new branch of the same name, from
  the active environment's branch, then opens it. IntelliJ asks for the path and branch
  separately; a fuller dialog can come later.
- **Remove Worktree…** is on an environment tab's context menu, disabled for the main worktree. It
  asks first, saying the folder is deleted and the branch stays. If git refuses because of
  changes, a second dialog offers Remove Anyway. Failures show git's message in a dialog.
- E2E tests against a throwaway repository: create, remove, remove with changes (forced), and
  remove offered for a linked worktree but not the main one. Creating and removing fail without
  the host.

## The protocol and the host (2026-10-26)

Milestone 1's protocol: JSON-RPC over stdio, with the host started as a local child process
(`architecture.md`). Choices of Claude's, open to change:

- **`protocol`:** JSON-RPC 2.0, with no Node or DOM dependency, so the UI, the main process and the
  host all use it. Either side sends requests and notifications. A request is cancelled with a
  `$/cancelRequest` notification, as in the Language Server Protocol, and fails with
  `RequestCancelled` (-32800); the handler gets a cancellation token. Requests waiting when the
  connection closes fail with `ConnectionClosed` (-32099). Malformed messages get the standard
  JSON-RPC errors.
- **Framing: one message per line** (newline-delimited JSON) rather than LSP's `Content-Length`
  headers: `JSON.stringify` never emits a raw newline, so a line is a message, and it's simpler to
  read and debug over `wsl.exe` or `ssh`. A line split across chunks is joined (`LineReader`).
- **`host`:** a Node process serving the protocol on stdin and stdout for a repository (its folder,
  or `CEREBRO_REPO`). It exits when its input ends. First methods: `host.ping` (the protocol's
  version, 1) and `git.worktrees` (from `git worktree list --porcelain`: path, commit, branch,
  whether it's the main one, bare).
- **Started from Electron's main process** with Electron's own Node: `process.execPath` with
  `ELECTRON_RUN_AS_NODE=1` (Electron's docs: "Starts the process as a normal Node.js process"), so
  no separate Node is needed. Electron's `utilityProcess` was the alternative, but its documented
  stdio options cover stdout and stderr, not stdin, and stdio is the transport WSL and ssh will
  use. The host stops when the app quits.
- **The page reaches the host through IPC:** the preload's `cerebro.host.request(method, params)`,
  forwarded by the main process. Errors cross as messages.
- **The playground in the app** lists the repository's real worktrees (named after their folders,
  known by their paths) instead of the samples, opening the main one; in a browser, or if git
  fails, the samples stay.
- **Tests:** the protocol between two connected connections (both directions, errors,
  cancellation, malformed input, closing); the host's methods, with real git on a throwaway
  repository; the main process with a fake child. E2E: the page pings the host, and lists a
  throwaway repository's two worktrees, switching branch with the worktree. Both fail without the
  host.

## Plugins (2026-10-26)

Milestone 1's plugin registry and first contribution points: views, commands, menus
(`plugin-api`). Choices of Claude's, open to change:

- **A plugin** has an id (dotted by publisher, such as `cerebro.notes`), a name, and `activate`,
  which may be async.
- **It contributes through its context:** commands, menu items, default shortcuts (the user's
  bindings still come first), views, and cleanups. The context records each, so removing the plugin
  removes everything it added, in reverse order.
- **A view is a tool window** (place, title, icon) and a `mount(container)` that fills a DOM
  element however the plugin likes, returning an optional cleanup: the plugin boundary is the DOM
  (see "No UI framework"). Other kinds of views (editor tabs, status bar items) come later.
- **A failing activation** removes what the plugin added so far, and its entry records the error
  (state `failed`); the others are unaffected.
- **Not yet:** loading plugins from disk, manifests, versions, permissions, and running plugins in
  isolation. Plugins are added in code for now.
- **In the playground:** a sample Notes plugin written in plain DOM, as a third party would: a
  tool window, a Clear Notes command in the View menu and in Search Everywhere, and a shortcut
  (Ctrl+Alt+Shift+K; it was Ctrl+Alt+Shift+N until Go to Symbol took that, as in IntelliJ). An
  e2e test uses all of it, and fails without the plugin.

## Language servers, first part (2026-10-27)

The plan's milestone 5, and the stage "A basic IDE before git and agent management" (Ido:
"language servers first"): go to definition and find usages by meaning, not by name. TypeScript and
JavaScript, then Python and shell scripts; the other languages follow, each its own change. Claude's choices, open to
change.

- **TypeScript's own server: TypeScript 7's `tsc --lsp --stdio`,** not vtsls or
  typescript-language-server (the plan's choices, written before TypeScript 7 shipped). TypeScript
  7 (7.0.2 published 2026-07-08, per npm) speaks the Language Server Protocol itself; the other two
  wrap the older tsserver in a second process. Measured on Cerebro's own repository (this WSL
  machine): the first go to definition, starting the server, answered in 91 ms; find usages in
  74 ms. The spike measured about 7 s for tsserver's warm-up.
- **Python: basedpyright 1.40.2** (published 2026-10-04, per npm), the plan's choice: pyright's
  server, with fixes. JavaScript with no dependencies and no install scripts (27.9 MB unpacked, per
  npm), run by the Node the host runs in (Electron's binary, as Node). Its usages include the
  imports, as IntelliJ's do (a claim); TypeScript's leave them out.
- **Shell scripts: bash-language-server 5.8.1** (published 2026-09-19, per npm), the plan's
  choice. 36 packages, none with install scripts, run by the host's Node.
  - **Its zod overridden to 4.6.6** (2026-10-11): it pins zod 3.25.76, which has a high-severity
    advisory (GHSA-mrhx-c7xc-m3w5, memory exhaustion; fixed in 4.6.6). With 4.6.6 its real-server
    test passes, and `npm audit` finds nothing. Here zod only reads the settings Cerebro sends
    (none), so the risk was low anyway (a claim).
  - **Under WSL it gets a PATH without the Windows folders** (`/mnt/c/...`). It lists the PATH's
    programs before answering anything: measured 5.8 s to start with them, 257 ms without. Those
    programs only matter for completions.
- **A server is asked once it's read the project,** when it says so. basedpyright reports no
  progress, but logs "Found N source files". Asked before then, it answers as if only the open
  files existed (measured: no usages in an unopened file at once; found 3 s later). Questions wait
  for that line, within the 3 seconds, and the name matches show meanwhile. bash-language-server
  likewise, on "BackgroundAnalysis: Completed" (measured the same way: no usages at once).
- **`CEREBRO_LANGUAGE_SERVERS`** names the servers that run (`typescript`, `python`, `bash`,
  comma-separated; empty for none; all when unset). The end-to-end tests of the name matches turn
  them off with it, since every language the index reads now has a server. It's also a way to rule
  a server out when something's wrong.
- **A new package, `servers`,** says which server reads which file and how it's started.
  `typescript` 7.0.2 is its dependency alone, so its `tsc` doesn't replace the TypeScript 6 the
  build uses in other packages' scripts. Its executable is the platform package npm installs
  (`@typescript/typescript-<platform>-<arch>`); no install scripts.
- **The host's own LSP client** (`lsp.ts` in `host`), over a server's stdin and stdout with LSP's
  `Content-Length` framing, reusing the protocol's `Connection`. **A lazy pool:** one server per
  worktree and server, started when a file of its language opens, stopped after 10 minutes unused
  (a claim: long enough to come back to a worktree), as "Many worktrees must be proven solvable"
  planned.
- **Only in a project TypeScript sees whole:** a file with a `tsconfig.json` or `jsconfig.json` in
  its folder or one above, within the worktree. Without one, TypeScript's server makes a project
  of the open files alone. Measured in the app: Find Usages said "No usages" where an unopened file
  called the function. Such files get the name matches instead.
- **The file as the editor has it:** each request sends the file's text, so unsaved edits are
  answered as they are (the server's copy follows them).
- **Name matches when no server answers:** a language without a server, a server that fails, or
  one that doesn't answer within 3 seconds (a claim) falls back to the index's "Name matches". A
  server's answer shows without that heading. Find usages leaves the declaration out, as
  IntelliJ's.
- **Not yet:**
  - **YAML:** yaml-language-server 2.0.0 is under two weeks old, so it waits.
  - **HTML, CSS, JSON and Markdown:** they gain little for navigation. With diagnostics,
    completions and hover, Cerebro would wrap Microsoft's maintained libraries
    (`vscode-css-languageservice` and the others) itself. vscode-langservers-extracted, last
    released in 2024 with TypeScript 4, wraps the same libraries, and marksman isn't on npm.
  - Diagnostics, hover and completions.

## Navigation (2026-10-27)

The stage "A basic IDE before git and agent management" (Ido): "Ctrl/Cmd+click to a declaration,
Back and Forward, Recent Files, Go to Line, selecting the opened file in the project tree". As
IntelliJ's; choices of Claude's where IntelliJ doesn't decide, open to change.

- **Back and Forward,** as IntelliJ's Navigate → Back and Forward (`NavigationHistory` in
  `layout`), one history per environment. A place is a tab and its caret. A place is left when
  another tab becomes active (opened, chosen, or the one shown after a tab closes), and when a
  navigation jumps within a file (go to definition, a Find in Files result). Back returns to the
  last place left; Forward undoes it; going somewhere new forgets the places ahead. A place once,
  however often it's left from the same line. 50 places kept (a claim: IntelliJ keeps a few
  dozen; not measured).
- **Shortcuts as IntelliJ's default keymaps:** Ctrl+Alt+Left and Ctrl+Alt+Right on Windows and
  Linux, Cmd+[ and Cmd+] on macOS; and the mouse's back and forward buttons. A Navigate menu
  after View holds them, as IntelliJ's. The editor no longer takes Cmd+[ and Cmd+] for
  CodeMirror's indent less and more (Ctrl+[ and Ctrl+] elsewhere): IntelliJ indents with Tab and
  Shift+Tab.
- **Recent Files** (View → Recent Files, Ctrl+E, Cmd+E on macOS), as IntelliJ's: the files shown in
  the environment, the latest first, closed ones too, with the one before the current highlighted,
  so Ctrl+E then Enter goes back to it. Typing filters. Diffs aren't files, so they aren't listed.
  50 kept (IntelliJ's default "Recent files limit", a claim: not measured) (`RecentTabs` in
  `layout`).
- **Go to Line** (Navigate → Line/Column, Ctrl+G, Cmd+L on macOS), as IntelliJ's "Go to
  Line:Column" dialog: `[Line] [:column]`, counted from 1, filled with the caret's place and
  selected. A column alone stays on the line; a line alone goes to its start. It's a place left,
  for Back. Not in a diff.
- **Select Opened File:** IntelliJ's crosshair button in the Project tool window's header (tool
  windows take header buttons through `ShellLayout`'s `actions`). It shows the Project tool window
  and selects the active file, opening the folders down to it (`TreeModel.reveal` in `ui-tree`);
  the focus stays in the editor.
- **Back and Forward show a place as it was scrolled** (changed 2026-10-27, Ido's polish pick): a
  place keeps the line at the top of its editor, and going back puts that line at the top again,
  rather than centring the caret. The editor reports the line as it scrolls (`onScroll`), read
  once CodeMirror has measured the lines: before, their heights are estimates.
- **Recent Files is kept between runs** (changed 2026-10-27): per environment, in the browser's
  storage with the layout, as IntelliJ keeps it. A file deleted since is still listed.
- **Not yet:** caret moves by typing or clicking far away aren't places (IntelliJ counts some).
  Recent Files lacks IntelliJ's tool windows column and "Show edited only". IntelliJ's "Always
  Select Opened File" option and Alt+F1's Select In aren't there.

## Gutter markers: what a member implements or overrides (2026-10-28)

From Ido, with a screenshot of IntelliJ: the icons between the line numbers and the text that go to
the interface member or super method; first put in the backlog, then asked for ("Do phase 3 now
too"), with arrows both ways (his choice).

- **Worked out from what the servers offer,** as neither TypeScript 7's server nor basedpyright
  offers the type hierarchy request (measured: neither lists `typeHierarchyProvider` in its
  `initialize` answer); both answer `documentSymbol` and `implementation` (measured). The host
  does it (`lsp.markers`, `packages/host/src/markers.ts`), for a whole file at once:
  - **Down** (is implemented, is overridden): each type's and member's implementations, from the
    server, but itself (both servers include it, measured).
  - **Up** (implements, overrides): the names in a type's header (after `extends`/`implements`, or
    in Python's parentheses), each taken to its definition; a member of the nearest base with the
    member's name is the one. By name, as both languages override. Bases are followed up to 8 deep
    (a claim), each once.
  - "Implements" when the base is an interface or the member there is abstract (`abstract`, or
    Python's `@abstractmethod`); "overrides" otherwise. Likewise down.
  - Files the bases are in are read from disk, or taken as the server has them when open.
- **Asked as a file opens, and 500 ms after an edit** (a claim: typing isn't held up); waited for
  up to 30 s (a claim: a server still loading its project). An answer for text since edited is
  dropped; what's shown moves with edits.
- **IntelliJ's own icons** (`platform/icons/src/expui/gutter`, Apache 2.0): their shapes, their
  colours as theme tokens, dark and light from its files. In the 42px WebStorm leaves after the
  numbers (measured before); where in it is a claim.
- **A click goes there;** several places offer a list to choose from. Its titles ("Implementations
  of", "Super methods of") are a claim, not measured.
- **Not yet:** shell scripts (bash-language-server offers neither request, measured), and a
  marker's tooltip naming where it goes (IntelliJ's "Implements method in Shape").
- **Rejected:** matching by name across the project, as the index does: it can't tell which `run`
  is meant, which is why the servers are asked.

## Usages at the caret, and links with Ctrl held (2026-10-28)

From Ido, with screenshots of IntelliJ: the symbol at the caret highlighted wherever it is in the
file, by its references, not its text ("extraProps is only highlighted under the same function
scope"); and with Ctrl or Cmd held, a word that has a definition shown as clickable, in another
colour and underlined.

- **The language server's document highlights** (`textDocument/documentHighlight`), asked through
  the host (`lsp.highlights`) once the caret has stayed for 100 ms (a claim: unnoticed). All three
  servers offer them (measured: each one's `initialize` answer), and each tells apart two variables
  of one name in two functions (host tests against the real servers). A server's write (LSP's kind
  3: assigned, declared with a value) is drawn apart from a read, as IntelliJ's.
- **Drawn as a layer beneath the selection,** as the caret's line is, so a selection over a usage
  shows. An answer for a place the caret has left, or for text since edited, is dropped; what's
  drawn moves with edits until the next answer.
- **IntelliJ's colours,** from its schemes' `IDENTIFIER_UNDER_CARET_ATTRIBUTES` and
  `WRITE_IDENTIFIER_UNDER_CARET_ATTRIBUTES`: Islands Dark (`IslandSchemeDark.xml`) `#373b39` and
  `#402f33`; Light (`expUI_lightScheme.xml`, the Islands Light editor scheme) `#edebfc` and
  `#fce8f4`.
- **The link:** with Ctrl or Cmd held (either, as Ctrl+click and Cmd+click already go to a
  definition), the word under the pointer, when it has a definition: the language server's, or a
  name match in the index when no server answers. In `CTRL_CLICKABLE`'s colour, underlined:
  `#548af7` dark, `#006dcc` light. Only while the pointer is over the word, not beside it at its
  line's end. Pressing Ctrl with the pointer still shows it too.
- **Not yet:** the usages' marks on the scrollbar. (IntelliJ's gutter icons came next: "Gutter
  markers".)

## Scrollbars over the content (2026-10-27)

Ido: "in intellij the scrollbar are transparent over the window and don't take their own space, so
if text/code is under the scrollbar it's visible. Can we do that too?"

- **Cerebro draws its own thumbs** (`@cerebro-ide/ui-scrollbar`): the browser's scrollbars are
  hidden (`scrollbar-width: none`), and one layer over the page draws the thumbs of the scroll
  areas under the pointer, and of an area while it scrolls, fading out a second after. Thumbs can
  be dragged. It finds scroll areas itself, so no package wires anything, and it reaches shadow
  roots (the editor's) once the pointer or the focus has been in them. A shadow root hides its own
  scrollbars (the editor's theme does).
- **As IntelliJ's (its source, `intellij-community`):** on Windows and Linux a transparent bar's
  thumb is 10px and keeps its width under the pointer, only less transparent
  (`DefaultScrollBarUI`); on macOS it's rounded (`ScrollBarPainter`), and widens from 11px to 14px
  while hovered when scroll bars show only while scrolling (`MacScrollBarUI`). Cerebro's: 10px,
  rounded, 2px from the edge, the same width under the pointer (Ido saw only the colour change in
  his macOS screenshots). Colours: Islands Dark's (`ManyIslandsDark.theme.json`, `#808080` at 35%,
  55% hovered); Islands Light sets none, so IntelliJ's defaults (`#737373` at 20%, 28%). Showing on
  hover and fading after a scroll is Claude's choice, open to change.
- **Thumbs avoid obstacles** (changed 2026-10-28; Ido, with screenshots of IntelliJ: "they don't
  take the entire available space, they avoid obstacles"). A thumb moves along a track that stops
  14px short of the other bar when the area scrolls both ways (12px for that bar, 2px between), so
  the two never meet in the corner. It also stops short of anything in the area marked
  `data-scrollbar-obstacle` that overlaps the bar, at the track's end nearer to it. The editors
  mark their gutters, so the horizontal bar starts after them. A toolbar over an area's top would
  start the vertical bar below it; the editor's find bar is above its scroll area, so it already
  does. Before, both bars ran along the whole edge and crossed in the corner. A standing rule in
  `.claude/rules/ui.md`.
- **Measured:** before, the editor and the Project tree gave 12px to their scrollbar; now 0 (e2e
  test "draws scrollbars over the content").
- **Rejected: Chromium's overlay scrollbars** (`--enable-features=OverlayScrollbar`). Measured in
  Cerebro's Electron: they take no room only without `::-webkit-scrollbar` styles, and then draw
  a track and arrow buttons and didn't fade in 3 seconds; `scrollbar-color` colours them but keeps
  the arrows and never hides them.
- **The track** (added 2026-10-28, Ido chose it from the list of what was left): under the pointer,
  or while its thumb is dragged, a bar shows its track, as IntelliJ's. Its colour is IntelliJ's
  hovered track on a transparent bar, `#808080` at 10% (`0x1A808080` in `ScrollBarPainter`;
  Islands Dark sets the same, Islands Light none), a plain rectangle in the thumb's band. Pressing
  the track scrolls a page (what the area shows) towards the press. The page's size is Claude's
  choice, open to change.
- **Each area's thumbs are in a layer of their own** (2026-10-28), added to the page when the area
  gets them. Before, all were in one layer, moved to the end of the page whenever an area got
  thumbs: a thumb fading out under a popup then came over it.
- **Not yet:** the macOS widening; holding the press on a track doesn't repeat it (Swing's does: a claim, not checked).

## Window buttons in full screen on macOS (2026-10-27)

Ido: "it's always visible in intellij, it's us that drop them in full screen mode, and we
shouldn't". In full screen, macOS hides the traffic lights until the pointer reaches the top of the
screen, which left the room kept for them empty.

- **Real buttons, made by AppKit, put in the window where the traffic lights were** (changed
  2026-10-27, from buttons drawn in the page), as JetBrains Runtime does for IntelliJ (`setWindowFullScreenControls` in
  `AWTWindow.m`, on in the new UI through `apple.awt.newFullScreenControls`): close, minimize and
  zoom from `[NSWindow standardWindowButton:forStyleMask:]`, in a view over the window's content.
  Until the pointer is over them they're three 12px grey circles; under it, close and zoom show as
  themselves, minimize staying grey (it does nothing in full screen). The grey is the theme's
  `MainWindow.FullScreeControl.Background` (Islands: `#575A5C` dark, `#7A7B80` light), sent by the
  page with its other window colours. The copies macOS shows when the menu bar slides down are
  hidden, as JetBrains Runtime hides them, so they don't show twice.
- **Why it changed:** the first version drew the buttons in the page, and Ido: "it's very obvious
  that you're faking the buttons. they don't keep the same size, and they loose builtin os
  functionality, such as hovering the fullscreen button doesn't show the layout options". Real
  buttons are macOS's own, with its size and behaviour.
- **A native module of Cerebro's own** (`packages/app/native/fullscreen.m`, Objective-C over
  Node-API), since Electron has no option for it: it leaves the buttons to macOS in full screen
  (`native_window_mac.mm`). The main process loads it (`packages/app/src/fullscreen.ts`) and gives
  it the window's `getNativeWindowHandle()` as it enters and leaves full screen. Built on macOS by
  one `clang` call (`packages/app/scripts/native.mjs`, run by the app's build), against the running
  Node's headers: Node-API is the same in Electron. No new dependency; rejected: node-gyp (a
  dependency for one file) and an FFI such as koffi (84 MB, with an install script). Claude's
  choice, open to change.
- **Measured on CI's macOS** (the end-to-end test): the buttons are AppKit's own
  (`_NSThemeCloseWidget`, `_NSThemeWidget`, `_NSThemeZoomWidget`), 14×14, 23px apart, the first at
  (14, 13), where the traffic lights sit out of full screen. **Claims, not measured:** that the green button keeps its
  window-layout menu under the pointer (it's the same AppKit button; JetBrains Runtime relies on
  it), and how they look; Ido to check on his Mac.
- **Not yet:** the Welcome window in full screen has them too, over no toolbar; leaving full screen
  takes them out when it's done, not as it starts, as JetBrains Runtime does (Electron has no
  "will leave" event).

## The window's colours follow the theme (2026-10-27)

Ido: "have you already noticed that the windows min/max/close buttons don't play nicely with light
mode?"

- **The page sends its theme's frame and text colours** to the main process when the theme changes
  (`window.cerebro.setColours`, `packages/app/src/colours.ts`), which sets the window's background
  and, on Windows and Linux, the title bar overlay's colours (Electron's `setTitleBarOverlay`).
  macOS draws its own traffic lights. Only `#rrggbb` colours are taken.
- **Measured:** the e2e test "draws the window controls in the theme's colours" sees the overlay set
  to the light theme's colours, then the dark theme's.

## Tabs that don't fit (2026-10-27)

Ido's report (2026-10-26, with screenshots of IntelliJ): with more tabs than room, editor tabs were
squeezed ("pack…") and the rest couldn't be reached.

- **The strip scrolls; tabs keep their width,** as IntelliJ's single row of tabs. The active tab is
  scrolled into view whenever it changes, with a little of the next tab showing past the cut edge;
  the mouse wheel scrolls the strip sideways. Rejected: squeezing tabs (what was there), and wrapping
  them onto several rows (IntelliJ's other option, not its default).
- **A cut edge fades** (a 32-pixel `mask-image` gradient), at the start, the end, or both.
- **No scrollbar over the tabs** (Ido, 2026-10-27: "No scrollbar on the tabs! But mouse event should
  still work"): a strip is marked `data-scrollbar="none"`, which `ui-scrollbar` leaves without
  thumbs; the wheel still scrolls it. The middle button's mousedown is cancelled in a strip, so it
  closes a tab rather than starting Chromium's autoscroll on Windows (a claim, from a Windows-only
  e2e failure).
- **A chevron after the tabs, shown only while some are hidden, lists every tab:** its icon, its
  name, and a close button shown on hover, the active one highlighted; typing filters it, as every
  popup. It's the `ui-popup` picker, which gained an item close button for it, so `ui-layout` now
  depends on `ui-popup` (both Cerebro's own packages).
- **For any tab bar:** `TabOverflow`, `watchOverflow`, `overflowClasses` and `MoreTabs` in
  `ui-layout` take a strip and its tabs; the editor uses them first, the Terminal tool window's tabs
  when it holds several terminals (backlog).
- **Editor tabs show the file's icon**, as IntelliJ's: the playground passes it (a file, or a diff).
- These are Claude's choices, open to change. The fade's width and the peek (24 pixels) weren't
  measured from IntelliJ: claims, to check against it.

## Several terminals (2026-10-27)

Ido's request (2026-10-26, with a screenshot of IntelliJ's Terminal tool window): several terminals
in the Terminal tool window, as tabs, with a + button.

- **A worktree's shells are tabs in the tool window's header,** after its title, as IntelliJ's:
  "Local", "Local (2)", each numbered with the lowest number free (a claim about IntelliJ's
  numbering, not checked), each with a close button; the middle button closes one too. A + button
  opens another and gives it the keys. Tabs that don't fit scroll and are listed by the chevron
  (decision "Tabs that don't fit").
- **`ToolTabs` in `ui-layout`,** for any tool window: `ShellLayout` takes `tabs`, shown after the
  title, which then takes only its own width.
- **Each tab is its own process in the host** (key `shell:<worktree>:<n>`). The tabs are kept in
  the browser's storage by worktree, so after a reload they show the same processes; after a
  restart, new shells in the same tabs.
- **Closing the last tab hides the tool window,** as IntelliJ's; shown again, it has a new shell.
- **A shell that ends keeps its tab,** saying so, and Enter starts it again (decision "Terminals and
  the Claude tool window"). IntelliJ closes the tab instead; kept as decided until Ido says
  otherwise.
- **They look like IntelliJ's Terminal tabs** (Ido's screenshot, 2026-10-26): pills like the editor's,
  the active one outlined, a close button on every tab.
- These are Claude's choices, open to change.
- **Not yet:** several Claude sessions (Ido: to design later); IntelliJ's dropdown for choosing a
  shell; renaming a tab.

## Islands Dark and Islands Light (2026-10-27)

Ido's request (2026-10-26, with a screenshot of IntelliJ's Islands Light and its Settings): match
the light theme to it, name the themes as IntelliJ does, and choose them where IntelliJ does.

- **Names:** "Islands Dark" and "Islands Light" (the stored values stay `dark` and `light`).
  IntelliJ's plain Dark and Light, without islands: Ido, "MAYBE we'll do in the future".
- **Islands Light measured** from Ido's screenshot (a lossy WebP, so within a few units; sampled
  pixel by pixel in Chromium): the frame and stripes `#e8eaee`; tool windows white, as the editor
  (the light theme had them grey); dialogs `#f6f8fa`, so they have a token of their own,
  `--cerebro-dialog` (Islands Dark keeps its tool windows' colour there, not measured); a tree's
  selected row `#e8eaee`; a focused list's `#d0e0fd`; a selected stripe button `#d9d9e0`; the
  active tab `#e8eaee` outlined `#cbcdcf`; fields' borders `#d1d3d5`. Thin strokes (icons, muted
  text) can't be measured from it, antialiased at 2×: they keep IntelliJ's light palette, a claim.
  The accent stays `#3574f0`: the screenshot's buttons read `#3671e1`, likely its colour profile.
- **Chosen in Settings → Appearance → Theme, with "Sync with OS" beside it,** as IntelliJ's. Synced,
  the theme follows the system's light or dark appearance as it changes (`prefers-color-scheme`,
  which Electron takes from the system). Choosing a theme with View → Dark Theme turns syncing off.
  Settings gained `beside`: a setting shown on another's row.
- **Not in the editor's context menu any more:** it doesn't belong there, as Ido said of the theme
  outside Settings. View → Dark Theme and its shortcut stay.
- These are Claude's choices, open to change.
- **Not yet:** IntelliJ's gear beside Sync with OS (which themes to sync to), its "Editor color
  scheme", and the light theme's syntax colours, which weren't in the screenshot.

## Ready-made keymaps (2026-10-27)

Step 1 of the backlog's "Keymaps" (Ido: "Keymaps I want the most common in both macos and plain
(win/Linux) configuration, similar to intellij. That includes vscode and intellij own as step 1").

- **Four keymaps, chosen in Settings → Keymap,** as IntelliJ's list names them: IntelliJ IDEA,
  IntelliJ IDEA (macOS), VS Code, VS Code (macOS). The default is IntelliJ's for the system the app
  runs on, as in IntelliJ. Any of them can be chosen on any system, as in IntelliJ.
- **The keys are the sources' own,** for the commands Cerebro has (`playground/src/keymaps.ts`):
  - IntelliJ: its keymap files, `$default.xml` and `Mac OS X 10.5+.xml` (the macOS one takes
    `$default`'s keys with Ctrl and Cmd swapped, and overrides some: read in IntelliJ's source).
  - VS Code: its keyboard shortcut sheets for Windows and macOS. A command they don't name keeps
    IntelliJ's keys for the same system (Claude's choice, open to change).
  - Three keys differ from the earlier defaults, as IntelliJ's file has them: Group by Directory is
    Ctrl+Alt+P (not Ctrl+P), New File is New Scratch File's Ctrl+Alt+Shift+Insert, and Dark Theme
    takes Quick Switch Scheme's Ctrl+`. The defaults stay, for commands no keymap names (a
    plugin's).
- **In `@cerebro-ide/commands`,** a keymap is a `KeymapPreset`: the keys of the commands it names,
  with explicit modifiers, and an optional parent for the rest. The bindings in effect are the
  user's, then the preset's (its own over its parent's), then the defaults of commands it doesn't
  name; the user's removals apply to all of them.
- **The editor's own actions follow the keymap:** go to definition, find usages, Find and Replace
  run in CodeMirror, which now takes their keys as a prop (`keys`), read reactively. In VS Code's
  keymaps they are F12, Shift+F12, Ctrl+F (Cmd+F) and Ctrl+H (Cmd+Alt+F).
- **Not yet:**
  - the user changing a command's keys in the Keymap page (the rest of the backlog entry), and
    IntelliJ's other keymaps (Eclipse, Emacs, NetBeans, Sublime Text, Visual Studio);
  - CodeMirror's text editing keys (moving by word, duplicating a line) follow CodeMirror, not the
    keymap;
  - VS Code's Linux differences (Go Back is Ctrl+Alt+-, its sheet says);
  - punctuation with Shift is named by the character it types (Ctrl+Shift+- arrives as
    Ctrl+Shift+_), so VS Code's macOS Go Forward is written for a US layout.

## Search Everywhere (2026-10-27)

From Ido, with a screenshot of IntelliJ's: "another thing I think we're missing is a global search
(in intellij double shift press) that has a top menu for various types of search". The choices
below, other than following IntelliJ, are Claude's and open to change.

- **Double Shift opens it,** as IntelliJ's. The keymap takes a modifier on its own as a chord, so
  the binding is `Shift Shift`, shown as "Double Shift" ("Double ⇧" on macOS). Both taps must come
  within 400 ms, with nothing pressed between them. The 400 ms is a guess, not measured from
  IntelliJ. VS Code's keymaps, which don't name it, keep it, as with any command they don't name.
- **Tabs along the top:** All, Classes, Files, Symbols, Actions, Text. Tab and Shift+Tab move
  between them, as in IntelliJ.
  - **Classes** are the index's classes, interfaces, enums and type aliases.
  - **Symbols** are every definition the index has; the index gained a `kinds` filter, applied
    before its limit.
  - **Files** filters the project's files by name. With nothing typed, it shows Recent Files.
  - **Actions** are the commands.
  - **Text** searches lines with ripgrep, as Find in Files does.
  - **All** lists up to 8 of each kind but Text, each under its header. Classes aren't listed
    again under Symbols. Before anything's typed, All shows Recent Files.
- **The highlighted result's file shows below,** as Find in Files' preview does, at the class, the
  symbol or the line.
- **Go to File, Go to Symbol, a new Go to Class and a new Find Action open it on their own tab,**
  as IntelliJ's do.
  - The key that ran Search Everywhere, Ctrl/Cmd+Shift+A, is IntelliJ's Find Action, and now opens
    the Actions tab.
  - Go to Class has IntelliJ's keys: Ctrl+N, Cmd+O on macOS.
  - VS Code's Command Palette keys (Ctrl/Cmd+Shift+P, F1) open the Actions tab.
  - The VS Code keymaps leave Go to Class without a key: VS Code has no such command, and
    IntelliJ's keys are VS Code's New File and Open.
  - Go to Symbol's own popup is gone. Its "Name matches" header is gone too, since everything
    here is matched by name.
- **Not yet:**
  - "Include non-project items", the filter and "Open In Right Split" from IntelliJ's popup.
  - "Show more" in All for a kind with more than 8 results.
  - Double Shift while the popup is open, which IntelliJ uses to include non-project items.

## Search (2026-10-26)

The third part of "A basic IDE before git and agent management". The choices below are Claude's,
after IntelliJ, open to change.

- **Find in Files** (Ctrl/Cmd+Shift+F; Edit → Find): IntelliJ's popup. Its title and the count ("5
  matches in 2 files", with + when the search stopped at its limit) are at the top. Match Case,
  Words and Regex sit beside the field (Alt+C, Alt+W, Alt+X, by the key's place, since Option+C
  types ç on macOS). Each line found shows with its matches bold, and its file and line at the
  right; the highlighted line's file is shown below, read-only. Enter or a click opens it there. It
  searches as the user types (after 150 ms), and only the latest answer counts. A bad pattern
  shows ripgrep's message.
- **The host searches with ripgrep** (`search.text`), as `plan-v1.md` has it. It comes from
  `@vscode/ripgrep` 1.18.0, out since 2026-05-07: it ships ripgrep 15 as a package per platform,
  with no install script, and VS Code uses it. Case is ignored unless asked, as in IntelliJ. Hidden
  files are searched, but not what .gitignore leaves out, `.git`, or files over the editor's 10 MB.
  It stops at 1000 lines; lines are sorted by path, then line. Offsets are converted from bytes
  to UTF-16, and lines that aren't UTF-8 are left out.
- **The picker grew** a header, options beside its field, a preview below its list, and the caller's
  keys first, for Find in Files; Go to File and the rest are unchanged.
- **Find and Replace in a file** (Ctrl/Cmd+F, Ctrl/Cmd+R): IntelliJ's bar over the editor. It
  searches as it's typed, from the cursor. Its count says which match of how many ("2/5", up to
  9999+). Enter and Shift+Enter, or F3 and Shift+F3, go to the next and previous match. The same
  options and keys as Find in Files. Replace and Replace All are there only when the file can be
  edited. Escape anywhere in it closes it. It's built on `@codemirror/search` 6.7.2 (out since
  2026-08-31), which keeps the query and highlights the matches; the bar is Cerebro's, styled in the
  editor's shadow root. As CodeMirror does, going to a match selects the field's text.
- **Match colours** (`--cerebro-search-match`, `-selected`) weren't measured from IntelliJ.
- **Scopes** (changed 2026-10-27, from the polish Ido asked for): under the field, In Project or
  Directory, as IntelliJ's tabs. Directory's folder is typed relative to the project, and starts
  at the active file's folder; a folder that isn't there says so. In the header, a File mask
  (`*.ts, !*.test.ts`): comma-separated, `!` leaves files out, given to ripgrep as `--glob`, so a
  mask without `/` matches a name in any folder (tested). The scope and the mask are kept between
  searches, as IntelliJ keeps them. IntelliJ's Module and Scope aren't offered: Cerebro has no
  modules or named scopes. The picker grew a row for them, between its field and its list.
- **A new search stops the one still running** (changed 2026-10-27): the host kills ripgrep, so a
  search typed letter by letter doesn't leave several running to their limit. The preview selects
  the first match on the line, as IntelliJ's highlights it.
- **Replace in Files** (added 2026-10-27, Ido: "do those"): Edit → Find → Replace in Files
  (Ctrl/Cmd+Shift+R, IntelliJ's; Ctrl/Cmd+Shift+H in VS Code's keymaps) is the same popup with a
  Replace field under the search field. Replace takes the highlighted line's matches; Replace All
  (Mod+Alt+Enter) takes every match, up to 100,000 lines, after a dialog asks to confirm.
  - ripgrep works out each replacement (`--replace`; its JSON gives each match's replacement,
    measured), so `$1` follows the same regular expression syntax as the search. Without Regex, `$` is
    literal.
  - Lines are then given whole, not cut at 1000 bytes, so every match on them is replaced.
  - The replacements go into the files' documents: an editor showing one can undo them. A line that
    changed since the search (an unsaved edit) is left as it is, and the user is told.
  - The replaced files are saved straight away. A document with no editor keeps no undo history, so
    there's no undo there; that's why Replace All asks first.
  - Replace waits for the search being typed to finish, so it never uses an earlier answer's
    replacements (a bug the e2e test caught).
- **The Find tool window** (added 2026-10-27, Ido: "do those"): Open in Find Window (a button
  under the field, or Ctrl/Cmd+Enter) runs the search again, up to 100,000 lines, and shows it in
  a Find tool window at the bottom.
  - The window is registered the first time it's used, as IntelliJ's appears.
  - Its title says what was searched and where ("Occurrences of 'shape' in Project", with the
    mask), then the count.
  - The tree has a node per folder (its whole path, flattened), then per file, then per line, each
    with how many matches it holds, all open.
  - Double click or Enter on a line opens it there.
  - It shows the active worktree's last search: a new one replaces it. IntelliJ keeps each in a
    tab.
- **Not yet:** the Find window's tabs (a search each), its preview, and IntelliJ's Group By
  options; IntelliJ's Preserve Case; Replace All undone as one step across files.

## Editing and saving (2026-10-26)

The second part of "A basic IDE before git and agent management" (Ido: "Yes, edit and save"). The
choices below are Claude's, after IntelliJ, open to change.

- **A document per open file,** as IntelliJ's: it outlives the editors showing it, so switching tabs
  keeps the edits, the selection and the undo history (CodeMirror's state, kept as JSON with its
  history field between editors). It knows the text last read or saved, so whether it's modified.
- **Saving on its own** (changed 2026-10-27; Ido: "this IDE doesn't work in a way that a user need
  to manually trigger a save action, it auto-saves", in batches, after a while or when the focus
  leaves). IntelliJ's triggers, read in its source (`SaveAndSyncHandlerImpl.kt`,
  `GeneralSettings.kt`): when the window loses the focus (on by default there), and after the IDE
  is idle, no key or mouse, for 15 seconds (its setting's default value, though the setting is off
  by default there; on here, as Ido asked for saving after a while). Ido's own: when an editor
  loses the focus, its file is saved. Still before the window closes, reloads (another project in
  this window) or the app quits: the main process has the page save (`cerebroSaveAll`) and waits
  up to 5 seconds. File → Save All (Ctrl/Cmd+S) saves at once. Before, only the window losing the
  focus and Save All saved. No save on every keystroke, and no Save for one file, as in IntelliJ.
  Modified tabs aren't marked, as IntelliJ's default (Settings → Editor Tabs → "Mark modified" off:
  a claim, not checked).
- **The file keeps its line separators:** a file with `\r\n` is saved with them (CodeMirror joins
  with `\n` unless told). And its byte order mark (2026-10-28): the host reads it
  (`TextDecoder` with `ignoreBOM`; by default it dropped it), the editor doesn't show it, and the
  file is saved with it, as IntelliJ keeps one. Before, it was dropped on save. Saving writes over the file in place, which must exist (`fs.write`), so
  its permissions stay; a new file isn't made by a save.
- **Files changed on disk** (by an agent, git, a terminal) are read again when the window gets the
  focus and every 2 seconds while it has it, as IntelliJ synchronizes on frame activation. Reading
  again isn't undoable. Polling was chosen over watching files for now: a few open files read every
  2 seconds is a claim of small cost, not measured.
- **A file changed both in the editor and on disk is a conflict** (2026-10-27, Ido: "a popup should
  prompt the user to select between the two OR open a merge window"), found when it's read again or
  before it's saved (saving reads the file first, and doesn't write over a change it didn't read).
  It's asked about as IntelliJ's File Cache Conflict (`ConflictResolverDialog.java`, its words from
  `UIBundle.properties`): Load File System Changes, Keep Memory Changes (Escape too, IntelliJ's
  Cancel; saved over the disk's later), or Show Difference: the disk's text on the left and the
  edits on the right, editable, with an arrow by each change that takes the disk's, and Save Memory
  Content. Loading or merging is an edit undo takes back. Before, the edits won and saving
  overwrote. IntelliJ can also merge on its own, without asking, behind a registry setting
  (`ide.merge.external.changes`) used when a client asks for it; not done here.
- **A file deleted on disk has its tabs closed** (2026-10-28), in every environment and group, its
  unsaved edits with them, as IntelliJ closes a deleted file's editors (`FileEditorManagerImpl`,
  `beforeFileDeletion`). It's found when the file is read again, or before it's saved: a read that
  fails asks the host whether the file is there (`fs.exists`; an error's details don't cross
  Electron's IPC), and a file that can't be told about stays open. Before, the tab stayed, and
  saving it failed. A restored tab whose file is gone still says it can't be opened.
- **Undo, redo, Tab to indent** in the editor (CodeMirror's history); the diff stays read-only.
  Switching tabs lost the history until 2026-10-28: a new editor took its own text, equal to the
  document's but not the same object, as a change on disk, which isn't undoable and cleared it (and
  put the caret at the top). Fixed, with a test.
- **Edit → Undo, Redo, Cut, Copy, Paste** (2026-10-27; Ido asked that they work) act on what had
  the focus before the menu opened, as IntelliJ's, and their keys are the keymap's, also in the
  editor (so a keymap's Redo, such as VS Code's Ctrl+Y, works there). Undo and Redo in an editor
  are its history's; elsewhere, and Cut, Copy and Paste everywhere, the system's, run by Electron
  (`webContents.undo()`, `.paste()`…) because a page can't paste on its own. They're enabled where
  text is typed; Copy also in a read-only editor or with a selection. Before, the menu's were
  disabled and only the editor's own keys worked.
  - In an editor, Undo and Redo say what they'd do and are disabled with nothing to do
    (2026-10-28), as IntelliJ's (`UndoManagerImpl`: "Undo {name}", only "Undo" for a change
    without one). The names are IntelliJ's for the same commands (Typing, Paste, Cut, Backspace,
    Delete, Delete Line, Replace, Indent Selection, Unindent Line or Selection), kept beside
    CodeMirror's history from each change's user event; typing joined to the change before keeps
    its name. A command's menu label can now change (`text` on a command).
  - In a terminal, Copy copies its selection (2026-10-28): the terminal answers the copy event its
    text field gets. Before, it copied the text field's, which is always empty.
  - In a terminal, Cut, Undo and Redo are disabled (2026-10-28): its text is the shell's, so
    nothing is cut from it or undone; Paste stays, as typing does. Claude's choice, open to change.
- **In a browser,** the samples can be edited, and aren't saved.
- **Not yet:** the idle time isn't a setting; Undo's names in a text field (only the editor's are
  known).

## Opening a project (2026-10-26)

The first part of "A basic IDE before git and agent management": any folder, opened from the app.

- **Projects as tabs, each with its own host** (changed 2026-10-27, Ido: "Opening a repo/project
  on 'This window' should not close the existing project but add tabs similar to how multiple
  worktrees function - that's how intellij does it", then: "New window should open a new tab, this
  Window should replace the active tab"). Opening a project from a project's window asks where, as
  before, but neither answer makes a window: New Window adds the project to the window as tabs,
  as IntelliJ's windows merged into tabs; This Window puts it in the place of the active project,
  whose host stops, its first tab where the other's was. Its worktrees join the one strip of
  environment tabs (Ido's choice of one strip over a row of project tabs above the worktrees'),
  labelled with the project's name once the window has two. Each project keeps its own host (Ido's
  choice), so the main process routes a page's requests by window and project, and a host's
  notifications carry its project. Closing a project closes its tabs and stops its host; closing
  the window's last one closes the window. The projects open at quit reopen together, by window.
  Before, a window showed one project: This Window replaced it, reloading the page, and New Window
  made another window. One host serving many folders stays rejected: a host per folder keeps a
  project's work (index, terminals, agents) apart, and stopped with it.
- **The toolbar** (changed 2026-10-27, Ido: "in intellij the project menu opens into previous
  projects, in our in opens into the worktree menu"): Project, as IntelliJ's project widget (the
  window's projects, Open…, and the recent ones), then Worktree (Ido's choice of a dropdown of its
  own over listing worktrees in the branch popup), then Branch. The Worktree picker lists the active
  project's worktrees, the main one under its own header.
- **Recent and open projects** are kept in `projects.json` in the app's data folder: up to 20 recent
  ones, the latest first, and the ones open at quit. At start (Ido: "Reopen last project"), the
  ones open when the app quit reopen; with none, the Welcome window shows. `CEREBRO_REPO`, when set,
  opens that folder instead (for development and tests). The folder the app started in no longer
  counts: a project is chosen, not implied.
- **The Welcome window,** as IntelliJ's: recent projects with a search field (arrows and Enter
  work from it), an Open button, and × to forget a project; one that's gone says "(not found)" and
  can't be opened. Opening a project from it replaces it. Closing the last project (File → Close
  Project) shows it again; closing a window with others open forgets that it was open, closing the
  last one doesn't, so it reopens.
- **Opening while a project is open asks where** (Ido: "Ask, as IntelliJ"): This Window or New
  Window (what each does: above), with "Remember, don't ask again", which saves the global setting "Open project in" (ask,
  new window, this window) on the System Settings page. A project already open is brought to the
  front instead. File → Open… uses the OS's folder dialog; File → Open Recent lists the recent
  projects. Dialogs got `choices`: buttons beside OK that close with their own result.
- **A folder without git opens** (Ido: "Yes, without git"): one environment, the folder, with no
  branch selector, no new worktree or branch, and the Commit window saying "Not a git repository".
- **The samples stay only in a browser:** a project's window shows its own files, with no sample
  tabs. The layout is saved per project. The e2e tests that used the samples now run on a throwaway
  repository with two worktrees.
- **Not yet:** Go to File and the index in a folder without git (they read git's file list; with
  ripgrep, in the search step); the macOS menu bar with several windows (it's the menu of
  the window that last sent one, not of the focused one).

## A basic IDE before git and agent management (2026-10-26)

Ido: "I want to be able to actually use this as a basic IDE before we move to the more advance
features, like git management and claude/agents management." The commit and diff work still
wanted, after this.

- **In this stage** (Ido's choice, 2026-10-26):
  - **Opening a project:** File → Open… with the OS's folder picker, and recent projects. Today
    the repository is fixed when the app starts (`CEREBRO_REPO` or the folder it started in).
    Done: see "Opening a project".
  - **Editing and saving files:** the editor has been read-only so far.
  - **Search:** Find in Files (ripgrep, as the plan's milestone 2 has it) and Find/Replace in the
    open file.
  - **Navigation:** Ctrl/Cmd+click to a declaration, Back and Forward, Recent Files, Go to Line,
    selecting the opened file in the project tree.
  - **Language servers** (the plan's milestone 5): precise go to definition and find usages,
    instead of the index's name matches. "Jump to source" here means going from a symbol to its
    definition (Ido).
- **Order** (Claude's, open to change): opening a project, editing, search, navigation, language
  servers. Each builds on the one before: any folder first, then working in it.
- **After it:** committing from the Commit window, diffs to code (F4 from a diff line), the
  plan's "since the session started" and per-commit views, then shelve and stash.
- **This departs from `plan-v1.md`'s order,** where agent sessions (6) and change inspection (7)
  came after language servers but were built first, as the POC's steps.

## The Commit tool window's toolbar (2026-10-26)

Ido, from screenshots of IntelliJ's Commit tool window: "note the missing options here. these are
important. most of all, the expand collapse and group!", and "clicking a file here doesn't
automatically open the diff window, it just opens the file. to open the diff one need to press
cmd/ctrl+d - or select it from the context menu".

- **Opening a file opens the file** (Ido): a double click, Enter or Jump to Source (F4). Show Diff
  (Ctrl/Cmd+D, the toolbar or the context menu) opens its diff. This changes "Changes and diffs",
  where opening a file opened its diff. A deleted file doesn't open.
- **The toolbar, in IntelliJ's order:** Refresh, Rollback, Show Diff, View Options (the eye), Select
  Opened File, Expand All, Collapse All. Shelve and stash are later (Ido: "could be done in later
  stages").
- **View Options** is a menu with headings, as IntelliJ's: Group By → Directory (on by default, as
  IntelliJ's), Show → Ignored Files (off). Both kept in the page's local storage, for every
  worktree. Menus got headings for it (`{ heading }` items, which can't be chosen).
- **Groups, as IntelliJ's:** Changes (tracked files), Unversioned Files (untracked, only when there
  are any), Ignored Files (when shown and there are any: `git ls-files --others --ignored
  --exclude-standard --directory`, so an ignored folder is one row), then the agent's turns. Grouped
  by directory, a folder holding only one folder shows as one row (`src/main`), folders first, each
  with its number of files. Groups and folders are expanded when they first show; Ignored Files
  starts closed (a claim about IntelliJ, and open to change).
- **Rollback** (Ctrl/Cmd+Alt+Z) acts on the selected file, or every file in the selected folder or
  group; untracked, ignored and turns' files aren't rolled back. A dialog lists them first, with
  "Delete local copies of added files" (off) when any were added, as IntelliJ's. The host's
  `git.rollback` runs `git restore --source=HEAD --staged --worktree` (a renamed file's old path
  too); an added file it keeps is only unstaged (`git restore --staged`), as measured in the tests.
- **Shortcuts** are IntelliJ's: Ctrl/Cmd+D, F4, Ctrl/Cmd+Alt+Z, Ctrl/Cmd+P (group by directory),
  Ctrl/Cmd+= or + (expand all), Ctrl/Cmd+- (collapse all). They act only while the Commit window has
  the keyboard (otherwise they pass through, to the editor, say); its toolbar and menus pass the
  commands a context saying they come from it.
- **Ignored files' colour** is a new theme token, `--cerebro-vcs-ignored`, not measured.
- **Not yet:** shelve and stash, changelists, selecting several files, and other View Options
  groupings (IntelliJ's module and repository groupings don't apply).

## Instructions for Claude: rules and skills (2026-10-26)

Ido: CLAUDE.md will grow out of control; split it into skills and rules files.

- **CLAUDE.md keeps what applies everywhere:** the project, the NAS, the working rules. Claude
  Code loads it in full in every session; its docs suggest under 200 lines per file.
- **`.claude/rules/`, scoped by path:** tests, the UI, the host, dependencies, docs. From Claude
  Code's docs: a rule with `paths` loads when Claude reads, writes or edits a matching file
  (Read, Write or Edit, or `cat`/`head` of one file), not on edits made through other shell
  commands; rules that must never be missed stay in CLAUDE.md.
- **Skills for procedures:** `/pr`, `/qa`, `/decision`. Only their descriptions load until one is
  used (Claude Code's docs).
- **Claude's own memory moved into the repo:** it lives on one machine, so sessions on the NAS
  never saw it.
- **This file has an index,** so a session reads it and only the entries it needs.
- **`/qa` runs `packages/e2e/scripts/qa.mjs`:** the built app on a new repository, a screenshot,
  the console's errors; scripts import its `launch` to drive the page.

## Agent turns (2026-10-26)

Milestone 7's first part (change inspection, `docs/plan-v1.md`): what each of the agent's turns
changed, in the Commit tool window.

- **A snapshot before and after each turn,** not only at its end as the plan said: the difference
  between the two is what the turn changed, even when the user (or another tool) changed files
  between turns. The host takes them on the `UserPromptSubmit` and `Stop` hooks.
- **A snapshot is a commit** of every file git doesn't ignore, made through a copy of the
  worktree's index (`GIT_INDEX_FILE`), so what the user staged is untouched (measured), with
  Cerebro as its author, whoever the user is. Each turn's end is kept by a ref under
  `refs/worktree/cerebro/turns/`: git keeps the commits, and other worktrees don't see them
  (measured). The prompt, cut to 200 characters, is the commit's message. Nothing removes them yet.
- **The prompt's hook waits for the snapshot** (the hook client waits for the host's reply), so the
  agent can't change a file before it's taken; the other hooks don't wait.
- **In the Commit tool window,** under the uncommitted changes, each turn, the latest first, with
  its time and prompt; expanded, the files it changed, each opening the diff between the two
  snapshots (a tab id `diff@from..to:path`).
- **Not yet:** the plan's "since the session started" and per-commit views; a turn that's under way
  when the app quits is lost.

## Agent status and resuming (2026-10-26)

The POC's third step: each worktree's agent shows whether it's working, waiting for the user, or
done, and its session resumes after the app restarts.

- **From Claude Code's hooks,** given to `claude` with `--settings` when the host starts it as an
  agent, so the user's own settings are untouched. Measured with `claude` 2.1.310: hooks passed
  that way run, with the session's id in their input. `UserPromptSubmit` and `PostToolUse` mean
  working, `Notification` waiting (a permission prompt, say), `Stop` done.
- **A hook runs the host's own entry point** (`main.js hook <name>`, as Node in Electron), which
  sends the hook's input over a local socket (a named pipe on Windows) to the host that started the
  agent, with the agent's key from its environment. It never fails the agent: a host that's gone is
  ignored. The command is for a POSIX shell; Windows isn't handled yet (nor is `claude` there).
- **Shown** as a dot on the environment tabs (pulsing while working) and in the status bar for the
  active worktree; clicking the status bar item opens the Claude tool window. Colours not measured.
- **Resuming:** the session's id from the hooks is kept per worktree (in the page's storage), and
  the agent starts with `--resume <id>`. If the agent exits with an error (its session gone, say),
  the next start is a new session. Measured: after a restart, the conversation shows again.
- **Terminals don't inherit Claude Code's session variables** (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`
  and the like), for an app started from a Claude Code session: with them, `claude` in a terminal
  kept no transcript, so `--resume` found nothing (measured); without them, it resumed. Nor
  `ELECTRON_RUN_AS_NODE`, which the host runs with.
- **Tests:** the e2e test puts a pretend `claude` on the PATH that runs the hooks it was given.

## Changes and diffs (2026-10-26)

The POC's second step: the worktree's changed files, each opening its diff in an editor tab.

- **In the Commit tool window,** as IntelliJ lists changes there: each changed file since the
  worktree's last commit, staged or not, untracked files included (`git status --porcelain=v1 -z
  --untracked-files=all`), with its name in its status's colour and its folder after. A renamed
  file shows where it came from.
- **Read every 2 seconds while it shows,** and when the window gets the focus: an agent changes
  files without telling. The list is redrawn only when it changed, so a row doesn't change under
  the pointer (an e2e double-click missed one that was redrawn).
- **The diff is side by side,** as IntelliJ's default: the last committed text on the left, the
  file as it is on the right, unchanged lines aligned, read-only. CodeMirror's merge view
  (`@codemirror/merge` 6.12.2; 6.12.3 was out for under two weeks), in the code editor's look and
  shadow root. Diff colours and the status colours are theme tokens, not measured.
- **A diff tab** is the file's path marked `diff:`; it reads both sides through the host when it
  shows (`git.diff`), so it's current each time it's switched to.
- **Not done:** staging, committing, and refreshing a diff while it shows. Reverting came with the
  toolbar (see "The Commit tool window's toolbar").
- **Changed 2026-10-26:** opening a file opens the file, not its diff, as IntelliJ's does (Ido);
  Show Diff opens the diff. See "The Commit tool window's toolbar".

## Terminals and the Claude tool window (2026-10-26)

The POC's first step (Ido: get to a POC he can QA, the steps up to Claude): real terminals per
worktree, and a Claude tool window running `claude`.

- **Own renderer on `@xterm/headless`** (Ido's decision). xterm.js's own renderer was tried first;
  Ido, who has contributed to xterm.js, dislikes how it handles rendering, and in the app it broke
  against the page's Content-Security-Policy (`style-src 'self'`): many "Applying inline style
  violates…" errors (seen in the app's console), the wrong font, and black strips. So xterm.js's
  headless terminal does the parsing and keeps the screen and scrollback, and `ui-terminal` draws
  it: one element per line in view, runs of same-looking cells as spans, styles set through the
  style object only (which the CSP allows), in the theme's font and colours. Wide characters and
  symbols get a box of exactly their cells. Keys, mouse reports (X10, normal, button and any
  motion; SGR or the original encoding), bracketed paste, focus reports, the alternate screen's
  wheel-as-arrows and synchronized output (mode 2026, for at most a second) are Cerebro's,
  following xterm's behaviour.
- **Processes run in the host,** on a pseudo-terminal with `node-pty` 1.1.0 (its N-API build loads
  under Electron's Node; measured by its test running `/bin/sh -c 'echo $TERM'`). One process per
  key (`shell:` or `claude:` and the worktree), so switching worktrees, or reloading the page,
  shows the same process with its last 256 KB of output. Output is batched every 4 ms. The shell
  is `$SHELL` (else `/bin/bash`), or `COMSPEC` on Windows. `TERM=xterm-256color`,
  `COLORTERM=truecolor`.
- **node-pty's macOS helper is made executable by the host** before it spawns. node-pty 1.1.0
  publishes `prebuilds/darwin-*/spawn-helper` with mode 0644 (measured: `npm pack node-pty@1.1.0
  --dry-run --json`), and on macOS every spawn failed with "posix_spawnp failed" (measured: the
  macOS e2e run). A postinstall script was the alternative; the host's fix also covers installs it
  doesn't control.
- **When the process ends** the view says so; Enter starts it again. Removing a worktree ends its
  terminals.
- **Shortcuts:** keys the app binds (and chord prefixes) go to the app; others go to the process,
  except bare Ctrl+key on Windows and Linux, which always goes to the process. Copy is Ctrl+Shift+C,
  or Ctrl+C with a selection (Cmd+C on macOS); paste is the platform's.
- **The Claude tool window** is on the right, shown by default, and runs `claude` in the active
  worktree. The e2e tests that click in the editor hide it, since it narrows the editor.
- **The 16 ANSI colours** are theme tokens (`--cerebro-terminal-ansi-0..15`); their values are not
  measured from WebStorm, a claim to check.
- **Not done:** `claude` on Windows (it needs its `.cmd`), the PATH of an app started from the macOS
  desktop, small gaps between block characters at line height 1.2, and our cursor's outline showing
  over Claude's own input while unfocused.

## The look: WebStorm's Islands theme (2026-10-26)

Ido: match a screenshot of WebStorm's Islands dark theme as closely as possible, pixel by pixel,
before he points out specifics. The dark theme's values are measured from that screenshot (1693 ×
1440 at scale 1, sampled pixel by pixel); the light theme's new values are Claude's guesses in the
same spirit, not measured. Choices of Claude's, open to change:

- **Islands:** the editor and each tool window is a panel with 8px corners on the window's frame
  colour, 5px apart. The gaps are the splitters' handles; splitters between editor groups, inside
  the editor's island, stay 1px lines.
- **Colours:** the frame (toolbar, stripes, status bar) `#25282c`, tool windows `#191a1c`, the
  editor `#1e2022`, text `#d1d3d9`, the status bar's text `#9fa2a8`, icons `#c3c5ca`.
- **Sizes:** toolbar 43px, stripes 40px (the left one 41px, as measured) with 30px buttons 10px
  apart, tool window headers and the tab strip 40px, status bar 32px, tree rows 24px with 19px per
  level, code lines 22px at 13px.
- **Editor tabs are pills,** 28px tall, the active one outlined and bold; no underline.
- **Fonts bundled:** Inter for the UI (IntelliJ's new UI uses it) and JetBrains Mono for code, both
  under the SIL Open Font License, from the `@fontsource` packages. Without them each platform drew
  its own fallback, so no screenshot could match. Code ligatures are off, as WebStorm's default.
- **Scrollbars** are a thin rounded thumb with no track or arrows, drawn over the content since
  "Scrollbars over the content".
- **Stripe buttons' tooltips show at once** (Ido), with no pause; other controls keep the pause.
  Tooltips take a `delay` option for this.
- **Not done:** the project colour's glow at the toolbar's left, file icons in tabs, and widths
  that are the user's layout (the Project tool window's, 370px in the screenshot).

## CI: quick, and few minutes (2026-10-26)

Ido: CI should be quick and use as few resources as possible, without hitting the limits that would
block future runs. The repository is private, on the free plan: 2,000 minutes a month, blocked when
they run out (no payment method); each job rounded up to a whole minute; per-minute prices of Linux
$0.006, Windows $0.010 and macOS $0.062 (GitHub's billing docs). Choices of Claude's, open to change:

- **Nothing installed:** GitHub's Ubuntu runner comes with Google Chrome and xvfb (its image's
  docs). The browser tests run in that Chrome (`CEREBRO_BROWSER_CHANNEL=chrome`, passed to
  Playwright as its channel), and Electron finds Chromium's libraries already there. Installing
  Playwright's Chromium and libraries took 11 s to 10 minutes (measured), waiting on apt.
- **Pull requests only:** a pull request's run tests its merge into main, so main isn't run again
  after merging. Markdown-only changes don't run.
- **One Linux job** for the checks, the build and the Linux end-to-end tests: one install and one
  rounded-up minute fewer than two jobs.
- **macOS and Windows only after the check passes,** so their dearer minutes aren't spent on a
  change that fails anyway. It makes a run about a minute longer when everything passes.
- **10-minute timeouts** on every job, instead of GitHub's default of 6 hours, so a hang can't
  use up the month.
- A newer push to the same pull request cancels the run in progress.

## End-to-end tests (2026-10-25)

From the test review: the assembled app had no tests, and the bugs found by hand lived there.

- **`packages/e2e`:** Vitest in Node drives the built desktop app through Playwright's Electron
  support (`_electron.launch`), already installed for the browser tests: no new dependency.
- **Isolated:** each test file launches one app with a throwaway data folder (the main process
  takes `CEREBRO_USER_DATA`), and each test starts from cleared storage and a reloaded page.
- **The flows checked by hand while building them:** the window and its title bar (measured
  against the window-controls overlay), no other windows, dialogs (validation, shortcuts kept from
  running behind one), Go to File, Search Everywhere running an action that persists, a worktree
  setting applied, saved and shown as overriding the repository, a key sequence and its timeout,
  and the tooltip over the ☰ menu. Shown to catch the Settings page bug, put back on purpose.
- **Separate from `npm run check`:** it needs a build and a display. `npm run e2e` builds and runs
  it; CI runs it on Linux under `xvfb-run`, and on macOS and Windows (2026-10-26) on the runners'
  own displays. Shortcuts bound with `Mod` are pressed as `ControlOrMeta`; the in-window menu bar's
  steps run except on macOS, whose menu is the system's.

## Desktop conventions in the UI (2026-10-25)

Ido: the UI behaves like an application, not a website.

- **No text selection by default.** It's enabled only where it makes sense: text inputs, and
  content marked `.cerebro-selectable`, such as editors, logs and terminals. Nothing is selected
  while dragging or resizing.
- **App cursors, never the pointing hand:**
  - the arrow on buttons, tabs, stripe icons and menu items;
  - resize cursors on splitters;
  - the text cursor only where text is selectable.
- **Cerebro's own tooltips, never the browser's** (`@cerebro-ide/ui-tooltip`), at Ido's request:
  - styled like IntelliJ's;
  - the shortcut after the text, muted, when the command has one (for example, "Services Alt+8");
  - they appear after a short pause, and at once when moving from one control to the next;
  - views get shortcuts from the app through a callback, so they don't depend on the commands
    package.
- **Where it's set:**
  - `@cerebro-ide/theme/base.css` sets it for the whole page;
  - the view roots (`.cerebro-shell`, `.cerebro-editor-area`) set it too, so the views behave the
    same without it.

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
- **Packages use each other's source inside the repo.**
  - Each package's `exports` has a `cerebro-source` condition pointing at `src/`.
  - The type-check configs (`customConditions`) and Vite turn that condition on; the build
    configs don't.
  - So tests and type-checks need no build first, while builds and published packages use
    `dist/`.
  - It's a standard export condition that Node, TypeScript and Vite all understand, so no tool is
    added.
- **Browser tests:** DOM packages run in Vitest's browser mode on Playwright's Chromium, headless.
  V8 coverage works there: measured, with every source file at 100%.
- **Rejected:**
  - **pnpm:** its stricter `node_modules` and shared store weren't worth a non-default tool. How
    to catch a package importing something it doesn't declare is open (`open-questions.md`).
  - **Biome:** newer, and its type-aware rules use its own inference rather than TypeScript.
  - **Nx and Turborepo:** they don't pay for themselves at this size; can be added later.
  - **esbuild:** Vite covers bundling, so it would be a separate tool for nothing.

## Name: Cerebro

The name Ido used for his earlier tool. Fine while private; check before publishing (see
`open-questions.md`).

**GitHub org and npm scope (2026-10-25):** `cerebro-ide` on both. Packages are named
`@cerebro-ide/<package>`.

- The npm scope `@cerebro` was taken: an npm user named `cerebro` owns a package. Checked via
  `registry.npmjs.org/-/org/<name>/package`, which answers "Scope not found" for a free name.
- Ido created the `cerebro-ide` GitHub org and npm organization.
- The repo keeps the name `cerebro` inside the org, as the product's main repo (like
  `electron/electron`).

## Where it lives and where it's developed

**Development distro (2026-10-25):** Ido's WSL distro is upgraded from Ubuntu 20.04 to a release
Playwright supports. Playwright 1.64 refused to install Chromium on 20.04 ("Playwright does not
support chromium on ubuntu20.04-x64"); its [requirements](https://playwright.dev/docs/intro) list
Ubuntu 22.04 / 24.04 / 26.04. Ido chose an in-place upgrade over a new distro just for Cerebro or
running browser tests in Docker.

Result: **Ubuntu 24.04.5**, two upgrades (20.04 → 22.04 → 24.04). Setting up a development machine:

- **systemd on in WSL** (`/etc/wsl.conf`: `[boot]` `systemd=true`). Without it, the
  22.04 → 24.04 upgrade hung on `snap list`, because `snapd` can't run.
- **Chromium's system packages installed with `apt`, not `sudo npx playwright install-deps`**
  (Ido: no npm code run as root for a package list). `npx playwright install-deps --dry-run
  chromium` lists what's missing, without sudo; re-check after each Playwright upgrade. For
  Playwright 1.64 on 24.04:

  ```
  sudo apt-get install -y fonts-freefont-ttf fonts-ipafont-gothic fonts-liberation fonts-noto-color-emoji fonts-tlwg-loma-otf fonts-unifont fonts-wqy-zenhei libasound2-data libasound2t64 libxfont2 x11-xkb-utils xfonts-cyrillic xfonts-encodings xfonts-scalable xfonts-utils xserver-common xvfb
  ```

- CI uses Playwright's own `npx playwright install --with-deps chromium` on its throwaway runner.

- Private GitHub repo `cerebro-ide/cerebro` (moved from `iMoses/cerebro` on 2026-10-25; old links
  redirect); a copy on the NAS so a session there can work on it any time (the NAS is always on).
- **No tooling for this project is installed on the NAS**; it isn't a proper development
  environment. Development and the spike run on another machine. Remote mode is tested on Ido's
  development machine and Windows laptop, not the NAS (see above).

## Goal: a tool first, ideally published

Primarily a tool for Ido, ideally published so others find it useful. Ido is willing to spend time
on it and has spare Claude subscription capacity to put into it.

## Process: lean until the foundation runs (2026-10-25)

Ido works lean until there's a good foundation running: pieces land even when they aren't exactly
what he hoped for. After that comes drilling into improvements, and writing skills and
instructions for future work.
