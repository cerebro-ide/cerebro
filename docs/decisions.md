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
  - **Layers:** the user's bindings come first, and can remove defaults.
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
- **TypeScript, TSX and JavaScript only**, as the spike measured. The plan's "grammars for every
  target language" isn't done.
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
- **Not yet:** persisting the index to disk (it's rebuilt per host run), other languages, and
  indexing progress in the status bar.
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
  own design (conflicts with what agents change, encodings, line endings).
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
  `.git` isn't listed. Ignored files show for now; marking them is for later.
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
