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
  - Electron wraps the same page as the last step.

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
  - **Layers:** the user's bindings come first, and can remove defaults.
- **The menu component** (`@cerebro-ide/ui-menu`) is the menu bar's dropdowns and every context
  menu.
  - Full keyboard navigation, including mnemonic letters (several items sharing a letter cycle,
    as on Windows).
  - Keys an open menu handles don't reach the app's shortcuts.
  - It stays inside the window, and gives focus back when it closes.
- **Views stay free of the menu package.** They report events such as `onTabContextMenu`, and the
  app opens the menu.

## Desktop conventions in the UI (2026-10-25)

Ido: the UI behaves like an application, not a website.

- **No text selection by default.** It's enabled only where it makes sense: text inputs, and
  content marked `.cerebro-selectable`, such as editors, logs and terminals. Nothing is selected
  while dragging or resizing.
- **App cursors, never the pointing hand:**
  - the arrow on buttons, tabs, stripe icons and menu items;
  - resize cursors on splitters;
  - the text cursor only where text is selectable.
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
