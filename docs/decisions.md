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
- [Testing in layers (2026-10-25)](#testing-in-layers-2026-10-25): unit, browser and end-to-end; CI; the playground at 100% too (changed 2026-11-03)
- [Pull requests (2026-10-25)](#pull-requests-2026-10-25): changes through PRs, Ido merges
- [Minimal dependencies: Cerebro writes its own components (2026-10-25)](#minimal-dependencies-cerebro-writes-its-own-components-2026-10-25): few dependencies
- [No UI framework: own reactive core, MobX-style (2026-10-25)](#no-ui-framework-own-reactive-core-mobx-style-2026-10-25): plain DOM and Cerebro's reactive core
- [The MobX-style API (2026-10-25)](#the-mobx-style-api-2026-10-25): the reactive core's API
- [JSX that builds DOM directly (2026-10-25)](#jsx-that-builds-dom-directly-2026-10-25): Cerebro's JSX runtime
- [The shell window (2026-10-25)](#the-shell-window-2026-10-25): the window's parts: stripes, tool windows, editor
- [Commands, menus and shortcuts (2026-10-25)](#commands-menus-and-shortcuts-2026-10-25): the command registry, keymaps, menus
- [Environment tabs (2026-10-25)](#environment-tabs-2026-10-25): a tab per open worktree
- [The main toolbar (2026-10-25)](#the-main-toolbar-2026-10-25): the menu, environment and branch selectors; the branch selector opens IntelliJ's branches popup (changed 2026-11-10)
- [The status bar (2026-10-25)](#the-status-bar-2026-10-25): its items' layout; the file's items are the active editor's, and their menus change them
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
- [Plugins (2026-10-26)](#plugins-2026-10-26): the registry and its contribution points (changed 2026-11-04: settings, editors, saving, hosts)
- [Language servers, first part (2026-10-27)](#language-servers-first-part-2026-10-27): TypeScript 7's own server, basedpyright, bash-language-server, yaml-language-server (changed 2026-11-03), a lazy pool in the host, name matches meanwhile; a declaration's Go to definition shows its usages (changed 2026-11-13)
- [Navigation (2026-10-27)](#navigation-2026-10-27): Back and Forward, Recent Files, Go to Line, Select Opened File, as IntelliJ's
- [Usages at the caret, and links with Ctrl held (2026-10-28)](#usages-at-the-caret-and-links-with-ctrl-held-2026-10-28): the language server's document highlights, IntelliJ's colours; a word with a definition as a link
- [Errors and warnings in the editor (2026-11-03)](#errors-and-warnings-in-the-editor-2026-11-03): from the language servers, pulled or pushed; IntelliJ's underlines, error stripe marks, the file's status, F2; the Problems tool window's File tab; files with errors marked in tabs and the Project tree
- [Quick fixes: Alt+Enter (2026-11-03)](#quick-fixes-altenter-2026-11-03): the language server's fixes at the caret, listed as IntelliJ's Show Context Actions, made as one edit; each keymap's keys
- [Code completion (2026-11-03)](#code-completion-2026-11-03): the language server's completions as one types and on Ctrl+Space, an import with them, undone as one; each keymap's keys
- [Quick Documentation (2026-11-03)](#quick-documentation-2026-11-03): the language server's hover, on the pointer resting on a symbol and on Ctrl+Q; its Markdown drawn as DOM, the definition highlighted; each keymap's keys
- [JSON, CSS and HTML: a language server of Cerebro's own (2026-11-04)](#json-css-and-html-a-language-server-of-cerebros-own-2026-11-04): Microsoft's libraries behind LSP; schemas from the file or SchemaStore; plain text and per-file edits for Cerebro's client
- [Parameter Info (2026-11-04)](#parameter-info-2026-11-04): what's called at the caret, above it, on Ctrl+P and as arguments are typed; Escape passes a list not shown
- [The Git Log (2026-11-04)](#the-git-log-2026-11-04): the Git tool window's commits of every branch and tag, with IntelliJ's graph and ref colours, a page at a time; the selected commit's files, diffs and details; the branches pane, the Branch filter and Refresh; the text, User, Date and Paths filters; a toolbar that keeps to its width (changed 2026-11-07); a commit's right-click menu (changed 2026-11-11); Go To Hash/Branch/Tag (2026-11-11); Go to Parent and Child Commit (2026-11-11); the branches pane's toolbar (2026-11-12); the Log follows the refs (2026-11-12); refs that don't fit as one mark (2026-11-13)
- [The Switcher (2026-11-04)](#the-switcher-2026-11-04): Ctrl+Tab's popup of tool windows and open tabs, as IntelliJ's; letting Ctrl go opens the one selected; IntelliJ's mnemonics
- [The image viewer (2026-11-04)](#the-image-viewer-2026-11-04): image files in a viewer of their own, as IntelliJ's: its zoom, chessboard, grid, toolbar, keys and image line
- [Prettier, the first plugin, and Settings → Plugins (2026-11-04)](#prettier-the-first-plugin-and-settings--plugins-2026-11-04): Reformat with Prettier from the editor's menu, on Ctrl+Alt+Shift+P and on save, with the project's own package; its settings where IntelliJ has them; a Plugins page, each on until turned off
- [Code folding (2026-11-04)](#code-folding-2026-11-04): the language server's folds, or the grammar's where it has none, with IntelliJ's placeholders, chevrons and colours; each keymap's keys
- [Logging in to remotes (2026-11-08)](#logging-in-to-remotes-2026-11-08): git's and ssh's prompts asked of the page through askpass, as IntelliJ's; its login dialog and SSH dialogs, Remember in the system's keychain, Use credential helper (off by default)
- [Pushing (2026-11-08)](#pushing-2026-11-08): IntelliJ's Push dialog, from Git → Push… (Ctrl+Shift+K) or the Commit window's Commit and Push…, or the Log's Push All up to Here… (changed 2026-11-11); the remote and the branch there chosen in it, or a remote defined; Push tags; the warning when the remote has diverged, with Fetch and Force Push; the commits and the selected one's files; the checked-out branch to its upstream; Pushing… on the status bar; how it went in a notification
- [Notifications (2026-11-08)](#notifications-2026-11-08): IntelliJ's balloons and the Notifications tool window's timeline, from its source and theme; a commit says how it went in one
- [Code Style: the indent (2026-11-08)](#code-style-the-indent-2026-11-08): IntelliJ's options and defaults, a file's indent detected as IntelliJ's, shown on the status bar, with its menu
- [Updating the project (2026-11-09)](#updating-the-project-2026-11-09): IntelliJ's Update Project (Git → Update Project…, Ctrl+T, and the Push banner's Update project…): its dialog, Merge or Rebase; fetch, then merge or rebase, local changes in the way shelved or stashed; Updating… on the status bar; how it went in IntelliJ's words, with View Commits; at conflicts, the Conflicts dialog, then on (changed 2026-11-11)
- [Merge conflicts (2026-11-09)](#merge-conflicts-2026-11-09): IntelliJ's Conflicts dialog (Accept Yours, Accept Theirs, Merge…) and its merge window, three panes kept level, in its colours; from Git → Resolve Conflicts…, the Commit window's Merge Conflicts group, and Update Project
- [A Markdown file's preview (2026-11-13)](#a-markdown-files-preview-2026-11-13): Editor, Editor and Preview, or Preview, from three buttons at the tab bar's end, as IntelliJ's Markdown editor; the split turned round, dragged and kept
- [A tool window's shortcut activates it (2026-11-12)](#a-tool-windows-shortcut-activates-it-2026-11-12): Alt+1, Alt+9 and the rest show the window with its content focused, or hide it if it has the focus, as IntelliJ's
- [Edit → Duplicate Line or Selection (2026-11-12)](#edit--duplicate-line-or-selection-2026-11-12): IntelliJ's `EditorDuplicate`, on Ctrl+D in a code editor, ahead of Show Diff's Ctrl+D
- [Git → Current File → Show History (2026-11-12)](#git--current-file--show-history-2026-11-12): the editor's file's commits on HEAD in the Log, as IntelliJ's file history; the Log's other filters cleared
- [Git → Current File → Compare with Revision (2026-11-12)](#git--current-file--compare-with-revision-2026-11-12): the editor's file as it is against one of its commits, chosen in IntelliJ's File Revisions popup, its commit message below
- [Git → Current File → Compare with Branch or Tag (2026-11-12)](#git--current-file--compare-with-branch-or-tag-2026-11-12): the editor's file as it is against a branch or a tag chosen in IntelliJ's Select Branch to Compare popup; the not-in-branch error in IntelliJ's words
- [Git → Current File → Show Diff (2026-11-12)](#git--current-file--show-diff-2026-11-12): the editor's file against its last commit, as IntelliJ's Compare with the Same Repository Version (named Show Diff for git); Ctrl+D from the Project view
- [Documents saved before git actions (2026-11-12)](#documents-saved-before-git-actions-2026-11-12): every modified document saved first, before the git actions IntelliJ saves before (read from its source); a file that can't be saved doesn't stop the action
- [Diffs of images and other binary files (2026-11-11)](#diffs-of-images-and-other-binary-files-2026-11-11): why an image's diff loaded forever; the host gives binary sides as bytes; IntelliJ's Side by Side, and Swipe, Onion Skin and Difference from GitHub; another binary file's status line
- [Cherry-Pick (2026-11-11)](#cherry-pick-2026-11-11): the Log's commit picked onto HEAD, from its toolbar or commit menu, as IntelliJ's: an empty pick skipped, the Conflicts dialog at conflicts then the pick committed; Continue and Abort Cherry-Pick in the Git menu; Revert Commit, the same way (changed 2026-11-11)
- [Git → Rebase… (2026-11-11)](#git--rebase-2026-11-11): IntelliJ's Rebase dialog: `git rebase`, the base, Modify options; --onto's new base and another branch as fields that move; then on through conflicts as Continue Rebase
- [Git → Manage Remotes… (2026-11-11)](#git--manage-remotes-2026-11-11): IntelliJ's Git Remotes dialog: the remotes as Name and URL, origin first; Add, Remove and Edit through Define Remote
- [Git → Reset HEAD… (2026-11-11)](#git--reset-head-2026-11-11): IntelliJ's Reset Head dialog: Reset Type (Mixed, Soft, Hard) and To Commit with Validate; `git reset`, recorded in Local History; and the Log's Reset Current Branch to Here…, with Keep (changed 2026-11-11); the Log's Undo Commit… (changed 2026-11-11); the Log's Edit Commit Message…, as IntelliJ's in-memory reword (changed 2026-11-13)
- [Git → New Tag… (2026-11-11)](#git--new-tag-2026-11-11): IntelliJ's Tag dialog: Tag Name, Force (only over a tag that exists), Commit with Validate, and Message, which makes it annotated; and New Tag… on a commit in the Log (changed 2026-11-11)
- [Windows keep their size and place (2026-11-11)](#windows-keep-their-size-and-place-2026-11-11): a project's window and its diff window open as they were left, for the screens there are, if on one
- [The diff viewer, as IntelliJ's (2026-11-11)](#the-diff-viewer-as-intellijs-2026-11-11): two editors and a divider, in IntelliJ's colours by kind; Synchronize Scrolling, Align Changes Highlighting, Collapse Unchanged Fragments (4 lines of context), Previous and Next Difference (F7), the toolbar and its gear; the ignore and highlighting policies; the unified viewer; a window of its own, or a tab if chosen (Show Diff in Editor Tab), through the list it was opened from; Appearance (whitespace, line numbers, indent guides, soft wraps)
- [Git → Merge… (2026-11-10)](#git--merge-2026-11-10): IntelliJ's Merge dialog: `git merge` and the branch (local, then remote), one merged already said so; Modify options (with -m, the commit's message); then on as Pull goes
- [Fetch and Pull (2026-11-10)](#fetch-and-pull-2026-11-10): Git → Fetch, every remote with --prune; Git → Pull…, IntelliJ's dialog (the remote, its branch, Modify options), merged, or rebased as Update Project with --rebase; at conflicts, the Conflicts dialog, then the merge committed; Git → Branches… and New Branch…
- [Branches (2026-11-10)](#branches-2026-11-10): IntelliJ's branches popup from the toolbar's branch selector: New Branch…, the local and remote branches, each with its menu: Checkout (Open Worktree for one checked out in another), New Branch from it, Rebase onto it, Merge it, Rename, Delete (with Restore and Delete Tracked Branch; a remote branch's too); Checkout Tag or Revision…; the tags, with Checkout, Merge and Delete; Recent first; from Git → Branches… too (changed 2026-11-13)
- [Committing a merge, and the Git menu's merge and rebase actions (2026-11-09)](#committing-a-merge-and-the-git-menus-merge-and-rebase-actions-2026-11-09): the Commit window commits a merge as IntelliJ's, with git's message; Git → Commit Merge, Abort Merge, and the Rebase menu (Abort, Continue, Skip Commit), shown while under way
- [Annotate with Git Blame (2026-11-09)](#annotate-with-git-blame-2026-11-09): who last changed each line and when, in a column of the gutter before the line numbers, as IntelliJ's; from the gutter's menu and Git → Current File; its menu's Close Annotations, Show Diff, View (columns, Colors, Names), Copy Revision Number and Options; a click shows the commit in the Log
- [Reformat Code (2026-11-04)](#reformat-code-2026-11-04): the file, or the selection, formatted by its language server on Ctrl+Alt+L, undone as one, with IntelliJ's hint of the lines changed; JSON, CSS and HTML by Cerebro's server; each keymap's keys
- [File Structure (2026-11-04)](#file-structure-2026-11-04): the file's symbols in a popup on Ctrl+F12, as a tree, narrowed as one types; bash's flat symbols nested by the host; JSON, CSS and HTML's from Cerebro's server; each keymap's keys
- [Rename (2026-11-04)](#rename-2026-11-04): in place on Shift+F6, as IntelliJ's; the servers' edits in every file, saved; Next and Previous Highlighted Error in the keymaps
- [Local History (2026-11-03)](#local-history-2026-11-03): IntelliJ's Show History, Revert and Put Label; records kept as a chain of worktree snapshots
- [Saving: one save at a time (2026-11-03)](#saving-one-save-at-a-time-2026-11-03): saves run one after another; a file's read while it's saved isn't a change on disk; on Windows, a save waits for git to let go of the file
- [The shelf and the stash (2026-11-03)](#the-shelf-and-the-stash-2026-11-03): IntelliJ's Shelve and Unshelve, git's stash; Shelf and Stash tabs in the Commit window; the Git menu
- [Committing from the Commit tool window (2026-11-02)](#committing-from-the-commit-tool-window-2026-11-02): checkboxes, Amend, the message, `git commit --only`; a file edited listed at once, saved as it's committed (changed 2026-11-11)
- [Phase 1 is WebStorm's functionality (2026-11-03)](#phase-1-is-webstorms-functionality-2026-11-03): phase 1 clones IntelliJ's important parts, phase 2 adds AI features, phase 3 reworks the UI/UX from use; change inspection as IntelliJ's, uncommitted only
- [Copy Path/Reference on a tab (2026-11-03)](#copy-pathreference-on-a-tab-2026-11-03): absolute path, file name, path from the content root, as IntelliJ's submenu
- [Changing keys on the Keymap page (2026-11-01)](#changing-keys-on-the-keymap-page-2026-11-01): any action's shortcuts, as IntelliJ's page; kept per ready-made keymap
- [Gutter markers: what a member implements or overrides (2026-10-28)](#gutter-markers-what-a-member-implements-or-overrides-2026-10-28): worked out from the servers' symbols, definitions and implementations; IntelliJ's icons
- [Scrollbars over the content (2026-10-27)](#scrollbars-over-the-content-2026-10-27): Cerebro's own thumbs, as IntelliJ's; the browser's hidden; tracks clear of the corner and the gutters, shown faintly under the pointer, pressed to page
- [Window buttons in full screen on macOS (2026-10-27)](#window-buttons-in-full-screen-on-macos-2026-10-27): real ones kept in the window, as IntelliJ's
- [The window's colours follow the theme (2026-10-27)](#the-windows-colours-follow-the-theme-2026-10-27): the window controls in the theme's colours
- [Tabs that don't fit (2026-10-27)](#tabs-that-dont-fit-2026-10-27): the strip scrolls, the cut edge fades, a chevron lists every tab
- [Several terminals (2026-10-27)](#several-terminals-2026-10-27): the Terminal tool window's shells as tabs, a + button
- [Islands Dark and Islands Light (2026-10-27)](#islands-dark-and-islands-light-2026-10-27): the light theme measured; chosen in Settings, or synced with the OS
- [Ready-made keymaps (2026-10-27)](#ready-made-keymaps-2026-10-27): IntelliJ's and VS Code's, for Windows and Linux and for macOS, chosen in Settings; IntelliJ's others (Eclipse, Emacs, NetBeans, Sublime Text, Visual Studio…) from its files
- [Search Everywhere (2026-10-27)](#search-everywhere-2026-10-27): double Shift; tabs for All, Classes, Files, Symbols, Actions and Text, as IntelliJ's
- [Search (2026-10-26)](#search-2026-10-26): Find in Files over ripgrep; Find and Replace in a file, as IntelliJ's; the search and replace history (changed 2026-11-13)
- [Editing and saving (2026-10-26)](#editing-and-saving-2026-10-26): documents that outlive tabs, keeping their place; saving on its own, as IntelliJ; conflicts with the disk asked about; deleted files' tabs closed; the Edit menu, Undo named
- [Opening a project (2026-10-26)](#opening-a-project-2026-10-26): projects as tabs in a window, a host per project; the Welcome window
- [A basic IDE before git and agent management (2026-10-26)](#a-basic-ide-before-git-and-agent-management-2026-10-26): open, edit, search, navigate, language servers first
- [The Commit tool window's toolbar (2026-10-26)](#the-commit-tool-windows-toolbar-2026-10-26): open a file or its diff, group, roll back
- [Instructions for Claude: rules and skills (2026-10-26)](#instructions-for-claude-rules-and-skills-2026-10-26): CLAUDE.md, rules by path, skills
- [Agent turns (2026-10-26)](#agent-turns-2026-10-26): a snapshot before and after each turn; listed in the Agent Changes tool window
- [Agent status and resuming (2026-10-26)](#agent-status-and-resuming-2026-10-26): from Claude Code's hooks; sessions resumed
- [Changes and diffs (2026-10-26)](#changes-and-diffs-2026-10-26): the Commit tool window, side-by-side diffs; F4 from a diff to the code
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

**The playground too (changed 2026-11-03).** The playground (the app's page) had been left out of
the unit tests and coverage, tested only end to end. Ido, asked how far its tests should go: "100%
like the rest". Every file of its `src/` is now unit-tested in the browser at 100%, with fake hosts
(`FakeHost`) and a fake desktop bridge (`test/app-bridge.ts`).
- **The page itself** (`main.tsx`, `welcome.tsx`, `boot.ts`) runs as it's imported, so it has a
  test file for each way it starts: in a browser, in the app, on macOS, after a reload.
- **Why:** the tests found bugs the end-to-end tests hadn't, each test failing without its fix:
  stale answers taken over newer ones, a tree model loading twice, a dropdown giving its popup's
  focus back to its button, a dialog opened from a popup drawn under it, the Branch dropdown kept
  for a folder without git, and two ellipses on Find in Files and Replace in Files.

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
- **The branch selector opens IntelliJ's branches popup** (changed 2026-11-10): the repository's
  branches, read from git, each with its actions (decision "Branches"). The samples keep their
  pretend branches, in a browser.

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
  - a command run on click, with the item's context (changed 2026-11-08);
  - hidden while it says so, as IntelliJ hides a widget for a file it doesn't apply to (changed
    2026-11-08);
  - an optional progress bar, determinate or indeterminate, for background tasks. It stops
    animating when the user prefers reduced motion.
- **The playground's items were samples at first:** environment, active file, a fake indexing
  task, position, separator, encoding, indent and file type. The file's are real now (below).
- **The file's items are the active editor's (changed 2026-11-08),** as IntelliJ's widgets
  (PositionPanel, LineSeparatorPanel, EncodingPanel, CodeStyleStatusBarWidget, read in its source):
  - shown for a file shown as text once it's read; hidden for a diff, an image, a file that can't
    be read, and no file. Before, they were fixed texts shown for every tab;
  - the position is the caret's `line:column`, with what's selected: `12:5 (10 chars, 1 line
    break)`, counting code points, as IntelliJ does. Clicking it opens Go to Line on the active
    editor, focused or not, as IntelliJ's;
  - the line separator is the file's first: LF, CRLF or CR (a file with only `\r` was read as LF
    before, changed 2026-11-08). Its tooltip is IntelliJ's, `Line Separator: \n`;
  - the encoding is always UTF-8: the host reads and writes files as UTF-8, and keeps a byte order
    mark. IntelliJ shows UTF-8 for a file with one too (its charset's name);
  - the indent is the one the editor uses (changed 2026-11-08): the Code Style's, or the file's
    own, detected; see "Code Style: the indent".
- **Their menus change them, as IntelliJ's popups (changed 2026-11-08),** opened above the item
  with the active editor's file as their context (a status item takes a menu, as it takes a
  command; a menu's heading can depend on its context, and a command can be left out of a menu
  where it doesn't apply, as IntelliJ's Add BOM for a file that has one):
  - **Line Separator:** IntelliJ's three items, `CRLF - Windows (\r\n)`, `LF - Unix and macOS
    (\n)` and `CR - Classic Mac OS (\r)`, the file's own disabled. The file is converted and saved
    at once, as IntelliJ's AbstractConvertLineSeparatorsAction writes it (from its source);
  - **File Encoding:** Remove BOM, or Add BOM, whichever applies, saved at once, as IntelliJ's
    RemoveBomAction and AddBomAction;
  - **the indent's:** see "Code Style: the indent".
- **Not yet:** choosing another encoding (the host reads and writes UTF-8 only); Settings' line
  separator for new files.

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
  - copy and paste in text fields work without an Edit menu of Electron's roles. **Not so**
    (changed 2026-11-13), by Ido's report from a Mac: Cmd+V didn't paste in the search popup,
    whose field keeps the app's shortcuts from it. So a text field's editing keys (Undo, Redo,
    Cut, Copy, Paste) are the Edit commands' anywhere, popups', dialogs' and the find bar's fields
    too, as a field's own are in IntelliJ: the page runs them before the field's own handlers.
    Measured on Linux by a test (a popup's Ctrl+V reaches the app's paste); on a Mac, still a
    claim. Rejected: Electron's Edit roles in the macOS menu, since the page's keymap runs the
    same keys and whether both would run (pasting twice) can't be checked without a Mac. Open to
    change.
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
  `confirmCancel` (added 2026-11-13, for the merge window) is asked before Cancel, Escape or the
  close button closes it.
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
- **Kept on disk between runs** (added 2026-11-01): the parsed blobs are saved as JSON in the app's
  data folder (`index/`, a file per repository, named by a hash of its path), a second after an
  indexing that parsed something, and loaded when the host starts. Blobs are keyed by content, so
  a saved one stays right for as long as it's parsed the same way: the file names the parser
  (a hash of the grammars, the queries and web-tree-sitter's version), and one from another parser
  is ignored. Written beside its place and moved over it, so a crash leaves the old one whole.
  Measured on ag-charts (5,231 files): the file is 14.4 MB; the first search after starting took
  11.8 s without it and 0.62 s with it. Claude's choice of format and place, open to change; blobs
  no worktree has any more aren't dropped yet.
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
- **npm and yarn alike** (changed 2026-11-04). Ido: "at work i'm using yarn, you are using npm. it
  should potentially work with both". Yarn reads `resolutions`, not npm's `overrides` or its
  lockfile, so the root has both, with the same pins. CodeMirror's shared packages (`state`, `view`,
  `language`, `autocomplete`, `@lezer/common`, `@lezer/highlight`, `@lezer/markdown`) are pinned
  there to the editor's versions: one copy of each, whatever installs them. Measured: yarn 1.22
  without them installed a second `@codemirror/view` (6.43.15 at the root beside the editor's
  6.43.14) and `@lezer/common`, and the editor highlighted nothing, on any file type; with them,
  one copy of each, and highlighting. A test checks that the two fields agree with the editor's
  versions. `yarn.lock` is ignored: npm's lockfile is the one kept.
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
- **Files added or removed on disk show** (added 2026-11-01; a gap seen in QA). While the tree is
  shown, its folders that were loaded are read again when the window gets the focus, and every 2 s
  while it has it, the same timing as open files. IntelliJ refreshes on the window's activation too,
  and otherwise from a file watcher. Polling is Claude's choice, open to change: a watcher would
  need a dependency and per-platform limits. A folder that's read again keeps showing what it held,
  with no "Loading…" flashing by, and keeps its list when the nodes read are the same, field by
  field, so its rows aren't drawn again every 2 s, under the pointer. The Commit tool window's tree, also read every 2 s, marked its
  folders as loading on each read too, by its code; this wasn't seen on screen.
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
- **More contribution points** (changed 2026-11-04, for Prettier): settings and their pages, a
  file's settings and host, the editor that has the focus (its file, and formatting it as Reformat
  Code does) and a step before files are saved. See "Prettier, the first plugin".
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
- **YAML: yaml-language-server 2.0.0** (changed 2026-11-03; published 2026-10-16, per npm), Red
  Hat's, run by the host's Node. It waited until it had been out for two weeks. Its dependencies
  were installed with `npm install --before=2026-10-20`, so none of them is newer than that.
  Measured, with real-server tests: errors in the syntax and against a schema, hover from a
  schema's descriptions, and completion of a schema's keys. From an alias, go to definition goes
  to the anchored value, not to its `&` mark. It gives no usages, so Find Usages shows the name
  matches.
  - **SchemaStore's schemas, from the network:** with no settings, it fetches schemastore.org's
    catalog and checks files whose names the catalog knows. Measured: a GitHub workflow's
    misspelt key got "Property stepz is not allowed", from "yaml-schema: GitHub Workflow". IntelliJ
    also uses SchemaStore by default (a claim). Claude's choice, open to change. The tests use a
    schema named in the file instead (`# yaml-language-server: $schema=./schema.json`), so they
    don't depend on the network.
- **A server is asked once it's read the project,** when it says so. basedpyright reports no
  progress, but logs "Found N source files". Asked before then, it answers as if only the open
  files existed (measured: no usages in an unopened file at once; found 3 s later). Questions wait
  for that line, within the 3 seconds, and the name matches show meanwhile. bash-language-server
  likewise, on "BackgroundAnalysis: Completed" (measured the same way: no usages at once).
- **`CEREBRO_LANGUAGE_SERVERS`** names the servers that run (`typescript`, `python`, `bash`,
  `yaml`, comma-separated; empty for none; all when unset). The end-to-end tests of the name matches turn
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
- **Go to definition on a declaration shows its usages** (added 2026-11-13; Ido: "in intellij I
  can jump from source to usages as well, not just to the source"), as IntelliJ's Go to
  Declaration or Usages (`GotoDeclarationOrUsageHandler2`, `gtdu.kt`'s `fromTargetData`, read from
  its source): Ctrl+B or Ctrl+click on a reference goes to its declaration; on the declaration
  itself, which refers to nothing else, "Usages of x" lists its usages, as Find Usages does. The
  declaration is told by its definitions all starting at the word under the caret, the server's
  or else the index's. Measured in the built app with TypeScript's server: Ctrl+B on
  `export function run() {}` listed its two calls, and on a call went to it.
- **Not yet:**
  - **HTML, CSS, JSON and Markdown:** (changed 2026-11-04: JSON, CSS and HTML have a server of
    Cerebro's own; see "JSON, CSS and HTML: a language server of Cerebro's own".) They gain little for navigation. With diagnostics,
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
  for Back. Not in a diff. It needs an editor with the focus, or its find bar (changed 2026-11-07),
  as IntelliJ's GotoLineAction (`EDITOR_EVEN_IF_INACTIVE`, "editor even if focus currently is in
  find bar"): it was on whenever a file's tab was active, and on macOS took Cmd+L from the Log's
  Focus Text Filter.
- **Select Opened File:** IntelliJ's crosshair button in the Project tool window's header (tool
  windows take header buttons through `ShellLayout`'s `actions`). It shows the Project tool window
  and selects the active file, opening the folders down to it (`TreeModel.reveal` in `ui-tree`);
  the focus stays in the editor.
- **Always Select Opened File** (added 2026-11-01), as IntelliJ's option of that name: in the
  Project tool window's Options (⋮) menu, under Behavior. While it's on, choosing a tab selects its
  file in the tree, as the button does, without showing the tool window. Off by default, as in
  IntelliJ; kept in the browser's storage.
- **Back and Forward show a place as it was scrolled** (changed 2026-10-27, Ido's polish pick): a
  place keeps the line at the top of its editor, and going back puts that line at the top again,
  rather than centring the caret. The editor reports the line as it scrolls (`onScroll`), read
  once CodeMirror has measured the lines: before, their heights are estimates.
- **Recent Files is kept between runs** (changed 2026-10-27): per environment, in the browser's
  storage with the layout, as IntelliJ keeps it. A file deleted since is still listed.
- **A file chosen from a list takes the focus** (changed 2026-11-01): after Go to File, Recent
  Files or Search Everywhere's files, the file's editor is focused, as IntelliJ's (a claim: not
  measured, as it focuses after navigating). Before, a file opened without a place to reveal left
  the focus on the page. The editor takes a focus request (`focus` on `CodeEditor`) once: another
  editor of the file made later doesn't take it again. So does a file opened from the Project tool
  window, by a double click or Enter: measured in IntelliJ's source, its Project view installs
  `EditSourceOnDoubleClickHandler` and `EditSourceOnEnterKeyHandler`, which focus the editor (for
  Enter, the advanced setting "Move focus to editor when Enter is pressed", on by default). Opening
  from the Commit tool window doesn't move the focus yet.
- **Show edited only** (added 2026-11-01): a checkbox in Recent Files' header, as IntelliJ's
  (`recent.files.checkbox.label`), lists the files edited instead, the latest edited first.
  Recent Files' own key flips it while the popup is open, and the action Recently Changed Files
  (no key, as IntelliJ's; found through Search Everywhere, not in a menu) opens with it on, both as
  IntelliJ's Recent Files spec states. A file counts as edited when its text changes and is left
  unsaved, so a file read again from disk doesn't. The
  list is kept per environment between runs, as the other. IntelliJ waits for a pause in typing
  before it moves a file up; here a file already first isn't moved, so typing changes nothing.
  Claude's choice, open to change.
- **Select In** (added 2026-11-01): Navigate → Select In… (Alt+F1, IntelliJ's `SelectIn` on every
  platform) opens IntelliJ's "Select In" popup at the caret: the places that can show the active
  file, numbered as IntelliJ numbers them (`numberingText`: 1 to 9, 0, then letters, each its
  mnemonic), in IntelliJ's order (its targets' weights). Two so far: Project (the Project tool
  window, as Select Opened File) and, in the app, the system's file manager, named as IntelliJ's
  `RevealFileAction` names it ("Reveal in Finder", "Show in Explorer", "Show in File Manager"),
  through Electron's `shell.showItemInFolder`. Claude's choice of targets, open to change.
- **Not yet:** caret moves by typing or clicking far away aren't places (IntelliJ counts some).
  Recent Files lacks IntelliJ's tool windows column. The Options menu's other choices (Open Files
  with Single Click and the rest) aren't there. Select In's Commit and Terminal targets (IntelliJ's
  `SelectInChangesViewTarget`, `SelectInTerminal`).

## Copy Path/Reference on a tab (2026-11-03)

Ido: "when right clicking a file tab the copy path option should be a menu asking if you want to
save the absolute, relative, or simply the name alone", as IntelliJ's.

- **A submenu, Copy Path/Reference…,** in the tab's context menu where Copy Path was, with
  IntelliJ's items and labels (`CopyReferencePopupGroup` in `PlatformActions.xml`,
  `ActionsBundle.properties`): Absolute Path and File Name, then Path from Content Root (the
  relative one).
- **What each copies,** as IntelliJ's providers (`CopyPathProvider.kt`): the absolute path as the
  system writes it (`presentableUrl`: backslashes on Windows, a claim from its name, not run
  there), the file's name, and its path from the worktree's root with `/`
  (`VfsUtilCore.getRelativePath`). A diff's tab copies its file's.
- **Keys:** Absolute Path keeps Copy Path's (Ctrl/Cmd+Shift+C), as IntelliJ's takes CopyPaths'
  (`use-shortcut-of`); the other two have none in IntelliJ's keymaps.
- **Not yet:** IntelliJ's other items (Path with Line Number, Source Root, Toolbox URL, references
  to symbols), and the value shown beside each item.

## Phase 1 is WebStorm's functionality (2026-11-03)

Ido, after Claude built views from the plan he didn't recognise ("changes since the session
started" and per commit, #104, closed): "Phase 1, I want a copy of WebStorm in terms of
functionality. The only differences so far should be the separation of the worktrees from the
project/branch into another standalone menu, and slightly better management of AI sessions.
Change inspection should be based on intellij - which basically follows only uncommited".

- **Three phases** (Ido, the same day): "Phase 1, clone the important parts of Intellij and make
  sure the GUI holds, phase 2 is to bake more AI specific features into it, and phase 3 will be to
  review and refactor UI/UX based on actual experience with the software".
- **What phase 1 builds is what WebStorm does,** its important parts; not all of it, and some of it
  not yet. Where `plan-v1.md` or `architecture.md` asks for something WebStorm doesn't have, this
  decision wins: ask Ido before building it, since it may be phase 2's.
- **The differences, in the gist** (Ido: "maybe more than 2, maybe I forgot something"):
  worktrees in a standalone menu of their own, apart from the project and branch; and somewhat
  better management of AI sessions (an agent per worktree, its status, resuming its exact session
  after a restart).
- **Change inspection is IntelliJ's:** the Commit tool window follows uncommitted changes. The
  plan's "since the session started" and per-commit views are dropped. The agent's turns stay, in
  a tool window of their own (Ido: "a nice feature, but it shouldn't be in the commit window"; see
  "Agent turns"), and he'll review them separately.

## Local History (2026-11-03)

Ido asked for Local History (2026-10-27, "yes", when asked whether to add it; and on 2026-11-03,
"and Local History"), as IntelliJ's: what happened to files outside the editor's undo (saving,
Replace in Files, Rollback, an agent's edits) can be compared with and taken back.

- **As IntelliJ's:** Local History → Show History (File menu, the editor's and its tabs' context
  menus) lists the file's versions, the latest first, with when and what changed them; the one
  selected is compared with the file as it is, side by side, and Revert puts the file back as it
  was then (deleted, if it wasn't there). Put Label… records the files under a name, listed in bold
  in every file's history. It's a dialog, where IntelliJ opens a window of its own (Claude's
  choice, open to change).
- **What's recorded, and labelled:** a save (no label, as IntelliJ's edits), Replace in Files,
  Rollback, Shelve Changes, Unshelve, Stash Changes, Unstash Changes and Revert; before each, and
  when the window gets the focus, every 30 seconds while it has it, and when Show History opens,
  what changed outside Cerebro since ("External change": an agent, git in a terminal). The first
  record is the files as found. How often is Claude's choice, open to change.
- **A save is recorded after it's answered** (changed 2026-11-03): recording before and after a
  write took two snapshots of the whole worktree, about 15 git processes, and saves on Windows
  took over a second (CI, #110: the editing tests found files not yet saved). The host now writes,
  answers, then records the file as saved, and before it the file as it was, if the last record
  hasn't that (it changed outside Cerebro since); a host test holds git up and sees the save
  answered. Other files changed outside Cerebro meanwhile are in the save's record, not an
  "External change" of their own.
- **Kept as a chain of git commits** (Claude's choice, open to change): each record is a snapshot
  of the worktree, as an agent's turns are (every file git doesn't ignore, through a copy of the
  index), after the one before it, kept by one ref, `refs/worktree/cerebro/history`. A file's
  versions are `git log` of that ref for the file (measured, in the host's tests); git stores each
  version once. Nothing is recorded when nothing changed, but a label. Rejected: IntelliJ's own
  store (claim: a binary file of changes in the IDE's system folder), which would need a format of
  our own.
- **Saving, fixed underneath:** the File Cache Conflicts seen while saving are decision "Saving:
  one save at a time". Recording made saves slower, and so the race likelier, until saves were
  recorded after they're answered.
- **Not yet:** a folder's history, and a selection's (IntelliJ's Show History for Selection); a
  file's versions across a rename; Revert for a whole record; files git ignores, and folders that
  aren't git repositories; a limit on how long records are kept (IntelliJ: 5 working days, a
  claim); one record for a Replace in Files across many files (each file's save is one).
## Saving: one save at a time (2026-11-03)

A bug fix, seen in CI (#109, the editing e2e test on Linux): a File Cache Conflict over a file
that only Cerebro had changed.

- **The cause:** the host writes a file over in place (truncated, then written), so a read of it
  meanwhile finds the save's write, whole or in part, before the editor knows it's saved, and that's
  taken for a change on disk. Two saves at once (the idle save, then the editor losing the focus)
  each read the file before writing it, and the reads every 2 seconds, and when the window gets the
  focus, read it too. An e2e test saves a 2 MB file twice at once, while it's read again: the
  conflict showed in 3 runs of 3 without the fix, and in none of 3 with it (measured locally).
- **The fix:** saves run one after another, and a read made while a file is saved, or across a
  save, is dropped; the next one counts (Claude's choice, open to change).
- **Rejected for now:** writing to a temporary file and renaming it over (IntelliJ's "safe write",
  a claim), which other readers wouldn't see half done either, but which makes a new file: links
  and the file's owner and permissions would need keeping.
- **Windows: a save waits for git to let go of the file (added 2026-11-03).** Seen in CI (#113):
  a save failed with `UNKNOWN: unknown error, ftruncate`, and Couldn't Save. Windows doesn't
  resize a file another process has mapped into memory (Microsoft's `SetEndOfFile` docs), and git
  maps a file over 32 KB while it reads it, as the Local History's `git add --all` does on every
  record. Measured on Windows with the host's code, saving a 2 MB file 300 times beside the
  records: 37 failed; alone, or beside `git status`, none. libuv has no name for that error, so on
  Windows a save tries an `UNKNOWN` again for up to 2 seconds; then none failed. An agent's or a
  terminal's git is waited out the same way. Claude's choice, open to change: the save waits only
  while the file is mapped, rather than for a whole record.
- **Records wait for a save under way (added 2026-11-03):** git reading a file while a save
  writes it over fails ("mmap failed", 15 times in the same measurement), so a
  record asked during a save starts after it (Ido: "Do both", with the waiting saves above).
  **Not yet:** a save that starts during a record can still make that record fail; the next one,
  on the next focus or a few seconds later, records the change.

## The shelf and the stash (2026-11-03)

Ido: "work on that and then also on shelve and stash", as IntelliJ's: putting uncommitted changes
aside, and back.

- **The shelf, as IntelliJ's:** Shelve Changes… (the Git menu's Uncommitted Changes, and the Commit
  window's context menu) opens IntelliJ's Shelve Changes dialog: the uncommitted files, each with a
  checkbox, and a Comment that names the shelved list. It starts with the files right-clicked
  checked, or else those going into the commit. Shelving keeps the files' changes and takes them
  back to their last commit; added and untracked files are deleted, as IntelliJ's. Unshelve…
  (Ctrl/Cmd+Shift+U) applies them again and takes the list off the shelf; Delete deletes it.
- **Kept as git commits, not IntelliJ's patch files** (Claude's choice, open to change): each
  shelved list is a commit of the last commit's files with the shelved ones as they were, made
  through a temporary index (the real one is untouched), kept by a ref under
  `refs/worktree/cerebro/shelf/`, where Cerebro keeps its refs. Git keeps it from
  garbage collection, other worktrees don't see it, and renames and binary files come back
  whole (`git diff --binary -M`, then `git apply`; renames measured, binary files a claim). If it doesn't apply (a file changed since in the
  same place), nothing changes and the list stays shelved (measured, in the host's tests).
  `git apply -C1` (changed 2026-11-13, from `-C2` the same day): a hunk applies where its lines
  moved to, with one line around it rather than three if it must; without it, git anchored a hunk
  at line 1 to the file's start, so a line added above it failed the unshelve (measured, git 2.43;
  IntelliJ's own applier finds the lines elsewhere, a claim on how far). `-C2` still failed a
  five-line file's hunk, two lines before its change and two after (measured on the unshelve,
  in its test), and `-C1` applies it, as the Log's Revert Selected Changes uses. Fewer lines make a
  hunk easier to place in the wrong spot (a claim); Claude's choice, open to change.
  IntelliJ keeps patches in the project's `.idea/shelf` (a claim, not checked: its
  shelf's location is a setting); rejected: they'd need a patch format of our own to apply.
- **The stash is git's,** as IntelliJ's Stash Changes… and Unstash Changes… run it: the Stash
  dialog (Message, Keep index, Include untracked; Create Stash), and the Unstash Changes dialog
  (the stashes, Reinstate index; Apply Stash, or Pop Stash, which drops it after).
- **Shelf and Stash tabs** in the Commit tool window's header, after Commit, while there's
  something in them, as IntelliJ's. Each lists its lists or stashes, the latest first, with when
  they were made; each expands to its files, which open their diff (double click, Enter,
  Ctrl/Cmd+D). A stash's context menu has Pop, Apply, Drop and Clear; the last two ask first
  (IntelliJ's do too: a claim).
- **A Git menu** in the main menu, after View, with Commit… and Uncommitted Changes (Shelve
  Changes…, Show Shelf, Stash Changes…, Unstash Changes…), as IntelliJ's.
- **Git's optional locks are off** for every git command the host runs (`GIT_OPTIONAL_LOCKS=0`, as
  git's documentation describes it): `git status`, which the Commit window runs every few seconds,
  otherwise refreshes the index as it reads, under the index's lock, and a stash or commit run
  meanwhile fails with "Unable to create '.git/index.lock': File exists" (git's documentation; the
  host's test measures that reading the changes now leaves the index as it was). Seen in CI (#109),
  though there the `git status` was the e2e test's own, polled while the app stashed: it runs with
  optional locks off too.
- **Not yet:** merging when an unshelve or unstash conflicts (it fails, and says why); unshelving
  some of a list's files; renaming a list; IntelliJ's Unshelve dialog's options (it asks to confirm
  instead); a stash's untracked files in its file list; Unstash's "As new branch", and Drop and
  Clear in its dialog (they're in the Stash tab's menu); the Shelf and Stash tabs' toolbars.

## Committing from the Commit tool window (2026-11-02)

The first item after the basic IDE (decision "A basic IDE before git and agent management"):
committing from the Commit tool window, as IntelliJ's non-modal commit does.

- **What goes in, by checkboxes** on each uncommitted file, folder and group: tracked files are in
  until taken out, untracked ones out until put in; a folder or group is checked when all its files
  are in, partly when some. Clicking a checkbox, or Space on the selected row, puts its files in, or
  takes them out when they're all in. A turn's files and ignored files have none. Which files are in
  is kept per worktree while the app runs, not between runs (Claude's choice, open to change).
- **Below the tree:** Amend, the message (a plain text field, "Commit Message" as its placeholder),
  then Commit. The order is a claim about IntelliJ's, from memory. The commit
  options (author, sign-off), the message's history and commit checks are later.
- **Commit** says what's missing first, in IntelliJ's words (its `VcsBundle.properties`): "Select
  files to commit", "Specify commit message", or both. Amending needs no files, to change only the
  message. After it, the message is cleared and the list read again. A failure (a hook refusing, no
  author set) shows git's message in a dialog.
- **How it commits, as IntelliJ:** its `GitCheckinEnvironment` stages the files to commit, commits
  the index, and puts back what else was staged. `git commit --only -- <paths>` does the same in one
  step: measured, a file staged and changed again is committed as it is on disk, deletions (staged
  or not) and a rename's both paths go in, and other staged files stay staged. `--only` refuses a
  path git doesn't know (measured), so untracked files are added first, and unstaged again if the
  commit fails. Paths are literal (`GIT_LITERAL_PATHSPECS`), so a file named `*.ts` is just that.
  The message goes on git's input (`--file=-`). Amending with no paths and `--only` leaves staged
  files out of it (measured).
- **Amend, as IntelliJ's** (`AmendCommitHandlerImpl`): turned on, the last commit's message replaces
  the one being written, unless they differ only in white space; turned off, the one written before
  comes back, unless the message was edited since.
- **Shortcuts, as IntelliJ's:** Commit (Ctrl+K, Cmd+K on macOS; IntelliJ declares it in
  `VcsActions.xml`, not in its keymap files) shows the window and focuses the message. Ctrl+Enter
  commits from the message, and Cmd+Enter too on macOS (`CommitActionsPanel`). Amend is Alt+M
  (Ctrl+Alt+M on macOS and in IntelliJ IDEA Classic), only while the Commit window has the keyboard.
  The other keymaps follow IntelliJ's files: Visual Studio's Commit is Ctrl+Alt+K (Cmd+Alt+Shift+K
  on macOS); Eclipse, NetBeans and Sublime Text have none, nor has Emacs an Amend.
- **How it went is a notification (changed 2026-11-08),** as IntelliJ's: see "Notifications".
- **Commit and Push (changed 2026-11-08):** see "Pushing".
- **A file edited shows at once (changed 2026-11-11),** at Ido's request ("when editing a file the
  *first* save should happen ASAP or refresh it's colour as an edited file and refresh the commit
  panel"). Its first edit reads the lists again, and a tracked file edited and not saved yet is
  listed as Modified, before the save that's up to 15 seconds away (saving when idle). That IntelliJ
  lists a file as it's edited, not once it's saved, is a claim, from memory. Saving at the first edit
  instead was rejected (Claude's choice, open to change): a save runs Actions on Save (Prettier's Run
  on save), which would reformat the file after its first key. Whether git tracks the files edited is
  the host's `git.tracked` (`git ls-files`); an untracked file is already listed, and an ignored one
  isn't asked about again until it's saved. **Commit saves the files it commits first,** so what's
  committed is what the editor shows (a claim that IntelliJ does the same).
- **Not yet:** partial commits (lines or chunks), changelists, and keeping the message between
  runs.

## Changing keys on the Keymap page (2026-11-01)

The rest of step 1 of the backlog's "Keymaps" (Ido: "not only should keymapping be configurable"):
the user changes any action's shortcuts in Settings → Keymap, as in IntelliJ's page. The choices
below, other than following IntelliJ, are Claude's and open to change.

- **Under the keymap's dropdown, every command and its shortcuts,** as IntelliJ's tree: under Main
  Menu, the main menu's menus as they're nested; the rest under Other, by name. A search field
  keeps the commands whose name or shortcut matches. A command the user changed shows in the
  accent colour, as IntelliJ shows it.
- **What can be done to the selected command shows under the list as buttons:** Add Keyboard
  Shortcut…, Remove each of its shortcuts, Reset Shortcuts. IntelliJ offers the same in a popup on
  the action; buttons show what's possible without knowing to right-click. Enter or a double click
  adds a shortcut, as in IntelliJ.
- **The Keyboard Shortcut dialog is IntelliJ's** (its texts from `KeyMapBundle.properties`): a
  field that takes the first stroke as it's pressed, a "Second stroke:" checkbox enabling a second
  field, and "Already assigned to:" listing the commands it clashes with. As IntelliJ's
  `ShortcutTextField`, the field takes every key but Tab, and Escape and Enter on their own (Enter
  once it has a stroke), which go to the dialog. A clash is the same keys, or a sequence that starts
  the other.
- **OK on a clash asks, as IntelliJ:** "This shortcut is already assigned to other actions. Do you
  want to remove the other assignments?" with Remove, Keep and Cancel.
- **Changes are a draft until Apply or OK,** as the rest of Settings: the Settings dialog gained
  pages' own views (`pages` in `openSettings`), each with its own draft, applied with the dialog's.
- **Each ready-made keymap keeps its own changes.** IntelliJ makes a named copy of a keymap the user
  changes; here, choosing another keymap shows that one's keys with its own changes, and the page
  follows the dropdown before it's applied. The changes are saved in the browser's storage, as the
  settings are (`cerebro.keymap.user`).
- **In packages:** `@cerebro-ide/ui-keymap` has the editor, its draft (`KeymapDraft`) and the
  dialogs; `Keymap.bindingsWith` gives the bindings other user bindings and keymap would.
- **Not yet:** mouse shortcuts and abbreviations; folding the list's groups; IntelliJ's Find Actions by
  Shortcut (the search field matches shortcuts as text).

## Errors and warnings in the editor (2026-11-03)

Ido, "Yes" to code insight in the editor, its first part: errors and warnings as IntelliJ shows
them.

- **From the file's language server,** asked through the host (`lsp.problems`). TypeScript 7's
  server answers when asked (`textDocument/diagnostic`: it lists `diagnosticProvider` in its
  `initialize` answer, and pushes only empty lists; measured). basedpyright and
  bash-language-server only push them (`textDocument/publishDiagnostics`), with the document's
  version (measured), so the host keeps what each pushed and answers with the list for the text
  asked about, waiting for it up to 30 s (a claim: a server still loading its project). A push
  without a version is taken for the latest text.
- **The client says it reads tags** (`tagSupport` for both requests): without it, TypeScript leaves
  out which code is unused (measured). Dynamic registration is off: basedpyright 1.40.2 exits when
  the client offers it for diagnostics (measured).
- **Severities, as IntelliJ's (a claim):** LSP's error, warning and information are IntelliJ's error, warning
  and weak warning; a hint shows only through its tags: unused code greyed (`NOT_USED_ELEMENT`),
  deprecated struck out. A problem with no severity is an error (LSP leaves it to the client).
- **IntelliJ's colours,** from its schemes' `ERRORS_ATTRIBUTES`, `WARNING_ATTRIBUTES`,
  `INFO_ATTRIBUTES`, `NOT_USED_ELEMENT_ATTRIBUTES` and `DEPRECATED_ATTRIBUTES` (Islands Dark
  `IslandSchemeDark.xml`, Light `expUI_lightScheme.xml`): wavy underlines `#fa6675`, `#f2c55c`,
  `#857042` dark, `#ff0000` and `#cccccc` light, where a warning has a background (`#fcf4d4`)
  instead; unused `#6f737a` / `#808080`; deprecated `#bcbec4` / `#404040`. Their stripe colours:
  `#d64d5b`, `#c29e4a`, `#756d56` dark; `#cf5b56`, `#f2bf57`, `#d9cfad` light. Where two overlap,
  the worse one is drawn inside.
- **Marks on the error stripe,** as the usages' are (one stripe now, shared: `stripe.ts`), drawn
  over them, the worse over the lighter; a click goes there. Hints have none.
- **The file's status at the editor's top right,** as IntelliJ's: the number of errors and of
  warnings (weak warnings counted with warnings, a claim), with IntelliJ's icons (`expui/status`,
  Apache 2.0), or its green tick when there are none, and arrows to the previous and next. Shown
  once a server has answered. Where it sits is a claim, not measured.
- **The pointer over a problem shows its message,** the worst first when several are there.
- **F2 and Shift+F2** go to the next and previous problem, only errors while there are any, round
  the file (IntelliJ's Next/Previous Highlighted Error; that it skips warnings then is a claim).
- **Asked as the file opens, and 300 ms after an edit** (a claim: typing isn't held up). An answer
  for text since edited is dropped; what's shown moves with edits, and stays when no server
  answers.
- **The Problems tool window's File tab (added 2026-11-03),** as IntelliJ's (Ido: "go ahead",
  after the errors and warnings): the active file's errors, warnings and weak warnings, in a tree
  under the file, the worst first, then in order (IntelliJ's default, `sortBySeverity`). From
  IntelliJ's source (`ProblemsViewBundle.properties`, `ProblemNode.kt`, `FileNode.kt`): a problem's
  row is its icon, its message and ` :line` in grey; the file's, its name, its folder and "N
  problems" in grey; and it says "Open file in editor to see problems", "Analyzing a.ts" until the
  first answer, or "No problems in a.ts". Double-click, Enter, F4 (Jump to Source, with the keys the
  keymaps give the Commit window's) or its context menu go there, the editor focused (JetBrains'
  help: F4 or a double-click). A click on the editor's counts shows the window (JetBrains' help).
  The page keeps each file's latest answer, so the window follows the active tab and new answers,
  the selected problem kept.
- **Files with errors are marked,** as IntelliJ marks problem files: in their tabs and in the
  Project tree, and the folders they're in, their names underlined with the error colour's wave.
  Warnings don't mark them, and a file closed keeps its mark until it's asked again (Claude's
  choices, open to change; how IntelliJ does it is a claim).
- **Weak warnings have the warning's icon** (a claim: IntelliJ's own wasn't found among its status
  icons). The icons carry their colours, so they show outside the editor's shadow root too.
- **The folder is the full path:** IntelliJ shortens it under the home folder (`~/...`).
- **View Options** (added 2026-11-13), from an eye button in a toolbar down the window's left, as
  IntelliJ's File tab has them (its source, `ProblemsViewState` and `ProblemsView.Options`): Show
  Warning and Weak Warning (errors always show), then Sort By Severity (on) and Name (off). By name,
  messages compare with numbers by their value, then by place; else by place, then by message
  (`ProblemsViewNodeComparator`). With a severity hidden, an empty file says "Problems could be
  filtered out" under "No problems in a.ts", as IntelliJ's. They're kept in the page's storage, as
  the Commit window's are.
- **Not yet:** the Problems window's Project Errors tab, its Group by Inspection, and its preview; shell scripts' problems, which bash-language-server gets from
  `shellcheck`, not bundled (a claim, from its documentation). Quick fixes have their own entry
  ("Quick fixes: Alt+Enter").

## Quick fixes: Alt+Enter (2026-11-03)

After the errors and warnings, quick fixes, as WebStorm's (Ido: "go ahead", on "1, then 2": the
Problems tool window, then Alt+Enter).

- **Alt+Enter lists what can be done at the caret,** as IntelliJ's Show Context Actions: below the
  caret's line, filtered as typed, each with a bulb. Enter makes the one chosen, as one edit that
  undo takes back, and the editor has the focus again. With none, IntelliJ's words, "No context
  actions available at this location" (`LangBundle.properties`), where the list would be. IntelliJ
  shows them as a hint (Claude's choice, open to change: as the other empty lists here). With the
  caret scrolled out of view, the list goes at the editor's top left (a claim: IntelliJ's goes in
  the editor then).
- **From the file's language server** (`lsp.contextActions`, LSP's `textDocument/codeAction`),
  given the server's own diagnostics at the caret. TypeScript 7's server offers fixes only for the
  diagnostics it's given; basedpyright finds its own (both measured). The fixes measured:
  TypeScript's "Add import from "./lib"", one per file that exports the name; basedpyright's "from
  lib import walk" and "Add `# pyright: ignore[rule]`".
- **Only actions made by edits to the file:** both servers' fixes are edits (`changes`, measured).
  Left out (Claude's choice, open to change): an action that is a command (the server makes the
  change itself, through `workspace/applyEdit`), one with a command after its edit, one the server
  says is disabled, and edits to other files.
- **Made only in the text it was found for:** if the text was edited meanwhile, the fix isn't made,
  as the server's places would be off.
- **Each keymap's keys for it,** from IntelliJ's files (`ShowIntentionActions`) and VS Code's sheets
  (Quick Fix):
  - VS Code: Ctrl+. (Cmd+. on macOS).
  - Eclipse: Ctrl+1 and Alt+Enter. Its file names the action twice; IntelliJ takes the last
    (`KeymapImpl.kt`). Eclipse (macOS): Cmd+1.
  - Visual Studio: Alt+Enter, Ctrl+. and Alt+Shift+F10.
  - All the others: Alt+Enter. It's IntelliJ IDEA's, and their files don't name the action, so
    they take it from their parents.
- **Not yet:** IntelliJ's bulb beside the line; its own intentions, which the servers don't give
  (Adjust code style settings); actions that are commands, and edits to other files; source
  actions (Organize Imports, Fix All); a fix's submenu (IntelliJ's arrow, to suppress an
  inspection).

## Code completion (2026-11-03)

After quick fixes, IntelliJ's code completion (Ido: "Yes", to "Completions … then hover and Quick
Documentation").

- **A list of what can go at the caret,** as IntelliJ's: shown as a name is typed (not a number)
  or after a `.`, and on its keys (Basic Completion, Ctrl+Space), filtered by what's typed, the
  letters matched in the accent colour. Enter or Tab puts the one chosen in; Escape closes it. Each
  shows where it's from (an import's module) or else its type, to the right in grey, as
  IntelliJ's. It's CodeMirror's autocompletion (`@codemirror/autocomplete`, already a dependency),
  in the popups' look and the editor's font. Its list takes no keys for its first 75 ms (CodeMirror's
  `interactionDelay`, measured in the tests): an Enter typed that soon is a new line.
- **From the file's language server** (`lsp.completions`, LSP's `textDocument/completion`, asked as
  invoked). Measured:
  - TypeScript 7's server sends every name, unfiltered (1062 for a bare name), and says the list is
    whole: it's asked once, and the list is filtered as one types.
  - basedpyright filters by what's typed and says its list is incomplete: it's asked again at
    each letter. Its first answer took about 1 s.
  - Both answer the same after a `.` as when invoked.
- **An import with it:** basedpyright gives a completion's import with it. TypeScript's gives it
  only when the completion is asked about (`completionItem/resolve`), whatever the client says it
  supports (measured). The completion goes in at once and its import is asked for then
  (`lsp.completionEdits`), placed in the text as it is by then. Undo takes both back as one: the
  import joins the completion's change in CodeMirror's history. It joins only within CodeMirror's
  500 ms, with no caret move between (CodeMirror's source); past that, it's undone on its own.
  Asking for it before it's chosen, as VS Code does for the selected item, was left out (Claude's
  choice, open to change): every move in the list would be a request.
- **Each keymap's keys for it,** from IntelliJ's files (`CodeCompletion`) and VS Code's sheets
  (Trigger Suggest):
  - IntelliJ IDEA, IntelliJ IDEA (macOS) and IntelliJ IDEA Classic (macOS): Ctrl+Space. The macOS
    files give it over the swap, which would make it Cmd+Space.
  - VS Code: Ctrl+Space and Ctrl+I; on macOS, Ctrl+Space and Cmd+I.
  - Emacs: Alt+/. NetBeans: Ctrl+Space and Ctrl+\. Visual Studio, and Visual Studio (macOS): Ctrl+Space
    and Ctrl+J.
  - The others' files don't name it: they take their parents'.
- **The list's scrollbar** is thin, in the scrollbars' colour: the app's own don't reach the
  editor's shadow root (Claude's choice, open to change).
- **Not yet:** IntelliJ's icons for each kind (CodeMirror's glyphs show, and none for some kinds,
  a field's); a completion's type and documentation beside the list, which TypeScript's server
  gives only when asked; signature help; snippets and placeholders; Tab replacing the word after
  the caret, as IntelliJ's; IntelliJ's ranking (CodeMirror's match score, then the server's order);
  Smart Completion (Ctrl+Shift+Space); completion in Python's e2e test, which the host's test covers.

## Quick Documentation (2026-11-03)

After code completion, IntelliJ's Quick Documentation (Ido: "Yes", to "Completions … then hover
and Quick Documentation").

- **What a symbol is, as IntelliJ shows it:** its definition, highlighted as code in the editor's
  colours, a line, then what its comments say. It shows with the pointer resting on the symbol
  (IntelliJ's "Show quick documentation on hover"), below a problem's message there in the same
  tooltip, as IntelliJ's. It also shows for the symbol at the caret on its keys (Ctrl+Q), until
  Escape, an edit, or a caret move. One at a time: Ctrl+Q closes the pointer's, and none shows
  beside it.
- **From the file's language server** (`lsp.hover`, LSP's `textDocument/hover`, Markdown asked
  for). Measured:
  - TypeScript 7 gives the signature as a `typescript` code block, then the JSDoc, with `*@param*`
    and `` `name` ``, and links.
  - basedpyright gives a `python` code block, a rule (`---`), then the docstring, with `&nbsp;`
    and hard line breaks.
  - TypeScript answered in 1–54 ms. basedpyright took 534 ms the first time, then 3 ms.
- **The Markdown is drawn as DOM nodes** from `@lezer/markdown`'s tree. It was already a
  dependency, so marked (rejected) wasn't added. HTML in a comment shows as text, so a file's
  comments can't put markup in the page. Code blocks are highlighted by the editor's languages,
  when the block's name is one of them.
- **Links show in the link colour, with their address on the pointer;** clicking one does nothing
  yet. The app has no way to open a page in the browser, and following it in the page would
  replace the app.
- **Each keymap's keys,** from IntelliJ's files (`QuickJavaDoc`) and VS Code's sheets (Show
  Hover):
  - IntelliJ IDEA: Ctrl+Q. IntelliJ IDEA (macOS): F1 and Ctrl+J. IntelliJ IDEA Classic (macOS):
    Ctrl+J.
  - VS Code: Ctrl+K Ctrl+I; on macOS, Cmd+K Cmd+I.
  - Eclipse: Ctrl+Shift+Space and F2. Eclipse (macOS): F2.
  - Visual Studio: Ctrl+K I, Ctrl+K Ctrl+I and Ctrl+Shift+F1; on macOS, Cmd+K I, Cmd+K Cmd+I and
    Ctrl+Shift+F1.
  - macOS System Shortcuts: Cmd+I and F1. Sublime Text, and Sublime Text (macOS): none (their files
    take it away).
  - Emacs and NetBeans: their files don't name it, so they keep IntelliJ IDEA's Ctrl+Q.
- **Not yet:** opening links, and going to a symbol's definition from its documentation;
  IntelliJ's sections (parameters as a table); the Documentation tool window (Ctrl+Q again);
  documentation of the completion chosen in the completion list. (Signature help: see "Parameter
  Info".)

## JSON, CSS and HTML: a language server of Cerebro's own (2026-11-04)

The plan's milestone 5: its other languages. Ido: "do them all", on JSON, CSS and HTML with a
server of Cerebro's own. This changes part of "Language servers, first part", which left these out
because they gave little for navigation. With errors, completion and Quick Documentation now in the
editor, they give more. Claude's choices, open to change.

- **One server of Cerebro's own** (`web.ts` in `servers`), on Microsoft's libraries, the ones VS
  Code's own servers for these languages are made of: `vscode-json-languageservice` 5.7.2,
  `vscode-css-languageservice` 6.3.10 and `vscode-html-languageservice` 5.6.2, behind
  `vscode-languageserver` 10.1.2. Each is the newest stable release out for two weeks. JSON's
  `latest` tag names a prerelease (6.0.0-next.3), so it's 5.7.2.
  - **Rejected: vscode-langservers-extracted,** whose last release was in 2024 (4.10.0, per npm).
  - **It's run by the host's Node** from its own entry, `web-main.js`, built beside the package's
    index. The servers that are JavaScript (basedpyright, bash-language-server) run the same way.
- **What it gives, measured with tests against the server itself:**
  - JSON: syntax errors (no comments, or trailing commas, except in `.jsonc`, `tsconfig*.json`
    and `jsconfig.json`, which VS Code also reads as JSON with comments); errors against a
    schema; hover from the schema; completion of its keys.
  - CSS, SCSS and Less: unknown properties, with "Rename to" fixes on Alt+Enter; hover;
    completion; going from a variable's use to its definition, its usages, and highlights.
  - HTML: hover, completion, and highlighting an element's other tag. The library finds no
    errors in HTML.
- **Schemas:** the one a file names (`"$schema"`), or SchemaStore's for its name, from
  schemastore.org's catalog, as the YAML server does. Measured: `package.json`'s `"version": 1`
  got "Incorrect type. Expected "string"", and `tsconfig.json`'s `"strict": "yes"` "Expected
  "boolean"". A schema's reference to another beside it is resolved against its address. Before
  that fix, one failed with "Unable to load schema from '/nodemon.json'" (measured).
- **Answered as the client takes them:** the libraries write completions as snippets (`"name":
  "$1"`), and the CSS fixes as versioned edits, whatever the client says it takes. VS Code takes
  both. The server turns them into plain text, and into edits per file, when the client doesn't
  take them, as Cerebro's doesn't.
- **Not yet:**
  - CSS and JavaScript inside HTML (`<style>`, `<script>`), which VS Code's HTML server serves
    by handing them to the other services.
  - Markdown, for which no server is on npm (marksman isn't).
  - The caret placed inside a completion's quotes, as a snippet would place it.
  - Images in documentation (the CSS hover's "Baseline" icon): their text shows instead.

## Parameter Info (2026-11-04)

After Quick Documentation, IntelliJ's Parameter Info: signature help, in LSP's words (Ido: "do them
all", to a list that ended with it). Claude's choices, open to change.

- **What's called at the caret, as IntelliJ shows it:** a line for each signature, only its
  parameters (`a: number, b?: number`, or `<no parameters>`), the one the caret is at in bold. With
  more than one signature, the others are dimmed (a claim: IntelliJ dims those the arguments rule
  out). It shows above the caret, in the tooltips' look.
- **When:** on its keys (Ctrl+P), and 1 second after a `(` or a `,` is typed (IntelliJ's "Show
  parameter info popup in 1000 ms", a claim from its settings). While it shows, it asks again
  after each edit and caret move, so the bold parameter follows. It goes when the server says the
  caret is no longer in a call, and on Escape. Only the latest answer counts, and only for the text
  and caret it was asked for.
- **From the file's language server** (`lsp.signatures`, LSP's `textDocument/signatureHelp`). The
  host turns each parameter into where it is in the signature's text, whether the server gives
  that or the parameter's text. Measured, for `add(1, ` and Python's `walk(1, `:
  - TypeScript 7 gives the parameters as text (`a: number`), the active one for the whole answer.
    It answered in 56 ms.
  - basedpyright gives them as offsets, and the active one per signature too. It answered in 555 ms
    the first time.
  - Outside a call, both answer nothing.
- **Escape goes to Parameter Info unless a completion list shows.** CodeMirror's `closeCompletion`
  takes the key whenever a completion is being asked, or kept disabled after `add(` (its source,
  and measured: the first Escape didn't reach Parameter Info). Cerebro's binding still closes such
  a completion, so its answer is dropped, but lets the key go on.
- **Each keymap's keys,** from IntelliJ's files (`ParameterInfo`) and VS Code's documentation
  (Trigger Parameter Hints, code.visualstudio.com/docs/editing/intellisense):
  - IntelliJ IDEA and NetBeans: Ctrl+P. IntelliJ IDEA (macOS), IntelliJ IDEA Classic (macOS), macOS
    System Shortcuts and Visual Studio (macOS): Cmd+P.
  - VS Code and Visual Studio: Ctrl+Shift+Space. VS Code (macOS): Cmd+Shift+Space.
  - Eclipse (macOS): Ctrl+Shift+Space. Emacs: Alt+Shift+P.
  - Eclipse, Sublime Text and Sublime Text (macOS): none (their files take it away).
- **Not yet:** a signature's documentation, which IntelliJ doesn't show here either;
  IntelliJ's parameter name hints in the text.

## The image viewer (2026-11-04)

Ido, after opening a PNG: "it should've just displayed it as an image, as intellij does (with some
basic controls like zoom and grid)". As IntelliJ's image editor, from its source
(`images/src/org/intellij/images`: `ImageEditorUI`, `ImageComponentUI`, `ImageZoomModel`,
`ZoomOptions`, `plugin.xml`, `ImagesBundle`).

- **Image files open in an image viewer**, a package of its own (`ui-image`), in place of the
  code editor: PNG, JPEG, GIF, BMP, WebP, ICO and AVIF, the formats the page can show. The host
  gives the file's bytes (`fs.readBytes`, in base64, up to the editor's 10 MB). **Claims:** the
  list of formats (IntelliJ's are what Java's ImageIO reads); SVG stays text, where IntelliJ shows
  its text beside a preview.
- **The zoom is IntelliJ's:** an image is fitted as it opens and as its area is resized, until the
  zoom is changed by hand. A small one (under 128x128) is enlarged to about that size, a large one
  shrunk to the area less 2px each side, else shown at 1:1. Zoom In doubles above 1:1 and goes up
  by 1.5 below it, up to 32; Zoom Out the reverse, down to one pixel's width or 1.5⁻⁸. Ctrl and
  the wheel zoom about the pointer. Enlarged, pixels are squares; shrunk, they're smoothed.
- **The toolbar is IntelliJ's** (`Images.EditorToolbar`): Transparency Chessboard and Grid, both
  toggles ("Show Grid", "Hide Grid"), then Zoom In, Zoom Out, Actual Size and Fit Zoom to Window.
  At its right is the image's line, in IntelliJ's words: "800x600 PNG (32-bit color) 41.44 kB".
  The format and colour depth are read from the file's header, as ImageIO's format name and
  colour model give them to IntelliJ: PNG, JPEG, GIF and BMP have a depth; WebP, ICO and AVIF
  have none here (a claim). Sizes are in metric units, as IntelliJ's `formatFileSize`.
- **The chessboard and the grid are IntelliJ's defaults:** both off; the chessboard's cells 5px,
  white and light grey, under the image; the grid's lines between the pixels from a zoom of 3,
  JBColor.DARK_GRAY. Turning one on or off makes it the default for images opened next, as
  IntelliJ's toggles do. Here that's kept in the browser's storage, where IntelliJ keeps it in its
  registry.
- **Keys:** IntelliJ's. Zoom In and Zoom Out take Expand All's and Collapse All's keys
  (`use-shortcut-of`): Ctrl+= and Ctrl+-, Cmd on macOS. Eclipse's keymaps have their own Expand
  All keys. Grid is Ctrl+' and Actual Size is Ctrl+/. The keys work while the image has the
  keyboard. The viewer takes the keyboard when it's opened from a list, as a code editor does,
  and the toolbar leaves it there.
- **A pressed toggle in a toolbar** has the stripe buttons' selected colour (a claim, not
  measured).
- **Not yet:** Show Color Picker and Change Background, the toolbar's two others (IntelliJ shows
  Change Background only with a registry key set); the right-click menu; an image changed on disk
  read again; the Settings page for the chessboard's cell size and the grid's zoom.

## The Switcher (2026-11-04)

Ido: "the next feature i want implemented is intellij switcher. (ctrl+tab) for switching between
tabs". As IntelliJ's, from its source (`Switcher.kt`, `SwitcherActions.kt`,
`SwitcherRendering.kt`).

- **A popup in the window's centre** (`openSwitcher` in `ui-popup`), on Ctrl+Tab, Ctrl+Shift+Tab
  starting from the end: the tool windows on the left, by name; the open tabs on the right, the
  latest shown first, up to 30; the selected file's folder below. With fewer than two tabs open,
  the recent files fill the list, as many as there are tool windows.
- **Its keys are IntelliJ's:** opened with Ctrl held, letting Ctrl go opens what's selected, so a
  press and a release go back to the tab shown before; Tab moves on (Shift+Tab back), from one
  list's end into the other; Up and Down within a list, Left and Right between them; Enter opens,
  Escape closes; Delete or Backspace closes the selected tab, or hides the selected tool window.
  Opened from a menu, it stays until Enter or Escape.
- **Mnemonics are IntelliJ's:** a tool window's number (Alt+1's 1), else the first capital of its
  name not taken, else the first of 0-9 and A-Z not taken; pressed with Ctrl held, a mnemonic
  opens its window. Keys are matched by where they are (`Digit1`, `KeyA`), whatever the layout.
- **The keymaps:** Ctrl+Tab and Ctrl+Shift+Tab in IntelliJ's, on macOS too, as IntelliJ has them.
  The VS Code keymaps keep Ctrl+Tab for Recent Files, as before.
- **Claims:** a tab open in two groups is listed once, and Delete closes it in both; a file's
  folder shows after its name only when another listed file has its name, from the project's
  folder where IntelliJ shows it whole; a chosen tool window's content takes the focus.
- **Not yet:** speed search, IntelliJ's narrowing of the lists as one types.

## The Git Log (2026-11-04)

The Git tool window's Log tab, as IntelliJ's (Ido: "yes, go ahead"), in three PRs: the commit list
and graph; a commit's details, files and diffs; the branches pane and filters. The third covers the
branches pane, the Branch filter and Refresh; the other filters are left for later (below).

- **The host's `git.log`** lists a page of commits (`skip`, `max`): every local branch, remote
  branch and tag, and HEAD, in date order (`--date-order`, as IntelliJ's default); each with its
  parents, author, time, subject and refs as git decorates them in full. Cerebro's own refs
  (`refs/worktree/cerebro/`) aren't listed. A repository with no commits has an empty log.
- **The graph is laid out in the page, a page at a time** (`log-graph.ts`), newest first: a commit
  takes the first lane waiting for it, its first parent its lane on down, other parents a free lane
  and a new colour; lines waiting for the same commit run side by side and join at it, as IntelliJ
  draws two heads on one base. Each row is as wide as its own lanes, its text after them, as
  IntelliJ's. Claude's design, open to change: IntelliJ's own layout (its graph's "long edges" cut
  short with arrows, and its order within a day) isn't copied.
- **Colours are IntelliJ's:** the graph's from DefaultColorGenerator (saturation 0.4, brightness
  0.65), its first eight, the same in both themes; the refs' from VcsLogStandardColors (the branch
  checked out yellow, local green, remote purple, tags grey). Computed from IntelliJ's source, not
  measured on screen. **Claims:** the lane's width (14px), the dot's size, the refs' marks (a
  square before the name), and dates as "Today 10:15", "Yesterday 10:15" or the system's short date
  and time.
- **The author's and date's columns are as wide as what they show** (changed 2026-11-13; they
  were 140 and 130 pixels whatever they showed, so a narrow Log, as each half of a comparison,
  showed no subject: at 225 pixels the subject had none and the row overflowed, measured). As
  IntelliJ's, read from its source: the widest of the first 1000 rows' texts with a `*` after it,
  at most 300 pixels (VcsLogGraphTable, VcsLogStringCellRenderer). The subject has the rest, none
  when they leave none; then they give way in proportion, as Swing's JTable shares out a width
  (doLayout, from OpenJDK's source). The subject is cut at its edge, as a cell. The unmerged
  commits' dialog sizes its columns the same way. **Not as IntelliJ's:** a column gives way in
  proportion to its width, not to what it has over its minimum (15 pixels in Swing), and no column
  keeps such a minimum (Claude's choice, open to change: CSS's flex shares it out that way).
- **Refs that don't fit** (added 2026-11-13; they were drawn past the subject, over the author and
  date, measured in the built app): as IntelliJ's, read from its source. The labels have the room
  the message leaves, and at least half the subject or all of it but 80 pixels
  (GraphCommitCellRenderer.getAvailableWidth), the message cut short to make it. Labels show with
  their names while they fit with room for one mark after them; the rest are that one mark, their
  kinds' colours each over the one before, twice for a kind more than one of them has
  (LabelPainter), with their names on the pointer. When none fits, the mark has the first's name,
  cut short. Fitted again as the subject's width changes. **Claims:** the combined mark's look (3
  pixels between its colours), and its names on the pointer (IntelliJ's tooltip lists the refs).
- **Loading:** 1000 commits a page, the next as the list scrolls within 100 rows of its end. The
  list is read again when the window is shown and when the app gets the focus back, as open files
  are re-read; it's kept as it is when the first page is the same. A page asked for before the list
  was read again is dropped. Claude's choices, open to change.
- **The selected commit's pane** (the second PR), on the Log's right as IntelliJ's, a splitter
  between them: its changed files, a flat list with each file's folder after its name, then its
  details (the subject, the rest of its message, its short hash, author, email and date). A double
  click or Enter opens a file's diff, between the commit and its first parent (the empty tree for
  a root commit), in the diff tab the Commit window and the shelf use; F4 opens the file itself,
  as IntelliJ's Jump to Source. A merge is compared with its first parent alone, where IntelliJ
  also offers the others. `git.log` gives each commit's message whole, so the details need no
  request of their own. **Claims:** the pane's starting width (400px), the details' share (up to
  half the pane), the date's format, and "No commits selected".
- **The branches pane** (the third PR), on the Log's left as IntelliJ's, a splitter between: HEAD
  (Current Branch), then Local and Remote (each remote's under its name), grouped by directory (a
  name's parts before a slash), each level in IntelliJ's order (the branch checked out, then
  directories, then branches, by name). From IntelliJ's source (BranchesTreeModel,
  BranchTreeNodeComparator, intellij.vcs.git.backend.xml): the groups, their names and order, and a
  double click or Enter on a branch setting the Branch filter to it (IntelliJ's default single
  click does nothing). The host's `git.branches` lists them (`for-each-ref`, not a remote's HEAD);
  `git.log` takes the branches to list (`--end-of-options` before them, so a name is never an
  option). **Claims:** the order of names (the system's, ignoring case, numbers by value), Local
  and Remote starting expanded, the branch checked out in bold (IntelliJ gives it an icon of its
  own), and the pane's starting width (200px).
- **The toolbar** over the commits: the Branch filter (All, HEAD, or a branch, chosen in a popup
  as the main toolbar's branch popup, the one in use checked), then Refresh (IntelliJ's Refresh
  shortcut: Ctrl+F5, Cmd+R on macOS, measured from its keymaps; while the Log has the keyboard),
  which reads the commits and the branches again. A page asked for under one filter is dropped
  once the filter changes. View Commits' range shows there too, its ends' first 8 characters
  ("Branch: 1a2b3c4d..5e6f7a8b"; IntelliJ's shows a range as it's given, a claim).
- **The text filter** (changed 2026-11-07, the first of the other filters, Ido: "go ahead"), first
  in the toolbar as IntelliJ's, from its source (VcsLogClassicFilterUi, TextFilterModel,
  GitLogProvider, VcsLogFiltererImpl, VcsLogBundle): "Text or hash", applied on Enter or as the
  field loses the focus changed (IntelliJ's registry has it not apply as typed), off when blank or
  cleared; Regex and Match Case in the field, both off to start with, as IntelliJ's; Focus Text
  Filter on Ctrl+L (Cmd+L on macOS), from the field back to the commits. The host searches the
  messages with git's `--grep`, `--fixed-strings` or `--extended-regexp`, and `--regexp-ignore-case`
  without Match Case. Text that's hashes (7 to 64 hex digits each, between spaces, commas or
  semicolons) shows the commits they start, and those whose messages name them, in every branch
  whatever the other filters; if there are none, it's searched for as text.
  - **The graph joins what a filter shows:** git gives a commit's own parents, hidden or not, even
    with `--parents` (measured, git 2.43), so the host rewrites each commit's parents to its
    nearest ancestors shown. It reads the whole history for each page to do it: 63 ms for this
    repository's 615 commits (measured in the app); a claim that it's quick enough for large ones.
    **Claims:** lines to an ancestor drawn as any other (IntelliJ may draw them otherwise; not
    compared), and the field's width (240px).
  - **Its matches are marked in the subjects** (2026-11-12), as IntelliJ's Log does by default
    (registry `vcs.log.filter.text.highlight.matches`, true; GraphCommitCellRenderer,
    VcsLogTextFilterImpl.matchingRanges): each place the text is, in any case unless Match Case,
    or each match of the expression with Regex; filled with Islands' `search-match-bg`, its text
    black (dark) or `Gray._50` (light), as SimpleColoredComponent draws a match. **Claims:** the
    expression is read as JavaScript's (git's is POSIX's: one JavaScript can't read marks nothing);
    hashes typed are marked only where a subject has them as typed.
  - **Its history** (2026-11-12), as IntelliJ's SearchTextField (VcsLogClassicFilterUi's
    TextFilterField, "Vcs.Log.Text.Filter.History"): what Enter applied, five, the latest first,
    trimmed, the same text in another case moved first; one for every repository. Alt+Down
    (ShowSearchHistory) or a press on the magnifier, once there's a history, shows "Search
    History" below the field, the field's text added first; a choice is put in the field, applied
    with Enter (IntelliJ's text filter doesn't apply as one types:
    `vcs.log.filter.text.on.the.fly`, false). Alt+Up puts the history's texts in the field in
    turn, from the last. Leaving the field applies its text without remembering it, as IntelliJ's.
    **Claims:** the popup has a search field, where IntelliJ's list has none. The magnifier has
    the arrow, as IntelliJ's (changed 2026-11-13: it was the plain one), and the list is Find in
    Files' (decision "Search").
- **The User and Date filters** (changed 2026-11-07), after Branch, as IntelliJ's
  (UserFilterPopupComponent, DateFilterPopupComponent, MultipleValueFilterPopupComponent,
  VcsLogUserResolverBase, VcsUserUtil, UserNameRegex, FilterComponent):
  - **A filter's button** shows its name alone while it's off ("User"), its name and value while
    it's on ("User: me"), with an X in its arrow's place that clears it ("Clear"; Delete or
    Backspace on the button too). The Branch filter changed to match: it showed "Branch: All".
    The values show between bars, cut short with an ellipsis past 20 characters.
  - **User:** Select…, me (when git has a user), then the last ten choices under Recent, per
    repository; typing searches me and every author, by short name (the name, else the email
    before the @), a first and last name capitalized. A name stands for every author whose name, or
    email before the @, is the same in IntelliJ's standard form (a first and last name in lower
    case); me for the user git commits as (`user.name`, `user.email`), as IntelliJ resolves it.
    The host's `git.authors` lists the authors and the user. `git.log` takes the authors exactly
    (`Name <email>`) and gives git `--author` as IntelliJ's GitLogProvider does: one extended
    regular expression, `^…$` around each escaped author, between bars, or each as text when the
    text filter matches as typed; in any case unless Match Case is on; with `log.mailmap=false`, as
    written in the commits (measured: with a mailmap, git finds none by the name written).
  - **Date:** Select… (IntelliJ's Select Period: After and Before, each a day, each on when
    checked), Last 24 hours, Last 7 days; shown "Since 11/1/26", "Until …", or "11/1/26-11/5/26",
    the system's short date. `git.log` takes the times and gives git `--after` and `--before`.
  - **Select…** is IntelliJ's multi-line field of values (MultilinePopupBuilder), below the
    button: names between bars or a line each, Ctrl+Enter (Cmd+Enter on macOS, CommonShortcuts)
    to finish, with its line "Select one or more values separated with | or new lines, use
    Ctrl+Enter to finish"; Escape or a click outside cancels; emptied, the filter goes.
  - **Claims:** the field for users has no completion, where IntelliJ's completes the authors'
    names; a day chosen in Select Period is its start, in local time; no author known by a name
    shows no commits; the popups' search fields.
  - **Each filter's popup** (Branch's, User's, Date's and Paths') says "Press Delete to clear the
    filter" below its list, and Delete there clears the filter and closes the popup, on or off, as
    IntelliJ's VcsLogPopupComponent does with the Delete action's first shortcut (Delete in each
    of its keymaps, ⌦ on macOS as Cerebro shows keys; added 2026-11-12). **Claude's, open to
    change:** Backspace only edits the search; IntelliJ's macOS keymap gives the Delete action
    Backspace too (what its popup does with it wasn't tried).
- **A narrow toolbar** (changed 2026-11-07) keeps to its width as IntelliJ's toolbars do, from
  ActionToolbarImpl and its NOWRAP layout: the filters and actions that don't fit are hidden, from
  the last, with a » at the row's end; pointing at it (or pressing it) shows the whole row in a
  popup over the row, which goes when the pointer leaves it, on a click outside or on Escape, but
  not while a filter's popup is open. Only then does the text field narrow. Why: at 1024 pixels
  wide (CI's macOS and Windows windows, a claim from the failure there; the width measured locally
  to show it) the toolbar ran past the commits column, and Refresh lay over the commit's pane.
  `ToolbarRow` in `ui-toolbar` does it. **Claims:** the »'s look and its name ("Show Hidden
  Items"; IntelliJ paints it, with no name).
- **The Paths filter** (changed 2026-11-07), after Date, as IntelliJ's
  (StructureFilterPopupComponent, VcsStructureChooser, SelectionManager, GitLogProvider): Select… (the same multi-line field, a
  path a line), Select in Tree…, then the last ten choices under Recent. A path is from the
  repository's top, a folder's ending in `/`; one typed in full, in the repository, is made so. The
  button shows the first path, cut to 30 characters as IntelliJ's StringUtil does, and how many
  more ("Paths: docs/ + 1").
  - **Select in Tree…** ("Select Paths to Filter by"): the repository's files and folders, each with
    a checkbox, as IntelliJ's: a folder checked checks what's in it, which can't be unchecked
    alone; a folder with something checked in it shows checked and can't be checked itself; Space
    checks the selected row; a hundred at most ("You have added 100 elements. No more is
    allowed."); OK needs one. Ignored files are left out.
  - **`git.log`** takes the paths and gives git `--full-history --simplify-merges -- <paths>`, as
    IntelliJ's GitLogProvider does; each as named (`:(literal)`), not as a pattern. Measured (git
    2.43): a merge that brings a path no change of its own is left out; one that joins changes to
    two paths from either side is kept.
  - **Claims:** paths show with `/` on Windows too (IntelliJ shows the system's separator); the
    tree shows unversioned files, which IntelliJ leaves out; `:(literal)` (IntelliJ's own pathspecs
    weren't checked); no roots section, as Cerebro opens one repository per environment.
  - **The button's tooltip** (added 2026-11-12), while the filter is on, lists the paths as
    IntelliJ's getToolTip does: "Paths:", then the first ten in order, a line each, then "..." if
    there are more.
  - **The filters' tooltips** (2026-11-12), as IntelliJ's FilterPopupComponent: none while a
    filter is off; while on, Branch's is the branch (a range in full), User's its values between
    commas ("me" as shown), Paths' as above, and Date has none. The X's is "Clear" with the
    Delete action's first shortcut, as IntelliJ's FilterComponent shows it. **Claim:** a range in
    full is its hashes (IntelliJ's ranges are by name).
- **Go To Hash/Branch/Tag** (2026-11-11), after Refresh, as IntelliJ's (GoToHashOrRefAction,
  GoToHashOrRefPopup): Find's shortcut (Ctrl+F, Cmd+F on macOS) while the Log has the keyboard; a
  hash's start, or a branch's or tag's name, typed ("Enter hash or branch/tag name:"), the branches
  and tags that hold the text suggested. The commit is selected, the filters cleared if they hide
  it, as a commit shown from an annotation; "x not found" if git names none (`git.resolveRevision`,
  `rev-parse --verify x^{commit}`) or the Log doesn't have it. **Claude's, open to change:** a
  dialog, where IntelliJ's is a popup; the filters cleared at once, where IntelliJ's asks ("View
  and reset filters").
- **Not yet:** the toolbar's other actions (Graph Options); the
  branches pane's toolbar's other actions (below) and its own search; tags in the pane; their menu's other items
  (Show Diff in a New Tab or Window, Create
  Patch…, Show Changes from Parents) and Compare Before with Local for a rename; Ctrl+P there; a commit's right-click menu's other
  items (Checkout, with the commit's branches and Checkout Revision, and the rest of IntelliJ's);
  IntelliJ's Log is a tab beside Console in the Git window, here it's all the window holds.
- **A commit's files are grouped by directory** (added 2026-11-13), as IntelliJ's changes trees
  are to start with (ChangesTree's DEFAULT_GROUPING_KEYS, read from its source): folders first,
  open, a folder holding only one folder as one row, as the Commit window's (the same code,
  `directory-tree.ts`). A Group By button over them, as IntelliJ's changes browser in the Log has
  its Group By (`Vcs.Log.ChangesBrowser.PresentationSettings`), opens a menu with "Directory".
  The setting is kept apart from the Commit window's, as IntelliJ keeps it, and is the same
  wherever a commit's files show: the Log, Compare with Current, Push, a deleted branch's commits,
  Show Diff with Working Tree. **Claude's, open to change:** the button's icon's drawing.
- **Show Diff over a commit's files** (added 2026-11-13), first in their toolbar, as IntelliJ's
  changes browser has it (`ChangesBrowserBase.createToolbarActions`, read from its source), and
  Ctrl+D (Cmd+D) while the list has the keyboard: the selected file's diff, as a double click opens
  it. Off for a folder, and in the Push dialog, whose diffs would open behind it.
- **Expand All and Collapse All over a commit's files** (added 2026-11-13), at the end of their
  toolbar, as IntelliJ's horizontal changes-browser toolbars have them (`TreeActionsToolbarPanel`,
  read from its source). Collapse All moves a selection inside a folder to its top row, as the
  branches pane's does.
- **History Up to Here over a commit's files** (added 2026-11-13), next to Show Diff as in
  IntelliJ's toolbar (`Vcs.RepositoryChangesBrowserToolbar`'s `Vcs.ShowHistoryForRevision`, read
  from its source): the selected file's commits up to that commit, in the Log as Git → Current
  File → Show History shows them, with the commit in the Branch filter (its hash short there, as a
  range's are). IntelliJ opens a file history tab; the Log here has no tabs (above). Off against
  the working tree, which has no commit, and in the Push dialog, where the Log would show behind
  it. **Claude's, open to change:** the icon's drawing.
- **Revert Selected Changes over a commit's files** (added 2026-11-13), between Show Diff and History
  Up to Here as in IntelliJ's toolbar (`Vcs.RevertSelectedChanges`, `RevertCommittedStuffAbstractAction`,
  read from its source): what the commit changed in the selected file is undone in it, uncommitted,
  by the patch of that change applied reversed (`git apply -R`), as IntelliJ applies it; a rename's
  both paths, so it's undone as one. Documents are saved first, and it's recorded in Local History
  as "Rollback" (IntelliJ's activity). If the patch doesn't apply, nothing is changed and a "Revert
  Changes" dialog says "Failed to revert changes: " and git's words (IntelliJ's, from `VcsBundle`;
  its applier goes on to offer a merge, which Cerebro's doesn't). Cerebro has no changelists, so
  there's no Select Target Changelist dialog, as IntelliJ's without them. Off where History Up to
  Here is. A hunk is matched with one line around it if all of them don't, so it applies where its
  lines moved to: with two, a hunk at a file's first line stays anchored there (measured, git 2.43).
  - **Not yet:** several files or a folder at once (the list selects one file); IntelliJ's merge
    when the patch doesn't apply.
- **A commit's file's right-click menu** (added 2026-11-13), IntelliJ's `Vcs.Log.ChangesBrowser.Popup`
  in its order, with what Cerebro has of it: Show Diff; Compare with Local and Compare Before with
  Local (the commit's version of the file, or the one before it, against the working tree;
  `Vcs.ShowDiffWithLocal`), Edit Source; Revert Selected Changes and History Up to Here. Each is off
  for a version that isn't there: Compare with Local and Edit Source for a file the commit deleted,
  Compare Before with Local for one it added, and for a rename, whose path before isn't the file's
  now. Edit Source is a command now, on F4 (and Cmd+Down on macOS) as the Commit window's Jump to
  Source, where F4 was a key the list caught itself. Wherever a commit's files show and can open
  something; not in the Push dialog, whose items would all be off.
- **Cherry-Pick Selected Changes in that menu** (added 2026-11-13), after Revert Selected Changes,
  as IntelliJ's (`Vcs.ApplySelectedChanges`, the same action not reversed, read from its source):
  what the commit changed in the file applied to it as it is, uncommitted, the patch with one line
  around a hunk as Revert's (measured the same, git 2.43). Recorded in Local History as "Apply
  patch"; if it doesn't apply, "Apply Changes" and "Failed to apply changes: " with git's words
  (`VcsBundle`). Off where Revert Selected Changes is.
- **Open Repository Version in a commit's file's menu** (added 2026-11-13), after Edit Source, as
  IntelliJ's (`Vcs.OpenRepositoryVersion`, read from its source): the file as the commit left it,
  in a read-only editor tab named as IntelliJ's (`AbstractVcsVirtualFile.getPresentableName`): the
  file's name and the revision, "a.ts (hash)". Off for a file the commit deleted. The host reads it
  (`git.fileAt`: `git show hash:path`). **Not yet:** a binary file (an image) only says it's
  binary, where IntelliJ opens its viewer; IntelliJ opens one tab for each file selected.
- **Compare with Local in a commit's menu** (added 2026-11-13), after Copy Revision Number and
  Cherry-Pick, as IntelliJ's (`Vcs.ShowDiffWithLocal` in `Vcs.Log.ContextMenu`;
  `ShowDiffAfterWithLocalFromLogActionProvider`, `GitLogDiffHandler.showDiffForPaths`,
  `CompareWithLocalDialog`, read from their source): what differs between the commit and the
  working tree, documents saved first, in the Changes tool window that Show Diff with Working Tree
  uses, as IntelliJ's shows it as a tab there (`CompareWithLocalDialog.showAsTab`). Over the files,
  IntelliJ's title, "Changes Between abc12345 and local version"; its toolbar's and file menu's Get
  makes the file as the commit has it, unstaged, from where it was if renamed since, or deletes it
  where the commit hasn't it (`CompareWithLocalDialog.GetVersionActionProvider`), asking first over
  a local change as the Log's Get from Revision does; the list is read again after. The window
  takes what it shows from the caller (its words over the files, its Get), so a branch's comparison
  keeps its own. **Not yet:** with a Paths filter, IntelliJ compares only those paths ("... in
  paths"); IntelliJ's Refresh in that tab.
- **Get from Revision in a commit's file's menu** (added 2026-11-13), after Cherry-Pick Selected
  Changes, as IntelliJ's (`Vcs.GetVersion`, named in the Log by
  `GetVersionFromRepositoryActionProvider`; `GetVersionAction`, read from their source): the file in
  the working tree made as the commit left it, unstaged, or deleted where the commit deleted it;
  the Local History records it as "Get from VCS", IntelliJ's activity. Where the file has a change
  here (untracked too), it asks first, in IntelliJ's words (`ReplaceFileConfirmationDialog`): "Get
  Revision", "File a.ts has been locally modified.", Overwrite Modified File or Cancel. Unsaved
  edits are saved first, as before any Git action. Where it can't be got, "Get Revision Content"
  says "Cannot load revision: " and git's words. The host asks git whether the commit has the file
  (`git ls-tree`) before deleting it, so a commit git can't read fails and the file stays.
  **Claims:** the file is named from the repository's top, where IntelliJ shows its whole path cut
  to 40 letters; IntelliJ says "Cannot save content" when writing fails, Cerebro "Cannot load
  revision" for both.
- **Show Only Affected Changes over a commit's files** (added 2026-11-13), before Group By, as
  IntelliJ's (`Vcs.Log.ShowOnlyAffectedChanges`, read from its source): there only while the Paths
  filter is on (and off in Find Action otherwise), pressed while on, off to start with, and kept.
  On, a commit's files are only those the filter's paths touch: a file named, or one in a folder
  named, before or after a rename (`FileHistoryUtil.affectsFile` and `affectsDirectory`). Where the
  commit changed none of them, IntelliJ's words show, "No changes that affect selected paths.",
  with its link "Show changes for all paths", which turns it off. Its icon is the folder's,
  IntelliJ's (`AllIcons.Nodes.Folder`).
- **A commit's right-click menu** (added 2026-11-11), IntelliJ's Vcs.Log.ContextMenu in its order,
  with what Cerebro has of it: Copy Revision Number (the full hash, as IntelliJ's), Cherry-Pick
  (decision "Cherry-Pick"), then Reset Current Branch to Here… (decision "Git → Reset HEAD…"),
  Revert Commit (decision "Cherry-Pick"), New Branch… (below) and New Tag… (decision "Git → New
  Tag…"), then, after Git's, Go to Child Commit and Go to Parent Commit (below). The commit is
  selected first, as a tree row is. No keys: IntelliJ's keymaps give these none (searched), New
  Branch… and the last two aside.
- **New Branch… from a commit** (added 2026-11-11), in the commit menu before New Tag…, as
  IntelliJ's `GitCreateNewBranchFromCommitAction`: the Create New Branch dialog, titled "Create
  Branch from" and the commit's first 8 characters, its name the one branch at the commit if there's
  one (a remote one's without its remote), as IntelliJ suggests it; the Log read again after. The
  branches are read again as the dialog opens, for Git → New Branch… too, and the name is checked
  against them once they're in: measured, a branch made since the popup last read them wasn't
  caught. Not before it opens: measured in CI's e2e, what was typed straight after choosing New
  Branch… went nowhere while they were read. **Not yet:** its shortcut,
  New Branch's while the Log has the keyboard, as IntelliJ's (`use-shortcut-of`): a chord runs the
  first enabled command bound, so Git → New Branch… would take it.
- **Go to Parent Commit and Go to Child Commit** (added 2026-11-11), IntelliJ's
  `GoToParentOrChildAction`, with its keys, Right and Left (`$default`, so every keymap), while
  the commits have the keyboard. The selection moves to the commit's parent or child, loading pages
  until a parent is there, and the commits keep the keyboard. Of several (a merge's parents, a
  commit's children) IntelliJ's numbered popup, "Select Parent to Navigate" or "Select Child to
  Navigate", at the selected row, each commit as IntelliJ names it (`8f3a2c1d "subject" by author
  on date at time`, the subject cut to 40 characters with "..."). Off with none to go to. The popup
  is a menu, as Select In's, where IntelliJ's is an action list that also filters as one types:
  Claude's choice, open to change. **Not yet:** under a filter, a parent it hides is looked for
  through every page and not gone to, where IntelliJ goes to the row its graph joins (the Log's
  commits keep git's parents, unrewritten). The author lacks IntelliJ's asterisk for a commit
  someone else committed (`getAuthorPresentation`), as the Log reads no committers.
- **Read again, the Log keeps its list when the first page's commits are the same** (above): the
  same refs too, since 2026-11-11, so a tag or branch made at a listed commit shows. Measured
  before: a tag made from the Log didn't show after its refresh, nor after Refresh.
- **The branches pane's toolbar** (added 2026-11-12), down the pane's left side as IntelliJ's
  (`Git.Log.Branches`, a vertical toolbar), with what Cerebro has of its actions, in IntelliJ's
  order (BranchesDashboardActions): New Branch, Delete Branch, Fetch, Navigate Log to Selected
  Branch Head, then Expand All and Collapse All. As IntelliJ's:
  - New Branch with HEAD selected starts at HEAD, the current branch's name suggested (none when
    detached); with a branch, at its commit (`name^0`, so the new branch tracks nothing), titled
    "Create Branch from" its name, its name suggested, a remote one's without its remote. Off for
    a directory or nothing selected.
  - Delete Branch, as the branch's Delete in the branches popup; off for the current branch and a
    protected remote one (IntelliJ's defaults, as Push's). Its icon is the new UI's for
    Actions.GC, a bin (`general/delete.svg`, from IntelliJ's icon mappings).
  - Fetch is Git → Fetch.
  - Navigate Log to Selected Branch Head selects the commit HEAD or the branch is at, "x not
    found" if the Log hasn't it, as Go To Hash/Branch/Tag.
  - The Log is read again after New Branch and Delete Branch.
  - Delete Branch's keys (added 2026-11-12), while the pane has the keyboard: SafeDelete's, as
    IntelliJ's (`DeleteBranchAction` takes them), Alt+Delete, Cmd+Delete on macOS (its `$default`
    and macOS keymaps). New Branch and Delete Branch act on the pane's selection from the keys too.
  - Hide Git Branches (added 2026-11-12), first, a separator after it, as IntelliJ's
    (`Git.Log.Hide.Branches`, BranchesInGitLogUiFactoryProvider): the pane and its splitter go, and
    a stripe as wide as the toolbar shows them again, its icon at the top and "Branches" up its side
    (IntelliJ's ExpandStripeButton). The same pane comes back, its selection and what's expanded
    kept. Whether they show is kept between runs, one for every repository (IntelliJ's
    `Show.Git.Branches`, a property of its Log's tab, shown to start with). **Claude's, open to
    change:** the arrows' drawing (not IntelliJ's), and the commits taking the keyboard when the
    pane had it.
  - Update Selected (added 2026-11-12), after New Branch, as IntelliJ's (UpdateSelectedBranchAction,
    `updateBranches`): the branch checked out is updated by Update Project; another is fetched from
    the branch it tracks straight into it (`git fetch origin refs/heads/main:refs/heads/side`), a
    fast-forward, which git refuses otherwise; one checked out in another worktree (an agent's)
    is fetched and fast-forwarded there (`merge --ff-only FETCH_HEAD`), as git won't move it from
    here. Off without a remote, while a fetch runs, and for a branch that tracks none. Its
    notifications are IntelliJ's ("Update failed", "Updated 1 branch checked out in other
    worktrees"), but "Fetched 1 target" for its "Fetched {0} targets". Its icon is Update
    Project's, as IntelliJ's (CheckOut).
  - The pane's settings (added 2026-11-12), a gear before Expand All, as IntelliJ's
    (`Git.Log.Branches.Settings`, "Branches Pane Settings"): under "On Single Click", Update
    Branch Filter or Navigate Log to Branch Head, one or neither (BranchesDashboardTreeController:
    the Branch filter set to the branch or HEAD selected, All for a directory; the Log taken to its
    head); then Group by Directory, a remote's branches under it either way. A single click does
    nothing, and the branches are grouped, to start with (IntelliJ's defaults). Kept between runs,
    one for every repository. **Not yet:** Group by Repository (one repository here); the branches
    popup's Group by Directory, which IntelliJ shares.
  - Show Tags (added 2026-11-12), after Group by Directory, as IntelliJ's (`git.branches.show.tags`,
    on to start with, BranchesDashboardUtil): a Tags group after Remote, grouped by directory as
    the branches are, expanded to start with as Local and Remote are; turned off, the tags aren't
    read. A tag filters the Log, takes it to its commit, is a favorite or not, and is found by the
    pane's search; Update Selected is off for it, having nothing tracked. Where the tags can't be
    read, the branches show without them. Delete Branch deletes a tag (added 2026-11-12), as
    IntelliJ's (`GitDeleteTagOperation`): unasked, "Deleted Tag: v1" with Restore, which makes it
    again at what it pointed at (an annotated tag's object, so it's as it was) and says "Rollback
    Successful". With remotes, it also offers Delete on Remote (added 2026-11-12), as IntelliJ's
    (`GitDeleteRemoteTagOperation`): on each remote that lists the tag (`ls-remote --tags`), a push
    deleting it, leased to what it pointed at here (`--force-with-lease`), so a tag moved there
    isn't deleted; then "Deleted Tag on Remote: v1", or "Tag Doesn't Exist on Remote: v1" when
    none had it, and "Failed to delete tag v1 on Remote" with each remote's error. Measured with
    real git: a remote whose tag was elsewhere refused the push ("stale info"). "Remote" or
    "Remotes" follows the count of remotes: IntelliJ's own results pick it the other way round
    (one repository with several remotes says "Remote"), which reads as a slip. **Claude's, open
    to change:** the tag's icon's drawing; the plural. The branches popup lists the tags too
    (added 2026-11-12, decision "Branches").
  - What a short pane has no room for goes behind a » at the toolbar's foot (added 2026-11-12), as
    IntelliJ's vertical toolbars: pointing at it shows the whole toolbar in a column over it, kept
    on the screen. It's the Log toolbar's row (`ToolbarRow`, decision "a toolbar that keeps to its
    width"), now also a column. Measured before: in the default layout the pane showed 179 px of
    the toolbar's 270, so the gear and Expand and Collapse All were out of reach. The column is
    clipped, not hidden, so a button further down taking the focus doesn't scroll it.
  - Toggle Favorite (added 2026-11-12), after Fetch, as IntelliJ's (ToggleFavoriteAction,
    DvcsBranchManager, GitBranchManager): `main` and `master`, local and on `origin`, are
    favorites until unmarked; any other branch once marked; kept for each repository (by its
    project's path), in the browser's storage. A favorite has a star, and the pane orders as
    IntelliJ's BranchTreeNodeComparator: the branch checked out, favorites, directories with a
    favorite under them, other directories, then branches. Off for HEAD and a directory. **Claude's,
    open to change:** the star's drawing.
  - Favorites in the branches popup (added 2026-11-12), shared with the pane, as IntelliJ's
    (GitDefaultBranchesPopup, GitBranchesTreeIconProvider, GitBranchesTreeModel): a favorite's
    row has a filled star (in the pane too), and another's a muted outline while it's highlighted; a click on it, or Space on
    the row highlighted, marks the branch or unmarks it, the popup staying open. Each group lists
    the branch checked out, then favorites, then the rest. The search takes no spaces, as
    IntelliJ's. **Claude's, open to change:** the star in the text's colour (IntelliJ's is
    yellow); the branch checked out keeps its check whether it's a favorite or not (IntelliJ has an icon for both); Space on an item that's not a branch does
    nothing.
  - The pane's search (added 2026-11-12), as IntelliJ's (BranchesTreeSearchField,
    FilteringBranchesTree, read from its source): a field over the tree, "Git branches search".
    Only the branches whose names (a remote one's with its remote) match, as the popups' fuzzy
    search matches, show, with their directories, all expanded; HEAD always shows. The best match
    is selected, and what matched is marked. Typing in the tree types in the field; Up and Down
    from the field go on in the tree, as does Escape once the field is empty. Cleared, the
    directories expanded before are again. Find's key, in the pane, goes from the tree to the field
    and back (the rest of the Log keeps it for Go To Hash/Branch/Tag), and the field hides the
    tree's selection from the pane's actions, as IntelliJ's. Its placeholder is IntelliJ's, "Branch or
    tag" ("Branch" until the pane showed tags). **Claude's, open to change:** the field's text in
    the error's colour when nothing matches (IntelliJ paints its background).
  - Navigate's key (added 2026-11-12): Select In's, Alt+F1 (Option+F1 on macOS), while the pane
    has the keyboard, as IntelliJ's (`use-shortcut-of="SelectIn"`); bound before Select In, which
    takes it elsewhere.
  - Show My Branches (added 2026-11-12), after Delete Branch, as IntelliJ's (ShowMyBranchesAction,
    a toggle with Find's icon; BranchesDashboardUtil, `exclusiveCommits`): on, the pane shows only
    the local and remote branches whose exclusive commits are all by "me", as the User filter has
    "me" (by the name, or the email's); no tags, and not a branch with none of its own. A branch's
    exclusive commits are IntelliJ's, in the Log's graph (every ref, as the Log reads them): its
    head, and below it each commit whose children all are, that's no other branch's head. The host
    reads the whole graph once with its authors (`git log --date-order`, as the Log's order) and
    walks it for each branch; IntelliJ uses its log index. Found again as the Log is read again;
    where they can't be found, all show. Off to start with each time, as IntelliJ's. Measured with
    real git: a branch at a commit with children elsewhere has none of its own, and a commit only
    a tag holds keeps the one below it from being its branch's alone. **Claude's, open to change:**
    the search icon for Find's.
  - Compare with Current (added 2026-11-12), after Delete Branch, as IntelliJ's
    (`ShowBranchDiffAction`, Diff's icon; `GitBrancher.compare`, `GitCompareBranchesUi`): for a
    branch or remote branch that isn't the one checked out (not a tag, nor HEAD). It opens an editor
    tab, "Compare: feature and main", with Diff's icon; again, it shows the one open. In it, two
    Logs, one over the other with a splitter between: the commits the branch has that the current
    one doesn't (`main..feature`), then the other way round, each with a commit's changes and
    details beside it, the commit menu on its commits, and IntelliJ's words above it ("Commits that
    exist in feature but don't exist in main"); with none, "main contains all commits from
    feature", and where git can't read the range, git's error. With HEAD detached, the branch is
    compared with HEAD. The branches popup has it too, as IntelliJ's ("Compare with 'main'"),
    after New Branch from.
  **Not yet:** several branches selected (IntelliJ updates them all at once); IntelliJ's Show My
  Branches being off until its log is indexed (there's no index here); Compare with Current's key
  (IntelliJ's is Show Diff's, Ctrl+D), its Logs' filter toolbar, and a detached HEAD
  named by its short hash, as IntelliJ's, rather than HEAD.
- **The Log follows the repository** (added 2026-11-12): it reads itself again, with its branches,
  when the refs it shows change, whatever changed them: Cerebro's own Git actions (Fetch, Pull,
  Push, the branches popup's), a terminal, an agent. The repository's state, read every 2 s and as
  the window gets the focus (decision "Committing a merge, and the Git menu's merge and rebase
  actions"), carries a fingerprint of them: `git for-each-ref` of the branches, remote branches
  and tags, and HEAD's commit and branch; not the agents' turns under `refs/worktree/`, which the
  Log doesn't show. As IntelliJ's Log follows the repository's changes (a claim: it watches `.git`
  through its file system, not measured here). **Claude's, open to change:** one more git process
  each read.
- **The Log stays the same Log after a checkout** (fixed 2026-11-12): its view read the projects'
  worktrees, read again in a new list after every checkout, so the Log was made again, its
  selection and the branches pane's expanded directories lost (measured in the built app).

## Prettier, the first plugin, and Settings → Plugins (2026-11-04)

Ido: "a good start would be prettier, which similar to intellij plugin will add settings menu to
configure it, including "run on save" functionality, add a context menu option, and a keyboard
shortcut that could be mapped", and "We also need a plugins screen similar to intellij, but for now
all plugins we create should be enabled by default". As IntelliJ's Prettier plugin (prettierJS, its
`plugin.xml`, `PrettierConfiguration` and `PrettierBundle`, and WebStorm's help). Claude's choices
are open to change.

- **Reformat with Prettier,** IntelliJ's action: the focused editor's file, or its selection, as one
  change undo takes back ("Reformat Code With Prettier"), with a hint at the caret in IntelliJ's
  words ("Prettier: formatted 3 lines", "Prettier: no lines changed. Content is already properly
  formatted"; one line is "line", a claim). It's last in the editor's context menu, as IntelliJ
  adds it, and on Ctrl+Alt+Shift+P (Cmd+Alt+Shift+P on macOS), from `plugin.xml`; Settings →
  Keymap changes it as any command's.
- **The project's own Prettier,** run by the host: the closest `node_modules/prettier` above the
  file, as IntelliJ's automatic configuration, or the folder the Prettier package setting names.
  The file's Prettier configuration applies, and the closest `.prettierignore` above it. Refusals
  are IntelliJ's ("Prettier: package is not installed", "File a.xyz has unsupported type",
  "Prettier: file a.ts was ignored with .prettierignore"); a syntax error says Prettier's first
  line. The package is loaded into the host process, where IntelliJ runs a Node process of its own:
  a claim that it's safe enough, open to change.
- **Settings on Languages & Frameworks → JavaScript → Prettier,** where IntelliJ has them: Prettier
  package, Run for files (IntelliJ's default, `**/*.{js,ts,jsx,tsx,cjs,cts,mjs,mts,json,vue,astro}`)
  and Run on save (off, as IntelliJ's). The glob matches from any folder down, since the plugin
  doesn't know the project's root (a claim that it's close enough). IntelliJ's three modes
  (Disabled, Automatic, Manual) are one setting less here: an empty package is automatic.
- **Run on save, on every save,** autosave too: JetBrains' help says Actions on Save run "on every
  save (autosave, explicit save invoked with Ctrl+S or by selecting File | Save All)". What it
  formats is an edit undo takes back; text typed while Prettier runs is saved as typed, unformatted.
  A file Prettier can't format is saved as it is.
- **A plugin, through the plugin API alone** (`prettier-plugin.ts`), with its host half in the host
  (`prettier.format`) until plugins can bring host code of their own. The API gains settings and
  their pages, a file's settings and host, the focused editor (`fileIn`, `formatIn` in `ui-editor`:
  Reformat Code's machinery, for a formatter that gives the whole text) and a step before saving.
- **Settings → Plugins,** after Keymap as IntelliJ's: its Installed list, each plugin's name, what it
  does, and a checkbox. Every plugin is on until it's turned off (Ido). Off removes it and what it
  added at once, where IntelliJ mostly asks to restart; which are off is kept in the browser's
  storage, as the settings are. One that failed to start says why, and is tried again when Apply is
  pressed.
- **Not yet:**
  - Run on 'Reformat Code' action, Run on paste, and Reformat with Prettier on a file or folder in
    the Project tool window.
  - IntelliJ's Prettier status bar widget, and its check of the package's version.
  - The Plugins page's Marketplace tab, a search field, and plugins loaded from disk.

## Code folding (2026-11-04)

After Reformat Code, IntelliJ's code folding (Ido: "do them all"). Claude's choices, open to
change.

- **The language server's folds, or the grammar's** (`lsp.folds`, LSP's
  `textDocument/foldingRange`, asked with character positions): where a server folds, its ranges
  are what folds; where it doesn't, CodeMirror's grammar does. Measured:
  - TypeScript 7 folds imports, comments, blocks and `// #region` regions (with their name as the
    collapsed text). YAML's server folds too.
  - basedpyright and bash-language-server don't fold: Python gets the grammar's folds, bash none.
  - Cerebro's own server now folds JSON, CSS and HTML, through Microsoft's libraries.
- **Placeholders as IntelliJ's:** a fold with a collapsed text shows that text in place of the
  whole range (a region's name); one inside a pair (`/** */`, `/* */`, `{}`, `[]`, `()`) shows
  `...` between them; anything else shows `...` from the end of its first line. That it's
  IntelliJ's is a claim, not measured. Where several folds start on a
  line, the gutter folds the biggest; the keys fold the innermost around the caret.
- **The look, from IntelliJ's sources:** the chevrons are its new UI's `fold.svg` and
  `unfold.svg` (9×9, stroke #A8ADBD light, #6F737A dark); the placeholder is `FOLDED_TEXT`
  (dark: #868991 on #393B40, border #2B2D30, from `IslandSchemeDark.xml`; light: #414D41 on
  #E9F5E6, border #ADD9C7, from `expUI_lightScheme.xml`), as theme tokens. Open folds' chevrons
  show only while the pointer is over the gutter, and the placeholder's 3px corners: claims.
- **Each keymap's keys,** from IntelliJ's keymap files (CollapseRegion, ExpandRegion,
  CollapseAllRegions, ExpandAllRegions) and VS Code's documentation (Fold, Unfold, Fold All,
  Unfold All):
  - IntelliJ IDEA: Ctrl+- and Ctrl+=, Ctrl+Shift+- and Ctrl+Shift+= for all; Cmd on macOS.
  - VS Code: Ctrl+Shift+[ and Ctrl+Shift+], Ctrl+K Ctrl+0 and Ctrl+K Ctrl+J; on macOS, Cmd+Alt+[
    and Cmd+Alt+], Cmd+K Cmd+0 and Cmd+K Cmd+J.
  - Eclipse: Ctrl+- and Ctrl++, Ctrl+Shift+/ and Ctrl+*; Cmd on macOS. Sublime Text and Visual
    Studio: their files' keys (Ctrl+M S, E, A, X with their one-Ctrl forms for Visual Studio).
    Emacs: no Collapse All, as IntelliJ's Emacs keymap removes it.
- **A Shift key CodeMirror never matched, fixed:** for a typed character CodeMirror looks a key up
  without Shift (`Ctrl-_`), then by its key's base with Shift (`Ctrl-Shift--`), so a binding
  written `Ctrl-Shift-_` never fired (measured from its source, and with a test). The keymaps now
  write such keys as the base with Shift. This also fixes Eclipse Mac's `Cmd+Shift+>` and macOS
  System Shortcuts' `Ctrl+Shift+<`, which never fired before.
- **The gutter markers' column keeps its width** with no marker in view (the caret's line folded
  or scrolled away): it had dropped to nothing and moved the text (measured: 0px, now 36px).
- **Not yet:**
  - IntelliJ's numpad + and -: CodeMirror can't tell the numpad's + from Ctrl+Shift+=, and Shift
    with a numpad key doesn't reach the editor's actions.
  - macOS System Shortcuts' Alt+Shift keys for all: CodeMirror's base fallback is skipped on macOS
    with Alt, so they can't match.
  - Folding by default (IntelliJ folds imports as a file opens), end-of-fold markers in the gutter,
    the folded text on hover, folds kept across reopening a file, and a menu for the actions.

## Logging in to remotes (2026-11-08)

The last of the Push items (Ido, 2026-11-08, asked how: "Same as intellij does", and again "Same"
for SSH passphrases and for fetch). IntelliJ's behaviour and words are from its source
(`GitHandlerAuthenticationManager`, `GitImplBase`, `GitAskPassApp`, `GitHttpAuthService`,
`GitHttpGuiAuthenticator`, `GitHttpLoginDialog`, `NativeSshGuiAuthenticator`, `SshPrompts`,
`credentialPromt.kt`, `GitVcsApplicationSettings`).

- **Asked through askpass,** as IntelliJ's: git's remote commands (push, fetch, the check of a
  remote's URL, the check for a diverged remote) run with `GIT_ASKPASS` and `SSH_ASKPASS` set to
  scripts the host writes (a `.bat` on Windows, else a shell script), which run the host's own entry
  as Node (`main.js askpass git|ssh <prompt>`). That client asks the host over a local socket,
  naming the command; the host asks the page (`askpass.prompt`), and gives git the answer, or
  nothing when it was cancelled ("Authentication request was cancelled"). `SSH_ASKPASS_REQUIRE=force`
  and a `DISPLAY` (`:0.0` when there's none) make ssh use it without a terminal, as IntelliJ's.
  Measured on real git (`askpass.test.ts`): over HTTP against `git http-backend` behind a login, git
  asks "Username for 'http://host':", then "Password for 'http://user@host':"; and OpenSSH asks the
  ssh script for a key's passphrase (with `ssh-keygen -y`, there being no SSH server to test
  against: "Enter passphrase: " on OpenSSH 9.6; CI's later one says `Enter passphrase for "/key": `,
  so the key's name is read inside double quotes too, where IntelliJ reads single ones). After a cancelled username, git still asks for the password (measured): the rest of
  that command is answered nothing, unasked, as IntelliJ's. On Windows (measured with the portable
  setup, git 2.56 against a server in WSL): the `.bat` script and a named pipe, with both prompts,
  a failed login caught and asked again. The client's question is a line, not the end of its
  connection: a named pipe closed for writing is closed both ways (measured: the host's reply
  failed with EPIPE).
- **Git's credential helpers are left out** (`-c credential.helper=`), as IntelliJ's "Use credential
  helper", off by default: a setting under Version Control → Git. When git has one configured
  (`git config --get credential.helper`), the login dialog offers Enter credentials or Use
  credentials helper; choosing the helper turns the setting on, and the command runs again with it.
- **A failed login,** by git's words as IntelliJ reads them ("authentication failed", "403
  forbidden", "fatal: repository … not found" and others), forgets the password it was given, and
  the command runs once more, asking again; the second failure is git's error. Not when it was
  cancelled, and not for the silent check of a diverged remote, which takes only what's kept and
  never shows a dialog (IntelliJ's `AuthenticationMode.SILENT`).
- **The login dialog,** as IntelliJ's `GitHttpLoginDialog`: "Log In to {host}", Username, Password
  and Remember, with Log In and Cancel. Log In says "Username cannot be empty" or "Password cannot
  be empty" under the field. The focus starts in the username while it's blank, else the password;
  a login git gave in the URL can't be changed. The username's prompt shows it, and its password
  answers the password's prompt that follows. The login is remembered for the URL as Log In is
  pressed (IntelliJ's `GitRememberedInputs`, kept in the browser's storage), so the next prompt for
  it fills it in; with its password kept, nothing is asked.
- **SSH,** as IntelliJ's `NativeSshGuiAuthenticator`: a key's passphrase ("SSH Key Passphrase",
  `Password for the SSH key "{key}":`), a user's password ("SSH Password Login"), a PIN ("SSH Pin
  Passphrase"), each a password field with Remember (its tooltip, "The password will be stored
  between application sessions."), answered from what's kept when there is one; asked for the same
  again in one command, what was kept is forgotten. A host's authenticity is "SSH Confirmation",
  Yes or No, OpenSSH's options left out of the question. Anything else is "SSH Keyboard
  Interactive", a password field alone. An empty password answers nothing, as IntelliJ's.
- **Remember** keeps the password, as IntelliJ's PasswordSafe, in the app's store
  (`packages/app/src/passwords.ts`): a file in the app's data folder, each password encrypted by
  Electron's `safeStorage` (macOS's Keychain, Windows' DPAPI, a secret service on Linux). Unticked,
  the password isn't kept; Remember starts as it was last left, ticked at first, as IntelliJ's
  remember-by-default. Where `safeStorage` has no keychain (on Linux, its `basic_text`, which
  Electron's documentation names for a desktop it doesn't recognise), passwords are kept in the
  app's memory until it quits (Claude's choice, open to change: IntelliJ's own fallbacks weren't
  read). Measured under WSLg: `basic_text`, so memory only there.
- **Not yet:** IntelliJ's hosting services' own logins in the dialog (GitHub's, GitLab's tokens);
  its saved answers to SSH's confirmation within one operation; measured on Windows and macOS (CI
  runs the unit tests on Linux only).

## Pushing (2026-11-08)

From the backlog (Ido, 2026-11-08: "All of these. Go."): "the Commit window's second button, as
IntelliJ's: it commits, then opens the Push dialog with the commits to push, and pushes." IntelliJ's
words and behaviour are from its source (`VcsPushDialog`, `PushLog`, `GitPushResultNotification`,
`DvcsBundle.properties`, `GitBundle.properties`, `VcsBundle.properties`).

- **The Push dialog,** "Push Commits to {project}", 800 pixels wide as IntelliJ's. Push, with
  Cancel. The dialog always opens; Push is enabled only when the push sends something to the
  target, which can be changed in the dialog (Ido, 2026-11-09: "like intellij, the push dailog can
  always be opened, but will allow to push only if there's a difference from where you're pushing
  to, which can be edited in the modal"; IntelliJ's own Push is enabled whenever there's a target,
  `PushController.isPushAllowed`). A detached HEAD says so instead
  (Cerebro's words, open to change). No remote: see "Defining a remote".
- **Its two panes (changed 2026-11-08),** as IntelliJ's `PushLog`:
  - on the left, the repository's row (the branch and where it goes, "main → origin : main", with
    a label: "New", "Upstream" or "New & Upstream"), and under it the commits that aren't there yet,
    newest first, by subject. A commit's tooltip is IntelliJ's: its short hash, date and author, then
    its message;
  - on the right, the selected row's files, as the Log's: the repository's row, selected to start
    with, gives all the commits' files; a commit, its own. With nothing to push, "No commits
    selected".
- **Pushing… (changed 2026-11-08):** while a push is under way, the status bar shows "Pushing…" with
  a moving bar, as IntelliJ's background task, beside the indexing; Push can't start another
  meanwhile (open to change: IntelliJ queues them).
- **Choosing where it goes (changed 2026-11-08),** as IntelliJ's `GitPushTargetPanel`: in the
  repository's row, the remote is a link to a list of the remotes when there's more than one (the
  current one highlighted, Cerebro's choice, open to change), and the branch there is a link that
  becomes a field. The field suggests the remote's branches that start with what's typed (Up and
  Down through them); Enter, or leaving the field, takes it, and Escape puts back what was there.
  What git refuses in a name goes as it's typed, as IntelliJ's `GitRefNameValidator`, and a space
  becomes "-" (its `git.branch.cleanup.symbol`). Another target asks again what the push sends.
  While the branch is typed, "Set upstream" shows when the branch has an upstream and the target
  isn't it: ticked, the push makes the target the upstream, and Push is enabled even with nothing
  to send. The label is IntelliJ's ("New" when the push makes the branch, "Upstream" when it sets
  the upstream, "New & Upstream" both), in its colours (`--cerebro-push-label`, on
  `--cerebro-push-label-background`, from its `BranchLabels`).
- **Defining a remote (changed 2026-11-08),** as IntelliJ's `GitPushTargetPanel` and
  `GitDefineRemoteDialog`: with no remote, the row's remote link says "Define remote" and there's no
  branch there; with remotes, their list ends with Define remote under a line. Define Remote asks a
  Name (origin to start with) and a URL (focused), with Fetch remote (ticked). Its words are
  IntelliJ's: "Remote name contains illegal characters" (a name git refuses as a branch name) and
  "Remote name '{0}' is already used", shown as the name is typed, with OK disabled while the name
  or the URL is blank (Cerebro's, as its prompts: IntelliJ says so on OK, with "… cannot be empty").
  OK checks that the URL answers (`git ls-remote`), the fields disabled meanwhile, and shows git's
  words under the URL when it doesn't. Then `git remote add`, and a fetch when ticked (IntelliJ's
  push dialog reads only the name and URL, so it never fetches, whatever the box says; Cerebro does
  what the box says, open to change), and the row shows where the push goes by default; failing,
  IntelliJ's "Could not add remote: {git's words}" in an Add Remote dialog. Not yet: IntelliJ's
  "Adding Remote…" progress meanwhile.
- **Where it goes, as IntelliJ's:** the branch's upstream, else the branch of the same name on
  `origin`, or on the first remote (`getDefaultOrFirstRemote`; changed 2026-11-08, it was the only
  remote). The commits are those the target doesn't have; for a new branch,
  those no branch of that remote has. The push is `git push <remote> HEAD:refs/heads/<target>`, with
  `--set-upstream` for a new branch with no upstream, or when Set upstream is ticked, so the next
  push goes to the same place. A remote that needs a login asks for it (changed 2026-11-08: it
  failed with git's message; see "Logging in to remotes").
- **Opened from** Git → Push… (Ctrl+Shift+K, Cmd+Shift+K on macOS; IntelliJ gives it in the keymap
  its dvcs-impl adds to `$default`, and Sublime Text's keymap takes it away), and from the Commit
  window's **Commit and Push…** button beside Commit ("Amend Commit and Push…" while amending): it
  commits, and opens the dialog once the commit went through.
- **Push All up to Here… (changed 2026-11-11),** IntelliJ's `GitPushUpToCommitAction`, on a
  commit in the Log (its commit menu, after Reset, Revert and Undo Commit; its words from
  `GitBundle`). The same dialog, for that commit and the ones before it that the target hasn't:
  `git push <remote> <hash>:refs/heads/<target>`. A commit pushed isn't a branch, so git sets no
  upstream for it (measured, git 2.43); when one is to be set, `git branch --set-upstream-to` does
  it after the push. A commit that isn't in the checked-out branch (`git merge-base --is-ancestor`)
  fails as IntelliJ's does, in a "Push Failed to Start" dialog, with "The commit is not in the
  current branch" (Cerebro's words). Not yet: IntelliJ pushes from the first local branch that
  has the commit when the checked-out one doesn't, or from a detached HEAD.
- **How it went is a notification,** as IntelliJ's `GitPushResultNotification`: "Pushed 2 commits to
  origin/main", "Pushed feat to new branch origin/feat" or "Everything is up to date", a balloon
  that fades; "Push rejected" (a warning: "Push to origin/main was rejected") when git's message
  has `[rejected]`, else "Push failed" with git's message, which stay, as IntelliJ's important VCS
  notifications.
- **Push tags (changed 2026-11-08),** as IntelliJ's `GitPushOptionsPanel`, at the buttons' left:
  "Push tags:" (off to start with) and All (`--tags`) or Current Branch (`--follow-tags`, the
  branch's annotated tags; measured on git 2.43). It starts as the last push in the repository left
  it, as IntelliJ's `GitPusher` keeps it in the project's settings (Cerebro keeps it in the
  browser's storage, as its other options). Ticked, Push is enabled with only tags to send
  (something to send, as above).
  The notification names the tags made there, in IntelliJ's words: "Pushed 2 commits to origin/main,
  and tag v1 to origin", "… and 2 tags to origin", "Pushed tag v1 to origin", "Pushed 2 tags to
  origin". IntelliJ's Run Git hooks beside it isn't done.
- **Measured on real git** (`push.test.ts`; changed 2026-11-08): the push runs with `--porcelain`, a
  line per ref on its output, which names the tags it made ("*" and "[new tag]"). When git fails,
  those lines are on its output, not its error output: the refused ones ("!", with "[rejected]") are
  put before git's message, so a rejection still says so.
- **When the remote has diverged (changed 2026-11-08),** as IntelliJ's `GitPushDivergenceDetector`
  and `PushDivergenceBanner` (read from its source): not for a branch the push makes, the remote's
  branch is taken from where it was last fetched, then asked of the remote (`git ls-remote`, with
  only the passwords kept: see "Logging in to remotes"; where it was fetched when it can't be
  asked). When it has commits the
  branch hasn't, a warning banner over the tree says so in IntelliJ's words ("Push will be
  rejected, branch 'main' has diverged from the remote: 2 remote commits are not in your local
  branch. …"); when they aren't fetched (`git cat-file` can't find the commit), only a fetch can
  count them, and the button is Fetch (`+refs/heads/<t>:refs/remotes/<r>/<t>`, "Fetching Remote
  Commits…" on the status bar), which reads what's pushed again; a Fetch that fails says why in a
  row of the tree, with Retry, and the push is left to the remote. A branch only behind sends
  nothing, so nothing's in its way. Measured on real git (`push.test.ts`). The banner's colours are
  the Islands themes' `Banner.warningBackground` and `warningBorderColor`. IntelliJ's banner link
  Update project… is there (changed 2026-11-09: see "Updating the project"); Show divergence in
  Git log isn't yet.
- **Force Push (changed 2026-11-08),** as IntelliJ's: on the arrow of Push, which is an option
  button (`ui-dialog`'s OK options, as IntelliJ's `JBOptionButton`: the button does the first one
  enabled, so never Force Push). It's disabled while a fetch is needed, and to a protected branch
  ("Force push to origin/main is prohibited"; IntelliJ's default protected branches, main and
  master; no setting for them yet). It asks first, as IntelliJ's: "You're going to force push to
  'main'. It replaces 2 commits on the remote. Are you sure you want to proceed?", with Don't warn
  about this target (kept per repository in the browser's storage). It pushes with
  `--force-with-lease`, expecting the remote's branch where the check saw it, else where it was
  fetched (IntelliJ's `git.use.push.force.with.lease`, on by default); "Force pushed main to
  origin/main" when it replaced commits (git's "+"), and "Force-with-lease push main to origin/main
  was rejected" when the remote's branch had moved ("stale info"). Measured on real git.
- **Not yet:** several repositories at once (asking for credentials: done, see "Logging in to
  remotes"). IntelliJ's actions on a
  rejected push's notification (Force push…, Force push anyway). In the dialog: selecting several commits, Show Details (the selected commit's
  message under its files), and opening a file's diff.

## Notifications (2026-11-08)

From the backlog (Ido, 2026-11-08: "All of these. Go."): IntelliJ's notifications, from its source
(NotificationsManagerImpl, NotificationDisplayType, NotificationsToolWindow, NotificationsPanel,
ApplicationNotificationsModel, DateFormatUtil, ShowNotificationCommitResultHandler) and its Islands
themes. A package of its own, `ui-notifications`. Claude's choices, open to change.

- **A notification** has a title (bold), text, a type (information, warning or error, with
  IntelliJ's status icons) and links under its text. It shows as it comes as a balloon that fades
  after 10 seconds, a sticky one after 5 minutes, or none, as IntelliJ's display types. A
  notification of a group closes the last one's balloon, as IntelliJ's `expirePreviousAndNotify`.
- **Balloons** sit in the window's bottom right corner, above the status bar, newest lowest; each
  closes with its × (shown while the pointer is over it) or a link. Their time starts once the
  window is active, as IntelliJ's, so one that comes while the user is in another app waits for
  them.
  - **A claim:** the time starts again when the pointer leaves a balloon, from IntelliJ's "smart
    fadeout" holding it while the pointer is over it. The balloons' size, padding and corners are
    a claim too, not measured.
- **Under dialogs and popups (changed 2026-11-08):** balloons were over them, and covered a
  dialog's buttons in a smaller window (CI's e2e on macOS and Windows, the Push dialog's Push).
  IntelliJ's modal dialogs and popups are windows over its frame, balloons and all (a claim from
  how Swing shows them, not measured).
- **The Notifications tool window** shows IntelliJ's Timeline: every notification, newest first,
  with when it came in IntelliJ's words (`Moments ago`, `5 minutes ago`, `Today 14:05`, kept up to
  date each minute), and Clear all. With none, IntelliJ's "Suggestions, events, and errors will
  appear here". The ones not seen yet have IntelliJ's background for new ones, and its stripe
  button shows a dot; they're seen once the window was shown and hides again, as IntelliJ's.
  - **A claim:** IntelliJ's dot is coloured by what's unread; Cerebro's icons are one colour.
- **Colours from the Islands themes** (`ManyIslandsDark`/`Light.theme.json`, measured): the
  balloon's (Notification.background, borderColor), its links (Notification.linkForeground), and
  the new ones' (NotificationsToolwindow.newNotification.background); the info icon's from
  IntelliJ's `expui/status/info` icons.
- **A commit says how it went in one,** as IntelliJ's ShowNotificationCommitResultHandler, sticky,
  each replacing the last: `2 files committed` with the message, or `Commit failed with error` with
  why. A failed commit was a dialog before (changed 2026-11-08).
- **Not yet:** Settings → Notifications (each group's display type, turning balloons off);
  Suggestions, the timeline's other section; a notification's menu (Don't Show Again); search in
  the tool window; other events as notifications.

## Code Style: the indent (2026-11-08)

From the backlog (Ido, 2026-11-08: "All of these. Go."): typing indented by CodeMirror's 2 spaces,
while Reformat Code indented by the tab size setting. IntelliJ's Code Style instead, from its source
(CodeStyleDefaults, CodeStyleSettings, ApplicationBundle, DetectableIndentOptionsProvider,
IndentOptionsDetectorImpl, IndentUsageStatisticsImpl, IndentOptionsAdjusterImpl,
IndentStatusBarUIContributor). Claude's choices, open to change.

- **Settings → Editor → Code Style,** with IntelliJ's options and defaults: Use tab character
  (off), Tab size (4), Indent (4), and Detect and use existing file indents for editing (on). The
  tab size moved there from General, and its default went from 2 (a sample's) to IntelliJ's 4.
  IntelliJ has these per language too; here they're for every file.
- **Typing indents with them:** Tab, Shift+Tab and new lines indent by the Indent's spaces, or by a
  tab with Use tab character.
- **A file's own indent, detected as IntelliJ's:** from the first 500 lines that start with code,
  each line's indent counted relative to the line it's nested in. Tabs when more lines start with a
  tab than with spaces; spaces when more than 80% of the indented lines do, as many as most lines
  add when that's at most 8 and more than 80% of them add it (else the Indent's). A file under 3
  lines, or over 1 MB, isn't looked at. It's looked at again after each edit, as IntelliJ's is when
  its document changes.
  - **A claim:** IntelliJ counts the lines its formatter starts a block on, leaving out comments
    and continuation lines. Cerebro has no such formatter: it leaves out lines that start in a
    comment (from the language's grammar), and counts continuation lines.
- **The status bar shows the indent used:** `4 spaces`, `2 spaces` or `Tab`, as IntelliJ's; its
  tooltip `Indent: 2 spaces (detected)` when it's the file's. IntelliJ shows "Detected" in grey
  beside it.
- **Reformat Code** formats the whole file with the settings' indent, and a selection with the
  file's, as IntelliJ's (DetectableIndentOptionsProvider.useOnFullReformat is false). LSP's
  `tabSize` is the indent in spaces, or the tab size with tabs (`insertSpaces` false).
- **The indent's menu on the status bar (changed 2026-11-08),** as IntelliJ's
  IndentStatusBarUIContributor (its titles and items from its source and bundle):
  - while the file's own indent is used, titled Indents Detection: Indent New Lines with 4 Spaces
    (the settings', for that file until the window is reloaded), Reindent File with 4 Spaces (every
    line indented again by its language, as one change undo takes back; then that's the file's
    own), and, below a line, Configure Indents for TypeScript… (Settings at Code Style) and Disable
    Indents Detection;
  - after Indent New Lines: Indent New Lines with Tab (detected), which uses the file's again.
    IntelliJ shows "detected" in grey;
  - while detection is off, titled `TypeScript Code Style`: Configure Indents and Enable Indents
    Detection. Detection is turned off or on where Settings set it, global unless a repository or
    worktree did.
  - **A claim:** IntelliJ's Reindent File reformats the indent with its formatter; Cerebro uses the
    language's indentation from its grammar (CodeMirror's `indentRange`), which leaves a line
    alone when its language can't tell.
- **Not yet:** per-language code style; continuation indent and Keep indents on empty lines;
  EditorConfig.

## A Markdown file's preview (2026-11-13)

Ido (2026-11-12): "create a markdown preview feature similar to intellij, allowing the user to
choose between the "code" the "view" or a side by side display of both". From IntelliJ's source
(`TextEditorWithPreview`, `MarkdownEditorWithPreview`, `ChangePreviewLayoutAction`, IdeBundle's
`tab.title.*`).

- **Three layouts, IntelliJ's:** Editor, Editor and Preview, and Preview. Editor and Preview is
  the default, side by side, as IntelliJ's Markdown editor opens. Each tab keeps its own layout,
  and a new tab takes the last one chosen. That's kept between runs, one for every repository, as
  IntelliJ keeps the last layout (`PropertiesComponent`).
- **Choosing Editor and Preview again turns the split round,** from side by side to one above the
  other and back, as IntelliJ's `ChangePreviewLayoutAction` does. The direction is kept for every
  file, as IntelliJ's Markdown setting is.
- **The split is dragged,** its share kept for every file, as IntelliJ's one splitter proportion;
  it starts at halves.
- **The buttons are at the tab bar's end,** for the active tab, where IntelliJ's new UI shows an
  editor's tab actions (`getTabActions`, while tabs are shown). Pressed shows the one in use. Their
  icons are drawn after IntelliJ's (a claim: not its drawings). `ui-layout`'s editor area takes a
  tab's actions (`tabActions`) for them.
- **Keys:** VS Code's keymaps have Ctrl+Shift+V for Preview and Ctrl+K V for Editor and Preview
  (Cmd on macOS), as IntelliJ's files for them have; the others have none, as IntelliJ's.
- **The preview is drawn by Cerebro, not a browser page:** the Markdown as DOM nodes from
  `@lezer/markdown`'s tree with GitHub's extensions (tables, strikethrough, task lists, bare
  links). Quick Documentation's drawing (decision "Quick Documentation") moved to `markdown.ts` and
  serves both. HTML in the file shows as text, so a file can't put markup or scripts in the page.
  Code blocks take the editor's colours: its highlight style's rules, as classes of the preview's
  own (style-mod, which CodeMirror uses, isn't a dependency of ours). It's drawn again as the text
  changes, unsaved too. **Claude's, open to change:** its look (GitHub-like spacing in the theme's
  colours), not measured from IntelliJ's stylesheet.
- **The preview follows the editor's scrolling,** as IntelliJ's auto-scroll (on to start with;
  `MarkdownEditorWithPreview`'s visible area listener scrolls it to the editor's top line): the
  block drawn from the top line at the preview's top, or as far into it as the line is into the
  block's lines (Claude's, open to change; IntelliJ's page finds the element by its source
  offset).
- **Images** (added 2026-11-13): the file's own, by a path relative to it, read through the host
  once per tab and shown as `data:` URLs (the page's policy allows no other), SVG too, which an
  image can't run scripts from; a `data:` image as it is. Until an image comes, and where it can't
  be read, its words show. **Not yet:** images on the web (the page's policy allows none), and
  paths from the repository's root (`/logo.png`).
- **Links** (added 2026-11-13): a press on one opens the file it names, by a path relative to the
  Markdown file (its anchor dropped), in a tab; `#heading` goes to that heading of the page, by
  GitHub's anchor (lower case, punctuation dropped, spaces as hyphens). Claude's choice, open to
  change: every link shows the pointer, web ones too, which do nothing yet. A link's definition
  (`[x]: https://x.y`) draws nothing, as on GitHub. **Not yet:** web links (the app has no way to
  a browser), another file's anchor, and paths from the repository's root.
- **Not yet:** IntelliJ's setting to turn the auto-scroll off; HTML drawn;
  IntelliJ's Find Action names ("View as Editor"…); its Split Layout menu.

## A tool window's shortcut activates it (2026-11-12)

From the backlog: after Alt+9, the Project tree still had the keyboard.

- **As IntelliJ's ActivateToolWindowAction** (from its source): a tool window's shortcut (Alt+1,
  Alt+9, Alt+F12...) and its View → Tool Windows item show the window and give its content the
  keyboard, unless the window has it already. Then they hide it, and the editor's tab takes the
  keyboard back. Before, they toggled the window, the focus staying where it was.
- **What takes the keyboard:** what the window's content marks `data-focus-first` holds, else the
  first thing in it that takes the focus and isn't disabled, not the header's buttons. The Log
  marks its commits, as IntelliJ focuses its commits table. The Switcher's chosen window takes it
  the same way (`focusToolWindow`, `ui-layout`); before, it took the first focusable element, a
  disabled toolbar button in the Git window since its branches got a toolbar.
- **Claude's, open to change:** whether "the window has the keyboard" counts what last had it
  before a menu took it (Edit's `target()`), so the View menu's item hides a window focused before
  the menu opened, as the shortcut does.
- **Not yet:** each window's own preferred element beyond the Log's (IntelliJ asks each content
  for its preferred focus).

## Edit → Duplicate Line or Selection (2026-11-12)

The editor's Ctrl+D, which comes before Show Diff's: IntelliJ binds both to Ctrl+D (`$default`),
and in the editor its editor action takes the key. From Show Diff's Not yet (its shortcut).

- **As IntelliJ's** `EditorDuplicate` (`DuplicateAction`, read in its source): the selection put
  again right after it, the copy selected; without one, the caret's line put again below it, the
  caret in the copy at its column. In the Edit menu, after Find (IntelliJ's `EditSmartGroup`), as
  IntelliJ names it, with no mnemonic; Undo says "Undo Duplicate Line or Selection".
- **On in a code editor that can be changed,** the one that last had the focus, as Edit's other
  commands act on it; off in a read-only one, and elsewhere, so the key goes to the next command
  bound to it (the Commit window's Show Diff, say). Its keys come first in each keymap.
- **Its keys,** from IntelliJ's keymap files: Ctrl+D (Cmd+D on macOS, and in Visual Studio's,
  which keep their parents'); NetBeans' Ctrl+Shift+Down and Up besides; Sublime Text's
  Ctrl+Shift+D (Cmd+Shift+D); Emacs's Meta+D; none in Eclipse's. VS Code's is its Copy Line Down,
  Shift+Alt+Down from its shortcut sheets (its nearest, Claude's choice, open to change).
- **Claims and differences:** Cerebro's editor has one caret, so it's done at that one; IntelliJ
  does it at each. A line in a fold is copied alone; IntelliJ copies the fold's lines with it.
- **Not yet:** Duplicate Entire Lines (`EditorDuplicateLines`, no key in IntelliJ's keymap).

## Git → Current File → Show History (2026-11-12)

The Current File submenu's item after Compare with Branch or Tag, toward IntelliJ's
`Git.FileActions` (Show History, then Show History for Selection).

- **Show History,** IntelliJ's `Vcs.ShowTabbedFileHistory` (`TabbedShowHistoryAction`, read in its
  source): the editor's file's history, shown by the Log. On when Show Diff is: IntelliJ's checks
  the same (`fileInVcsByFileStatus`).
- **The Log shows it,** as View Commits: the Git tool window shown, the Branch filter HEAD, the
  Paths filter the file, the Text, User and Date filters cleared. HEAD, as IntelliJ's file history
  starts with the other branches off (`FileHistoryUiProperties`' `isShowOtherBranches`, false).
  IntelliJ opens a tab of its own for a file's history, "History: a.ts", built on the Log
  (`FileHistoryUi`); here the one Log shows it (Claude's choice, open to change, as View Commits':
  a second Log is a tab beside it, not here yet).
- **Not yet:** following renames, as IntelliJ's does (`FileHistory`); its own tab, with its toolbar
  (Show All Branches, a revision's diff beside the list); its icon (IntelliJ's `Vcs.History`);
  Show History for Selection.

## Git → Current File → Compare with Revision (2026-11-12)

The Current File submenu's item between Show Diff and Compare with Branch or Tag, from that
decision's Not yet.

- **Compare with Revision…,** IntelliJ's `Compare.Selected` (`CompareWithSelectedRevisionAction`,
  read in its source): the editor's file as it is against one of its commits, in the diff Cerebro
  shows a local change in. On when Show Diff is (`AbstractShowDiffAction.updateDiffAction`).
- **Its popup,** "File Revisions" (`showListPopup`, `VcsBundle`): the file's commits, newest first,
  each its hash, date (as the Log's) and author, searchable by them; the highlighted one's commit
  message below, under "Commit message".
- **Its sides' titles,** as IntelliJ's `DiffActionExecutor`: the commit's hash (shortened, as
  Cerebro's other diffs) and "Local". IntelliJ's says "Local (hash)" when the file has no local
  changes; Cerebro's doesn't.
- **Claims and differences:** the commits are the Log's Paths filter's, the first thousand; IntelliJ's
  file history follows renames, and Cerebro's doesn't yet.
- **Not yet:** following renames; the popup's tree for VCSs with branches in their history (not
  git's).

## Git → Current File → Compare with Branch or Tag (2026-11-12)

The Current File submenu's next item after Show Diff, from that decision's Not yet ("the other
items of the submenu").

- **Compare with Branch or Tag…,** IntelliJ's `Git.CompareWithBranch` (`GitCompareWithRefAction`,
  read in its source): the editor's file as it is against a branch or a tag, in the diff Cerebro
  shows a local change in, its right side the file's document. After Show Diff in the submenu,
  after Compare with Revision… (changed 2026-11-12: it's there now).
- **Its popup,** "Select Branch to Compare" (`GitCompareWithBranchPopup`, `DvcsBundle`): the local
  branches but the current one, the remote ones (not `origin/HEAD`), and the tags, in IntelliJ's
  natural order, searchable ("Search for branches and tags", `GitBundle`). The choice is named in
  full (`refs/tags/v1`), as IntelliJ's `getFullName`.
- **Its sides' titles,** as IntelliJ's (`VcsDiffUtil.getRevisionTitle`, `diff.title.local`): the
  branch's or tag's name, and the current branch's with "(Local)". A diff window's title adds the
  branch's or tag's name (Claude's choice, open to change).
- **A file that isn't in the branch,** and not changed since (untracked), says so in IntelliJ's
  words: "File src/a.ts doesn't exist in branch 'other'" (or tag), under the diff's "Can't show the
  changes to …"; IntelliJ's shows the message alone.
- **Claims and differences:** IntelliJ's is off when there's nothing to compare with
  (`nothingToCompare`: no other branch); Cerebro's is on for any file of a repository, the popup
  then empty. IntelliJ's local title with HEAD detached is the short hash; Cerebro's says "Local".
- **Recent and favorites** (added 2026-11-13), as IntelliJ's (`GitCompareWithBranchesTreeModel`,
  read from its source): the branches popup's Recent group (decision "Branches"), but the current
  branch, before Local, which lists the others; in each group favorites first, then by name, a
  favorite with its star, which can't be clicked here (IntelliJ's `favoriteToggleOnClickSupported`
  is false for this popup).
- **Not yet:** the popup's settings; comparing a folder.

## Git → Current File → Show Diff (2026-11-12)

The Current File submenu's next item after Annotate, toward IntelliJ's `Git.FileActions` (Commit
File…, Add | Annotate, Compare with the Same Repository Version, Compare with Revision…, Compare
with Branch…, Show History, Show History for Selection).

- **Show Diff**, after Annotate: IntelliJ's `Compare.SameVersion`, which GitVcs names "Show Diff"
  (`getCompareWithTheSameVersionActionName`). The active editor's file against its last commit, in
  the diff Cerebro shows a local change in.
- **Off for a file git hasn't committed,** as IntelliJ's (`fileInVcsByFileStatus`: not unknown,
  added or ignored): untracked or added, as the Commit window's lists know it. **Claims:** before
  the Commit window has read the changes, and for an ignored file, it's on (those lists don't say).
- **At the editor's caret line** (added 2026-11-12), as IntelliJ's (read in its source:
  `CompareWithTheSameVersionAction` runs `DiffActionExecutor`, which puts the file's editor's caret
  line in the request as `SCROLL_TO_LINE`, on the local side): the diff's caret starts there in the
  file as it is, and on its line in the last commit's side, through the changes. In a tab, a window
  of its own, or the unified view alike. Unchanged lines folded over it are unfolded as far as
  shows it, as IntelliJ's caret unfolds the folds it moves into (`CaretImpl`, read in its source):
  seen in the app, the line was hidden in a fold before.
- **Its shortcut** (added 2026-11-12): IntelliJ's Ctrl+D (Cmd+D on macOS; `Compare.SameVersion`
  in `$default`, which no other keymap changes). In the editor, Duplicate Line or Selection takes
  it, as IntelliJ's editor action does, and the Commit window's own Show Diff there; so it's the
  Project view's, on its selected file.
- **The file, from the focus** (added 2026-11-12), for Git → Current File's items: the Project
  view's selected file while it has the focus (none for a folder); none while another tool window
  has it, so Ctrl+D in the Log doesn't show the editor's file; else the active editor's. IntelliJ
  takes the files of the view with the focus (`VcsContextUtil`, read in its source); **claim:** that
  a tool window without files gives none, from its data context, not measured.
- **Not yet:** Show Diff for several files selected in the Project view, or a folder (IntelliJ
  shows their changes).

## Documents saved before git actions (2026-11-12)

From the Cherry-Pick decision's Not yet ("documents saved first, as IntelliJ's does; none of
Cerebro's git actions does yet"): an edit not saved yet was left out of what git did, or was
overwritten by it.

- **Which actions:** those IntelliJ saves every modified document before
  (`FileDocumentManager.saveAllDocuments()`, read in its source, intellij-community master,
  2026-11-12):
  - checkout of a branch or a revision (`GitCheckoutOperation`), and of a new branch made from
    elsewhere, as from the Log's commit menu; a new branch made at HEAD isn't
    (`GitCheckoutNewBranchOperation` saves nothing), nor one not checked out;
  - Merge into Current (`GitMergeOperation`); Merge… and Pull (`GitMergeAction`, a
    `GitRepositoryAction`, which saves in `actionPerformed`);
  - Reset HEAD… and the Log's Reset Current Branch to Here… (`GitResetOperation`);
  - Git → New Tag… (`GitTag`, a `GitRepositoryAction`); not the Log's New Tag…
    (`GitCreateTagAction` saves nothing);
  - Stash Changes… and Unstash Changes… (`GitStash`, `GitUnstash`); not the stash list's Pop and
    Apply (`GitStashActions` saves nothing); Shelve Changes… (through its commit workflow,
    `AbstractCommitWorkflow`) and Unshelve (`UnshelveWithDialogAction`);
  - Update Project (`VcsUpdateTask`), Rollback (`RollbackDialogAction`), and New Worktree
    (`GitCreateWorkingTreeService`).
  - Not cherry-pick nor revert (`GitApplyChangesProcess`), rebase (`GitRebaseProcess`,
    `GitRebaseUtils`) nor push: IntelliJ's save nothing first. (The Cherry-Pick decision's Not
    yet had it that IntelliJ's cherry-pick saves first: its source says it doesn't.)
- **A file that can't be saved doesn't stop the action**, as IntelliJ's `saveAllDocuments` doesn't:
  it's reported as saving's other failures are (the "Couldn't Save" dialog), and stays modified
  (`saveBeforeGit` in `documents.ts`).
- **Commit isn't changed:** it saves the files put in, and stops if one can't be saved (decision
  "A file edited shows at once"). IntelliJ's saves every document and goes on. **Claude's, open to
  change:** what's committed is then never other than what was shown.
- **Not yet:** the actions Cerebro doesn't have.

## Diffs of images and other binary files (2026-11-11)

Ido: "trying to open an image diff currently is loading forever. we should have a diff for images,
similar to what intellij does, or github is also a good inspiration - ideally it'll support side by
side, swipe, onion, and even a pixel diff mode which shows which pixels have changed".

- **Why it loaded forever (measured):** between two commits (the Log's diffs), the host read both
  sides with `git show` as text, binary or not, and the diff compared them as text. Comparing an
  11 kB PNG with a 50 kB one took 19.7 s in `compare` alone; in the app, a diff window opened from
  the Log on a 1200x800 PNG still said "Loading…" after 52 s. From the Commit window, the file on
  disk was refused as binary, and the diff said so.
- **The host reads a diff's sides as bytes** (`gitBytes`, `bytesAt`). If either side is binary (a
  NUL in its first 8000 bytes, as git's `buffer_is_binary` decides, and as the editor already
  refused binary files), `git.diff` gives `{ binary: true, original, text }`, each side in base64,
  or null when the file isn't on that side. Otherwise it gives the texts as before. In the app, the
  same Log diff showed in 4 s.
- **Side by Side is IntelliJ's** (`TwosideBinaryDiffViewer`: each side in the file's own editor,
  here the image viewer, with its zoom, chessboard and image line), and is shown first. Each side
  has its name above it: the commits, shortened, or HEAD and "Your version" (that IntelliJ names a
  file as it is so is a claim, from memory). Under them is IntelliJ's status line, "Files contents
  are identical" or "Files contents are different" (`DiffBundle.properties`).
- **Swipe, Onion Skin and Difference are Ido's, from GitHub** (Swipe and Onion Skin by GitHub's
  names for them, a claim from memory). The two images are drawn one over the other from their top
  left, in the larger one's frame, on the chessboard, fitted to the area together as the image
  viewer fits one.
  - Swipe shows the later image right of a line that a slider moves.
  - Onion Skin fades the later image in over the earlier one, by a slider.
  - Difference marks every pixel whose RGBA differs (or that's in one frame alone) in
    `--cerebro-image-diff-changed`, over the later image in grey, faded three quarters of the way
    to `--cerebro-image-diff-unchanged`, and counts them ("3 of 6 pixels changed").
  - An image added or deleted is shown beside "No image", and only side by side.

  Claude's choices, open to change: the modes as buttons above the image, the Difference
  colours (not measured from anything: IntelliJ has no such mode), and the "Compare by" name.
- **Another binary file** shows IntelliJ's status line alone, without its contents.
- **Not yet:** zooming the stacked modes by hand, and keeping the mode chosen between diffs.

## Cherry-Pick (2026-11-11)

The Log's Cherry-Pick, next of its toolbar's "Not yet" (decision "The Git Log"). From IntelliJ's
source: `VcsCherryPickAction`, `GitCherryPickProcess`, `GitApplyChangesProcess`,
`GitCherryPickContinueProcess`, `GitApplyChangesConflictResolver`, `GitDefaultMergeDialogCustomizer`,
`GitAbortOperationAction`, their words from `GitBundle`.

- **Where:** the Log's toolbar, after Refresh (IntelliJ's `Vcs.Log.Toolbar`, between Refresh and
  the presentation settings), on the selected commit, off with none; and the commit menu, after
  Copy Revision Number (IntelliJ's comes after Create Patch, which Cerebro hasn't). No key:
  IntelliJ's keymaps give it none (searched). Off while a pick runs in that worktree, as IntelliJ's
  is while one is started.
- **The pick:** `git cherry-pick <hash>` with no editor (`GIT_EDITOR=true`), so the commit keeps its
  message and author, as IntelliJ's (`preserveCommitMetadata`). With "(cherry picked from commit …)"
  (git's `-x`) when the commit is on a protected branch of a remote, as IntelliJ's default
  ("published", `isAddSuffixToCherryPicksOfPublishedCommits` true); the protected branches are
  Push's (main, master). Recorded in the Local History as Cherry-Pick.
- **How it went** (measured, git 2.43): picked, "Cherry-pick successful" and the commit (its first 8
  characters and subject, as IntelliJ's `commitDetails`). Its changes already here, the pick is
  empty (git stops, CHERRY_PICK_HEAD there, no file unmerged): skipped with `--skip`, as IntelliJ's
  default (`EmptyCherryPickResolutionStrategy.SKIP`), "Nothing to cherry-pick", "All changes from
  … have already been applied". Local changes or untracked files in the way: git starts nothing;
  "Cherry-pick failed" with IntelliJ's "Your local changes will be overwritten by cherry-pick…", or
  "Untracked Files Prevent Cherry-pick". Anything else: "Cherry-pick failed" and git's words.
- **At conflicts:** the Conflicts dialog, saying "Conflicts during cherry-picking commit … made by
  …" and the message; the merge window's sides "Local Changes" and "Changes from cherry-pick …",
  as IntelliJ's. Once none is left, the pick is committed (`--continue`): **Claude's, open to
  change**, as Merge… commits its merge: IntelliJ shows its commit dialog there, with the
  commit's message. Closed with some left: "Cherry-pick was performed with conflicts", with
  Resolve… (no commit after, as IntelliJ's) and Abort Cherry-pick.
- **A cherry-pick under way** is the host's third operation, beside a merge and a rebase (by
  CHERRY_PICK_HEAD). The Git menu shows Continue Cherry-Pick (once no file is in conflict, as
  IntelliJ hides it while Resolve Conflicts… shows) and Abort Cherry-Pick, last in it as IntelliJ's;
  Abort asks first ("Abort cherry-pick?"), as Abort Merge does. Update Project isn't stopped by
  one, only by its unmerged files, as IntelliJ's `isUpdateNotReady`.
- **Revert Commit** (added 2026-11-11), in the commit menu after Reset Current Branch to Here…, as
  IntelliJ's (`GitRevertAction`, `GitRevertProcess`): the same process as the pick, with
  `git revert` and IntelliJ's words for it ("Revert successful", "Nothing to revert", "All changes
  from … have already been reverted", "Revert was performed with conflicts", Abort Revert). Off for
  a merge commit, as IntelliJ's. The message is git's own (`Revert "…"`, "This reverts commit …"),
  with no editor. Measured (git 2.43): an empty revert says "nothing to commit" and leaves no
  REVERT_HEAD, which is how IntelliJ's `isEmptyCommit` tells it; one resolved to nothing at
  `--continue` leaves REVERT_HEAD, and is skipped with `--skip`. The Conflicts dialog says
  "Conflicts during revert of commit … made by …" and the subject, as IntelliJ's revert does;
  its merge window's sides are IntelliJ's defaults. A revert under way is the host's fourth
  operation (REVERT_HEAD); the Git menu then shows Abort Revert ("Abort revert?"), before
  Cherry-Pick's, as IntelliJ's, which has no Continue Revert: the Commit window finishes one.
- **Claims:** the icon (two cherries; not IntelliJ's drawing).
- **Not yet:** several commits at once (the Log selects one; IntelliJ picks them oldest first);
  "Stash
  Changes and Retry" and "Show Files" when local changes are in the way; Abort's notification
  without asking, as IntelliJ's; the Cherry-Pick setting for the suffix and for empty picks;
  Cherry-Pick in a file's history.

## Git → Rebase… (2026-11-11)

The last of the Git menu's actions the decision "Fetch and Pull" left. From IntelliJ's source
(`GitRebaseDialog`, `GitRebaseOption`, `GitRebaseParams`, their words in `GitBundle`, and
`Git.MainMenu`).

- **In the Git menu after Merge…, whatever's under way,** as IntelliJ's (`Git.Rebase` there); off
  only without a host.
- **The dialog, "Rebase":** `git rebase`, then the base (a branch or a hash: local branches, then
  remote ones, then tags, suggested as it's typed), the Merge dialog's field. Modify options (Add
  Rebase Options) at the buttons' left, the options chosen shown under the command, as Merge's.
  The options are IntelliJ's but --interactive: Select another branch to rebase, --onto,
  --rebase-merges, --keep-empty, --root, --update-refs, --autosquash and --no-autosquash (each of
  the last two excludes the other).
- **The fields move, as IntelliJ's:** --onto puts its new base first, the base moved there, and the
  old base under it; another branch's field follows the base, or goes under with it. --root turns
  the base off. Each field is built once and moved, the focus left where it was; the base has the
  focus at first (`getPreferredFocusedComponent`).
- **What's wrong is said under the fields, in IntelliJ's order** (`doValidateAll`) and words: the
  base (Select a new base, or Select an upstream with --onto), the new base, a rebase under way
  (Interactive rebase is already in progress for this Git root), the branch (Select a branch to
  switch to, Branch 'x' does not exist: a local one). A base git doesn't know is asked of git on
  Rebase only (`RevValidator`): There is no such branch or tag, until it's changed. Rebase is off
  while anything is wrong (Cerebro's, open to change: IntelliJ turns it off for the bases' errors
  only, and says the others when clicked).
- **Kept, as IntelliJ's settings:** the options (not --onto and the other branch, which are fields)
  and the base last chosen, per repository; the base only while git still knows it.
- **Then `git rebase --autostash`** with the options, `--onto <new base>`, the base (or `--root`)
  and the branch, as `GitRebaseParams` orders them; `--autostash` as Update Project's rebase. It's
  recorded in Local History. "Rebase successful" says "Rebased <branch> on <base>" (HEAD when
  detached); at conflicts, the Conflicts dialog, then on, as Continue Rebase. A failure is "Rebase
  failed", git's words under it.
- **Not yet:** --interactive (IntelliJ's interactive rebase editor); IntelliJ's checks before
  starting (Rebase is not possible during a merge or a cherry-pick: git's own words say so now);
  several repositories' Git Root field.

## Git → Manage Remotes… (2026-11-11)

The last of the Git menu's actions the decision "Fetch and Pull" left, with Rebase…. From
IntelliJ's source (`GitConfigureRemotesDialog`, `GitDefineRemoteDialog`, `ToolbarDecorator` and
`CommonActionsPanel`, their words in `GitBundle`, and `Git.MainMenu`).

- **In the Git menu, in a group of its own after Uncommitted Changes and Current File,** as
  IntelliJ's (Clone, after it there, isn't in Cerebro).
- **The dialog, "Git Remotes":** a table of Name and URL (a remote's first URL), origin first and
  the rest by name, one selected at a time; Add, Remove and Edit over it, Remove and Edit only with
  one selected; OK alone closes it, as IntelliJ's. The keys are `ToolbarDecorator`'s: Add
  Alt+Insert (⌘N on macOS), Remove Alt+Delete (⌘⌫), Edit Enter or a double-click; Up and Down
  select.
- **Add and Edit ask with Define Remote, Push's** (now shared, taking a starting name and URL, as
  IntelliJ's): Add starts at origin unless there's one, then empty, its name's field focused; Edit
  starts at the remote's own, other remotes' names taken. Edit with nothing changed does nothing,
  even with Fetch remote, as IntelliJ's. A changed one is renamed, then its URL set
  (`git remote rename`, `set-url`), then fetched if asked.
- **Remove asks** "Remove remote x 'url'?" (Remove Remote, Yes or No), then `git remote remove`,
  which drops its remote-tracking branches too (measured in the host's tests).
- **While a change runs, the dialog does nothing else** (changed 2026-11-11): IntelliJ runs each as
  a modal task (Adding Remote…, Changing Remote…, Removing Remote…), and until it's done, and the
  remotes read again, nothing in its dialog can be used. Cerebro's says the task's title under the
  table, its tools off and its keys doing nothing, rather than a window over it (open to change:
  Cerebro's dialogs can all be closed, and a progress window closed while git goes on would leave
  the list as it was). Measured in CI: Remove was pressed on the row of a remote just renamed,
  while the fetch after the rename was still running.
- **A failure** says so in a dialog, IntelliJ's words: "Cannot add remote x 'url' in <worktree>:"
  and git's (Add Remote, Change Remote, Remove Remote); the list is read again either way.
- **Name is as wide as its names, URL the rest,** as IntelliJ's `updateTableWidth`; a long URL is
  cut with an ellipsis (changed 2026-11-11: the table grew to a long URL, and its horizontal
  scrollbar lay over the only row, measured in CI on macOS and Windows). IntelliJ widens the dialog
  to the URLs first; Cerebro's keeps its width (open to change).
- **Add's and Remove's icons** are a plus and a minus drawn for Cerebro, Edit's the pencil (a
  claim: not IntelliJ's drawings).
- **Left out, open to change:** a repository's rows (Cerebro's worktree is one repository);
  the table's height following its rows (IntelliJ's shows up to 8).

## Git → Reset HEAD… (2026-11-11)

The next of the Git menu's actions left by the decision "Fetch and Pull". From IntelliJ's source
(`GitResetHead`, `GitResetDialog`, their words in `GitBundle`, and `Git.MainMenu`).

- **In the Git menu after New Tag…,** as IntelliJ's; no key, as IntelliJ's.
- **The dialog, "Reset Head":** Current Branch, Reset Type (Mixed, the default, Soft and Hard, in
  IntelliJ's order, with its tooltip) and To Commit with Validate (HEAD when empty); Reset. The
  Current Branch row and the commit's field with Validate are New Tag's, shared
  (`git-fields.tsx`).
- **While the commit is the text that failed Validate,** "The specified commit expression did not
  pass validation." and Reset off. Cerebro's, open to change: IntelliJ's `validateFields` sets
  both, then clears them on the next lines (no return after the error), so its Reset stays on and
  no error shows (read from its source, not seen running).
- **Made by** `git reset --<type> [<commit>] --`, IntelliJ's command, recorded in Local History as
  "Git reset" (IntelliJ's activity's name). "Resetting HEAD…" on the status bar while it runs;
  nothing said when it works, and git's words under "Resetting HEAD…" when it fails, as IntelliJ's.
- **Left out, open to change:** the Git Root field (a worktree is one repository here); IntelliJ's
  Validate also opens the commit's changes when it's valid.
- **The Log's Reset Current Branch to Here…** (added 2026-11-11), on a commit's menu, first in
  IntelliJ's Git group: its newer dialog (`GitResetAction`, `GitNewResetDialog`,
  `GitResetOperation`), "Git Reset": "{branch} -> {short hash} "{subject}" by {author}" (subject
  and author cut to 40 characters, the last three "...", as IntelliJ's `shortenTextWithEllipsis`
  (corrected 2026-11-12: it was 39 and an ellipsis character); HEAD with its short hash when
  detached, HEAD alone when that commit isn't loaded), IntelliJ's description, then Soft, Mixed,
  Hard and Keep, each with its comment; Reset. `git reset --<mode> <hash> --`, recorded as "Git
  reset"; "Git Reset" on the status bar while it runs; "Reset successful", or "Reset failed" with
  git's words. The mode chosen is kept for next time, per repository, in the page's storage
  (Cerebro's, open to change: IntelliJ keeps it in its project settings); Mixed to start with.
  - **Claims:** the short hash's 8 characters; the comments' layout.
  - **Not yet:** IntelliJ's smart reset (when local changes would be overwritten, it offers to
    stash or shelve them first; here git refuses, and says why); the radio buttons' mnemonics
    (Cerebro's dialogs have none yet).
- **The Log's Undo Commit…** (added 2026-11-11), in the commit menu after Revert Commit, as
  IntelliJ's Git group (`GitUncommitAction`, `GitSingleCommitEditingAction`,
  `GitCommitEditingActionBase`, `GitProtectedBranches.kt`, read from its source). It's for HEAD's
  commit alone, and not for a merge's (IntelliJ's `checkNotMergeCommit`). `git reset --soft` to the
  commit's first parent, recorded as "Git undo commit" (IntelliJ's activity's name), "Undoing Last
  Commit…" on the status bar while it runs, then "Undo commit successful", or "Undo commit failed"
  with why. The commit's message goes into the Commit window, to commit the changes again, as
  IntelliJ's. Not when a protected branch on a remote has the commit (`main` or `master`, as Push's
  and Cherry-Pick's, matched by its name there): "Cannot Undo Commit", "The commit is already pushed
  to protected branch 'origin/main'", and nothing done. The host checks HEAD is still the commit
  first, as a Log read earlier may be out of date. Cerebro has no changelists, so there's no "Select
  Target Changelist" dialog, as IntelliJ's without them; the ellipsis stays, as IntelliJ's text.
  **Claude's, open to change:** off for the first commit, which has no parent to go back to (IntelliJ
  asks "Are you sure you want to edit the initial commit?", then takes the parent it hasn't: read
  from its source, not seen running).
- **The Log's Edit Commit Message…** (added 2026-11-13), in the commit menu after Undo Commit, as
  IntelliJ's (`GitRewordAction`, `GitCommitEditingActionBase`, `GitSingleCommitEditingAction`,
  `GitNewCommitMessageActionDialog`, `GitRewordService`, `GitInMemoryRewordOperation`,
  `GitObjectRepository`, `GitCommitMessageFormatter`, read from its source). Off for a merge but at
  HEAD (IntelliJ amends a merge there). Before the dialog the host checks, and "Could not Edit
  Commit Message" says why not, in IntelliJ's words: "The commit is not in the current branch",
  "The commit is already pushed to protected branch 'origin/main'" (Undo Commit's protected
  branches), "Cannot reword during merge" (or rebase, cherry-pick, revert; a rebase allows HEAD's
  commit). The first commit is asked about ("Editing Initial Commit", Continue). The dialog, "Edit
  Commit Message": "Edit message for commit {short hash} by {author}", the message to edit, the
  caret at its start, OK off while it's blank. "Rewording…" on the status bar while it runs, then
  "Commit message changed", or "Failed to reword" with why.
  - **Made as IntelliJ's in-memory reword,** which it tries first: the commit made again with the
    message (`git commit-tree`, its tree, parents and author kept, the committer now), each later
    commit made again on it as it was, then HEAD moved to the last (`git update-ref`, given the
    HEAD checked before the dialog: if HEAD has moved since, "HEAD moved during the commit editing
    operation" and nothing changed). The working tree and the index aren't touched, so nothing is
    recorded in Local History. The message is cleaned up as `git commit` would by `commit.cleanup`
    (`git stripspace`), as IntelliJ's formatter does, since `commit-tree` doesn't.
  - **Cerebro's, open to change:** where a merge lies between the commit and HEAD, IntelliJ falls
    back on an interactive rebase; Cerebro says "Commit {hash} has 2 parents" (IntelliJ's in-memory
    words) and changes nothing. The reflog says "reword {hash} by Cerebro" (IntelliJ's "… by
    {product} Git plugin").
  - **Not yet:** the notification's Undo, and Edit Again for HEAD's commit; IntelliJ's notes copied
    and `post-rewrite` hook run for the commits made again; signing them (`--gpg-sign`) when
    `commit.gpgSign` is set; the Commit window's message replaced where it was the old one.

## Git → New Tag… (2026-11-11)

The next of the Git menu's actions left by the decision "Fetch and Pull". From IntelliJ's source
(`GitTag`, `GitTagDialog`, `GitReferenceValidator`, their words in `GitBundle`, and `Git.MainMenu`).

- **In the Git menu after New Branch…,** as IntelliJ's; also in Find Action. No key, as IntelliJ's
  keymaps give it none (its action has no shortcut, and no keymap file names it: searched).
- **The dialog, "Tag":** Current Branch (`<no active branch>` when HEAD is detached), Tag Name,
  Force, Commit with Validate, and Message, in IntelliJ's rows and with its tooltips; Create Tag.
  The worktree's tags are read before it opens, as IntelliJ's reads them first ("Getting Existing
  Tags…" says why when that fails, and no dialog opens).
  - **Force** is enabled only while the name is a tag's that exists, and goes off when it isn't;
    without it, "The tag with the same name exists." and Create Tag disabled.
  - **Validate** asks git whether the commit names something (`git rev-parse --verify`); while the
    text is the one that failed, "The commit or object name is invalid." Empty, it's HEAD.
  - **Message:** when it has more than spaces, the tag is annotated, with the message as typed.
- **Made by** `git tag [-a] [-f] [-F -] -- <name> [<commit>]`: IntelliJ's command, the message on
  standard input where IntelliJ writes it to a file (the same message, without the file; `--`
  added so a name that starts with "-" is taken as a name and refused by git, measured in the
  host's tests). "Created tag x successfully.", or "Could not create tag" with git's words.
- **Left out, open to change:** the Git Root field (a worktree is one repository here); IntelliJ's
  Validate also opens the commit's changes when it's valid, which Cerebro doesn't yet.
  (The Current Branch row and the commit's field are shared with Reset HEAD… since 2026-11-11.)
- **New Tag… from the Log's commit menu** (added 2026-11-11), as IntelliJ's `GitCreateTagAction`:
  its input dialog, "Create New Tag On {the full hash}" and "Enter the name of new tag", OK only
  while the name has no spaces (nothing said, as IntelliJ's validator says nothing); then `git tag
  -- <name> <hash>`, through the same request as the dialog's. Nothing said when it's made (IntelliJ
  says nothing either); "Could not create tag {name}" with git's words when it isn't. The Log is
  read again after either.

## Windows keep their size and place (2026-11-11)

From the backlog's Polish list (and the diff viewer's Not yet): windows open as they were left, as
IntelliJ's.

- **A project's window opens as it was left,** its place, its size, maximized or full screen, as
  IntelliJ's frames (`ProjectFrameBounds`, which keeps a `FrameInfo` of bounds, extended state and
  full screen per project; IntelliJ's source). A window of several projects is kept as its first.
  The Welcome window isn't kept: it has one size.
- **A diff window opens as its project's was left,** as IntelliJ's (`DiffWindowBase` gives its
  window the dimension service key "DiffContextDialog", kept per project by `WindowStateService`;
  IntelliJ's source). The first time, 1100 by 750.
- **For the screens there are:** what's kept is kept for the layout of screens it was left on (each
  screen's bounds are part of its key, as `WindowStateServiceImpl.getAbsoluteKey`'s), and isn't used
  if none of it would be on a screen's work area (as IntelliJ's `isVisible`). A window left on a
  second screen opens on it again when that screen is there, and as it was on one screen when not.
- **Kept as it closes,** in `windows.json` in the app's data folder. Its normal bounds are kept
  (Electron's `getNormalBounds`), so a maximized window comes back maximized and goes back to its
  size when restored. Maximized or full screen is put back as it shows, which shows it.
- **Measured** under WSLg: a project window moved to 120,80 at 1000 by 700 opened there after a
  restart, and maximized after it was left maximized.
- **Rejected:** keeping only the diff window's size, a special case of what every window should do.

## The diff viewer, as IntelliJ's (2026-11-11)

Ido: "I'd expected the same git diff functionality and behaviour as intellij. new window instead of
as a tab, allow collapsing of irrelevant rows, sync scroll toggle - the entire menu that intellij
offers on webstorm". This is the first part: the viewer itself. Measured from IntelliJ's source
(`SimpleDiffViewer`, `TwosideTextDiffViewer`, `SyncScrollSupport`, `FoldingModelSupport`,
`TextDiffSettingsHolder`, `DiffDrawUtil`, `TextDiffTypeFactory`, `DiffBundle`, the keymaps).

- **Two editors and a divider,** as IntelliJ's side-by-side viewer, not CodeMirror's merge view:
  each side scrolls by itself, so scrolling can be synchronized or not. CodeMirror's merge view is
  one scroll area, with no way to scroll the sides apart. Between them, a divider joins each change
  on the left to its place on the right with curves in its colour, and each folded band to the
  other side's, as IntelliJ's.
- **IntelliJ's colours by kind** (`TextDiffType`): inserted, deleted and modified, the merge
  window's colours (the tokens are shared now, `--cerebro-diff-*`, as IntelliJ uses the same ones).
  A modified change's lines take its colour mixed 40% into the text's background, and its changed
  text the full colour, as IntelliJ's "ignored" colour (`MIDDLE_COLOR_FACTOR` 0.6); an inserted or
  deleted one is in the full colour. Each change's line numbers too, as IntelliJ paints the whole
  gutter. Where a change has no lines on a side, a line in its colour where they would be.
- **Synchronize Scrolling,** on to start with, as IntelliJ's: scrolling one side scrolls the other
  so the line a third of the way down is carried across the changes (`transferLine`) to the same
  height, in the same phase within its line (`SyncScrollSupport.syncVerticalScroll`); horizontally,
  to the same place. Turned back on, the other side catches up at once. In the Settings gear's menu
  (its `SetEditorSettingsActionGroup`).
- **Align Changes Highlighting,** off to start with, as IntelliJ's
  (`ENABLE_ALIGNING_CHANGES_MODE`), first in the gear, before Synchronize Scrolling, in the
  side-by-side viewer alone (`addTwoSideSettingsActions`). On, each change is as high on both
  sides, as IntelliJ's `AlignedDiffModel`: room below it on the side whose change is shorter, and
  above it where the lines above made one side taller (wrapped lines, or a blank line not a
  difference), measured from where the lines would be without the room. The room takes the
  change's colour at 200 of 255 where its lines are missing on a side, none for a modified change's
  (`getAlignedChangeColor`). With the sides lined up, Synchronize Scrolling scrolls them to the
  same height (Claude's choice, open to change). Kept between sessions, as the toggles are.
- **Collapse Unchanged Fragments,** a toggle on the toolbar: unchanged lines more than 4 from a
  change (`CONTEXT_RANGE` 4) fold into a band in IntelliJ's `DIFF_SEPARATORS_BACKGROUND`; at least 2
  lines, or none; the text's ends fold to its edges. A click on a band shows 4 more lines each side,
  then 8 more, then all, as IntelliJ's nested folds (`getRangeShift`). Toggled, every fold is set
  again. On to start with: IntelliJ's default for diffs from the Commit window, the Log and a file's
  history, where Cerebro's are; elsewhere it starts expanded (Claude's choice that one default fits
  every diff here, open to change). Both toggles are kept between sessions, for every diff.
  - The lines of context are IntelliJ's setting, Settings → Tools → Diff & Merge → Context lines
    (2026-11-11): 1, 2, 4 (its default) or 8, a band's clicks showing as many again, then twice
    that; or Disable, which folds nothing, the toggle disabled. A list where IntelliJ has a slider
    (Claude's choice, open to change: the settings pages have no slider).
- **Previous and Next Difference** (Shift+F7 and F7; Visual Studio's F8 too, Eclipse's Ctrl+F7,
  macOS System's Cmd+[ and Cmd+], as IntelliJ's keymaps give them), on the toolbar too: the caret
  to the change before or after it on the side last focused, in the middle of the view; disabled
  with none to go to. A diff opens with the caret at its first change, scrolled to it, as IntelliJ's.
  macOS System's Cmd+[ is Back elsewhere: a diff's keys come first, and run only in a diff.
- **Ignore Differences and Highlighting Differences,** in the gear under their headings, each a
  choice of one, as IntelliJ's (`IgnorePolicy`, `HighlightPolicy`; its labels, `DiffBundle`):
  - Ignore: None (the default), Trim whitespaces (lines equal but for white space at their ends),
    Ignore whitespaces (anywhere), Ignore whitespaces and empty lines (blank lines alone aren't a
    change either). In a changed line, a change of white space alone isn't marked, or with
    trimming, only one at a line's end.
  - Highlighting: Lines, Words (the default), Split changes (a block split where its changed text
    is a line or more apart, as `LineFragmentSplitter`), Characters, None (no changes shown).
  - Compared as IntelliJ's `ComparisonManagerImpl`: by lines first, equal under the ignore policy,
    then each changed block's text. CodeMirror's `diff` does the comparing, lines and words each
    encoded as one character, so it finds the fewest changes of whole lines, then whole words.
    Words are IntelliJ's `ByWord` tokens: runs of letters, digits and `_`; runs of white space;
    each other character. That they give IntelliJ's results on every text is a claim: its own
    algorithm (`ByWord`'s inner-fragment matching) isn't reproduced.
  - Kept between sessions with the toggles; a diff open is compared again as they change.
- **The unified viewer,** IntelliJ's other (`UnifiedDiffViewer`), chosen on the toolbar as its
  chooser's two buttons, "Side-by-side viewer" and "Unified viewer", and kept with the settings:
  - one editor, built as IntelliJ's `UnifiedFragmentBuilder`: unchanged lines are the right's,
    and each change's left lines come above its right ones;
  - removed lines in the deleted colour and added ones in the inserted colour, whatever the
    change's kind; their changed text in the full colour (`createUnifiedChunkHighlighters`);
  - two columns of line numbers, the left's and the right's, with none where a line isn't on
    that side;
  - Collapse Unchanged Fragments, the policies, and Previous and Next Difference work as on the
    side-by-side viewer. No Synchronize Scrolling, with one editor;
  - Jump to Source from a removed line goes to where its change is in the file.
  - A file as it is is edited on the right's lines, as IntelliJ's (its unified viewer edits its
    master side): not its removed lines, nor the line breaks around them (an edit touching one is
    refused). Compared again after each edit, the editor takes only what changed, and the caret
    stays on its line of the right.
  - The chooser's icons are drawn for Cerebro (a claim: not IntelliJ's drawings), as is the
    border around the two (IntelliJ's is a segmented button).
- **Appearance,** last in the gear under its heading, as IntelliJ's (`SetEditorSettingsActionGroup`,
  its actions' names): Show Whitespaces, Show Line Numbers, Show Indent Guides, Soft-Wrap, kept
  with the other settings. Line numbers alone on to start with, IntelliJ's defaults
  (`TextDiffSettingsHolder`). Whitespace and indent guides in its colours (`WHITESPACES` and
  `INDENT_GUIDE`, IslandSchemeDark.xml; the light scheme's and Default's). The guides are drawn
  every tab size apart, from the line's start, on through blank lines, over a change's colour and
  on a wrapped line's first row alone: IntelliJ's follow the language's indent and its blocks, so
  that they match is a claim. Its highlighting level and breadcrumbs, off in IntelliJ unless
  turned on elsewhere, aren't there.
- **The toolbar** is IntelliJ's left to right: the arrows and Collapse Unchanged Fragments, then
  at the end the viewer's chooser and the gear. In the diff window and Local History; the file
  cache conflict's diff has none, as it's a merge.
- **A diff opens in a window of its own** in the app, as IntelliJ's (Ido: "new window instead of
  as a tab"): from the Commit window (Ctrl+D), Agent Changes, the Shelf, the Log and Show Diff on
  an annotation. The window has the main toolbar's look with the file's name as its title (and
  the two commits, for a diff between them), the diff's toolbar and the keymap chosen in Settings.
  - It reads through its opener's hosts: the app routes its requests to the project window's
    (`Hosts.share`), so it asks as that window would. It closes with that window.
  - Jump to Source (F4) goes back to the project window, which comes to the front, the file open
    where the caret was, if it still exists.
  - The same diff opened again brings its window to the front; another file's opens another
    window (Claude's choice, open to change; that IntelliJ opens a new one each time is a claim).
  - With the focus back, it reads the diff again, and shows it again only if it changed, so the
    caret stays where it was. A tab was read again as it showed.
  - Escape closes it (added 2026-11-12, Ido: "a sub window such as the diff window, pressing esc
    on the keyboard should close it"), as IntelliJ's diff window, a dialog, closes; not when
    something in it takes the key first (a popup, a shortcut, the editor). Dialogs already closed on
    Escape, from their editors too (measured: the merge window, its Result focused).
  - 1100 by 750 the first time (a claim: not measured from IntelliJ); after, as its project's was
    left (decision "Windows keep their size and place").
  - Local History's diff stays in its own dialog, as IntelliJ's; a browser, with no windows to
    open, still shows diffs as tabs.
- **Show Diff in Editor Tab and Show Diff in Separate Window,** in the gear after Synchronize
  Scrolling, each where the diff isn't, as IntelliJ's (`MoveDiffEditorAction`, in the
  `Diff.DiffModes` group that `SetEditorSettingsActionGroup` puts after the viewer's settings;
  IntelliJ's source). Chosen, diffs open there from then on, and it's kept: the diff a window
  shows (the file shown, not its list: a tab shows one file) opens as a tab of its project's
  window, in front, and the window closes; a tab's closes and opens in a window. Every diff open
  moves with it, as IntelliJ's (`reopenDiffEditorsForFiles`, 2026-11-11): the project window's
  other diff windows, and all its diff tabs, the one it's chosen in last, so it ends in front. Not in Local
  History's diff, which stays in its dialog, nor in a browser, with no windows. Kept as the diff's
  other toggles, and read as kept each time, so a choice made in a diff window holds in the
  project's window.
- **The diff window goes through the list it was opened from,** as IntelliJ's diff chain
  (`ChangesListViewDiffableSelectionUtil`, `DiffRequestProcessor.getNavigationActions`):
  - The list: a Commit window file's group (its changelist, or the unversioned files) or an agent
    turn's, in the tree's order; a shelved list's or a stash's files; a Log commit's files. Show
    Diff on an annotation opens one file. One file alone shows none of what follows.
  - After Next Difference, in IntelliJ's order: Jump to Source (its OpenInEditorAction, which is
    EditSource's), Compare Previous File, the file's place in the list ("2/5"), and Compare Next
    File. The place opens Go to Changed File: the list's files by name and folder, filtered as
    typed, the one shown chosen.
  - Compare Previous and Next File stop at the list's ends (that IntelliJ's do too is a claim).
    Their keys are IntelliJ's for Diff.PrevChange and Diff.NextChange, from its keymap files:
    Alt+Shift+Left and Right (`$default`, Emacs; VS Code takes them, as it names none); Ctrl+Shift
    on macOS (Mac OS X 10.5+ and Mac OS X); Eclipse's Ctrl+Alt+Shift+Right for Previous and Left
    for Next, as its file has them; NetBeans' Ctrl+Alt+Page Up and Down; none in Eclipse (macOS)
    and Sublime Text.
  - The icons are drawn here (a pencil and two arrows, a claim: not IntelliJ's drawings).
  - Past a file's last difference, Next Difference (F7) says "Press again to go to the next file",
    and pressed again shows the next file at its first change; Previous Difference the same way
    back, to the previous file's last change. Going to a difference, or another file shown,
    forgets the first press; any key or scrolling hides the hint. As IntelliJ's, its Go to next
    file setting on, its default (`DiffDifferenceNavigationAction`, `DiffRequestProcessor`'s
    DiffNavigator, `DiffSettingsHolder`). The setting is IntelliJ's, in Settings → Tools → Diff &
    Merge, "Go to the next file after reaching last change", on by default (2026-11-11); off,
    Next Difference stops at the last change, and Compare Next File still goes on. The hint is centred
    40px from the diff's end the way it goes, bold, in a tooltip's colours (IntelliJ puts it by the
    change, in its information hint's colours: a simplification, open to change).
  - The diff takes the keyboard as a file shows, as IntelliJ's window gives it to its editor, and
    in the window the diff's keys act on its diff wherever the keyboard is (Jump to Source from
    the caret of the side last focused).
- **Merging into the right side** (the file cache conflict) keeps its arrow by each change, now in
  the divider, as IntelliJ's; the sides are diffed again as it's edited.
- **A diff of a file as it is edits its document** (2026-11-11), as IntelliJ's diff of local
  changes edits the file's one document: its right side is the file's text with its unsaved
  edits, edited there, in either viewer, and saved as the file's tab is (the arrows by each change
  take the left's, as in the file cache conflict).
  - In a diff window, the document is its project window's: the window asks for it and edits it
    there through the app, which tells the project window's diff windows its text as it changes.
    Its own edits, told back, aren't news; a text told while one of its edits is on its way isn't
    shown, as the edit will replace it.
  - Changed elsewhere (in the file's tab), the diff shows it, made again: the caret goes back to
    its first change (Claude's choice, open to change: keeping it is a refinement).
  - A file that can't be read (deleted) shows git's text, and isn't edited; nor is a diff between
    commits.
- **Not yet:** the rest of Settings → Tools → Diff & Merge (the merge's options, and whether
  diffs go in the navigation history);
  several files
  selected as the list; a fold's description (IntelliJ's breadcrumbs of where it is); the gear's
  highlighting level and breadcrumbs; Ignore formatting and
  language-specific changes (they need the language's formatter and parser).

## Git → Merge… (2026-11-10)

Ido's "all of the above", the Git menu's rest: Merge…, stacked on Fetch and Pull, whose dialog's
parts it shares. From IntelliJ's source (`GitMerge`, `GitMergeDialog`, `GitMergeOption`,
`GitMergeAction`, their words in `GitBundle`).

- **In the Git menu** first in its second group, before Commit Merge and Abort Merge. Hidden while a
  merge is under way, off during a rebase, as IntelliJ's `GitMerge.update`.
- **The dialog,** "Merge into main" ("Merge Changes" when detached): `git merge` and the branch, its
  local branches then its remote ones suggested as it's typed, each in IntelliJ's natural order (no
  remote's HEAD). It starts at the branch merged last in the repository, else the upstream, else the
  first. Its errors in IntelliJ's words: "The merge branch should be selected.", "There is no
  matching branch.", and "Branch 'x' is already merged" once the host says which aren't (`git branch
  --all --no-merged`, read alongside, as IntelliJ reads them in the background).
- **Modify options:** Add Merge Options, IntelliJ's `GitMergeOption`: --no-ff, --ff-only, --squash,
  -m, --no-commit, --no-verify, --allow-unrelated-histories, those that can't go with the ones
  chosen greyed. With -m, "Commit message:" and its field under the options; the message goes with
  -m only when one's written, as IntelliJ's. The branch and the options are kept per repository.
- **Then as Pull:** IntelliJ's `GitMergeAction` for both, shared: how it went, its failures in its
  words with Merge's name ("Git Merge Failed", "Your local changes will be overwritten by merge.",
  "Untracked Files Prevent Merge", "Git Merge failed"); at conflicts, the Conflicts dialog, then the
  merge committed, unless --no-commit. Recorded in Local History as "Merge x".
- **Shared with Pull** (`git-options.tsx`, `merge-action.tsx`): the branch field and its
  suggestions, the options' popup, chips and keeping, and what comes after git. The popup's width is
  each dialog's, to fit its longest row (Cerebro's: IntelliJ's popup sizes to its content).
- **Not yet:** the repository field (one repository per worktree here); --no-verify shown only when
  git supports it (Cerebro assumes it does).

## Fetch and Pull (2026-11-10)

Ido's "all of the above", its first part: the Git menu's rest, here Fetch, Pull…, Branches… and New
Branch…. From IntelliJ's source (`GitFetch`, `GitFetchSupportImpl`, `GitPull`, `GitPullDialog`,
`GitPullOption`, `GitMergeAction`, `GitOptionsPopupBuilder`, its `Git.MainMenu` and keymaps).

- **The Git menu, in IntelliJ's order:** Commit…, Push…, Update Project…, Pull…, Fetch | the merge
  and rebase actions, Resolve Conflicts… | Branches…, New Branch…, New Tag…, Reset HEAD… (added
  2026-11-11: their decisions) | Current File, Uncommitted Changes | Manage Remotes… (added
  2026-11-11).
- **Fetch:** every remote, `git fetch --prune`, as IntelliJ's `fetchAllRemotes`; a remote that fails
  doesn't stop the others. "Fetch successful", with the remote branches pruned; or "Fetch failed"
  with git's words, each remote named when several failed. "Fetching…" on the status bar while it
  runs, and Fetch disabled. Disabled too while the repository has no remote, as IntelliJ's
  (`GitFetch.hasRemotes`; added 2026-11-11): the host's repository state says whether it has any
  (`git remote`), read with the rest of it every 2 s; enabled until first read.
- **Pull…:** IntelliJ's dialog, "Pull to main": `git pull`, the remote, and the branch there, its
  branches suggested as it's typed. To start with, the upstream's; without one, origin (else the
  first remote) and its branch of the same name. Its errors in its words: "Select the remote to pull
  from", "The branch to pull from should be selected.", "There is no matching branch.".
  - **Modify options:** IntelliJ's Add Pull Options popup: --rebase, --ff-only, --no-ff, --squash,
    --no-commit, --no-verify, each with its description; those that can't go with the ones chosen
    greyed, as `GitPullOption` excludes them; the popup stays open as they're toggled. The options
    chosen show under the row, each removable, and are kept per repository, as IntelliJ keeps them
    per project (in the page's storage: Cerebro's choice, open to change).
  - **Merged:** `git pull --no-rebase --no-stat [options] -v remote branch`. `--no-rebase` is
    Cerebro's: git 2.27 on refuses to pull divergent branches until told how (measured in the host's
    tests). "N files updated in M commits", or "All files are up to date" with nothing brought, as
    `GitMergeAction`; with View commits once the merge is committed (below), as its. Failures in IntelliJ's words: "Git Pull Failed" for local changes in the way
    ("Your local changes will be overwritten by pull. Commit, stash, or revert them to proceed."),
    "Untracked Files Prevent Pull", else "Git Pull failed" with git's words. "Pulling changes from
    origin" on the status bar while it runs.
  - **Fetching from the dialog** (added 2026-11-11), as IntelliJ's `performFetch`: in the branch
    field, Ctrl+F5 (Cmd+R on macOS) fetches the remote chosen alone, then its branches are
    suggested again; the suggestions hide first, and under them "Press Ctrl+F5 to update branches".
    "Fetching…" while it runs, and the key does nothing then. Without a remote, "Cannot load remote
    branches" / "Select a local and a remote repository". What git says isn't shown, as IntelliJ's
    isn't. The key is IntelliJ's Refresh's in its keymaps (and its own fallback); that it doesn't
    follow a rebinding is Cerebro's, open to change: Cerebro has no Refresh action of its own.
  - **--rebase:** through Update Project, rebasing on the branch chosen instead of the upstream, as
    IntelliJ's `GitPull` runs its update; recorded in Local History as Pull.
  - **At conflicts:** the Conflicts dialog, then the merge committed with git's message, unless
    --no-commit; closed with some left, "There are pending unresolved conflicts." with Resolve….
- **Branches… and New Branch…:** the branches popup (decision "Branches") and its Create New Branch
  dialog, from the Git menu. Their keys are IntelliJ's: Ctrl+Shift+` for Branches… (none on macOS,
  where IntelliJ removes it) and Ctrl+Alt+N for New Branch… (Meta+Alt+N on macOS); no other keymap
  names either (measured: IntelliJ's keymap files). From the menu or its key, the popup opens at the
  window's top, as Search Everywhere does (a claim that it's close enough: IntelliJ centres it in the
  window).
- **Not yet:** for Merge…, New Tag…, Reset HEAD…, Manage Remotes… and Rebase…, see their
  decisions.

## Branches (2026-11-10)

Git → Branches… and Git → New Branch… open it too (changed 2026-11-10: decision "Fetch and
Pull").

Ido's "all of the above", for branch operations: IntelliJ's branches popup, from the toolbar's
branch selector, with "New Branch, Checkout, Merge into Current, Rebase Current onto Selected,
Rename and Delete, each branch with its submenu". From IntelliJ's source (`GitBranchesTreePopup`,
the `Git.Branch` actions, `GitNewBranchDialog`, `GitBrancher`'s operations and their words in
`GitBundle`).

- **The popup:** a search field, New Branch…, then the active worktree's branches as git lists
  them, under Local and Remote; the current one checked, one checked out in another worktree with
  that worktree's name. A branch's row has an arrow: choosing it (a click, Enter, or Right at the
  end of the field) opens its menu beside the row. Escape or Left in the menu goes back to the
  list; an action chosen closes both, as IntelliJ's.
  - The picker (`ui-popup`) takes a submenu per item; a menu (`ui-menu`) says how it closed
    (chosen, cancelled, dismissed), so the popup stays or goes with it.
- **A branch's actions, those that apply only** (IntelliJ hides the rest), in its order: Checkout,
  Open Worktree, New Branch from 'x'…, | Rebase 'current' onto 'x', Merge 'x' into 'current', |
  Rename…, Delete.
  - **Checkout:** not the current branch. A remote one is checked out as a local branch tracking
    it (`git checkout --track`). "Checked out x", or "Could not checkout x" with git's words.
    Where its local branch exists (changed 2026-11-12; before, git's "already exists"), as
    IntelliJ's (`GitRemoteBranchCheckoutUtil`, `GitBranchCheckoutOperation`, read from their
    source): one tracking another branch isn't taken over: the New Branch dialog, "Checkout
    origin/x", asks for a name. Otherwise the local branch is moved to the remote one and checked
    out (`git checkout -B x origin/x`); when it has commits the remote one hasn't (`git rev-list
    --count`), IntelliJ's question first: "Local branch 'x' has commits that do not exist in
    'origin/x'. Rebase 'x' onto 'origin/x', or drop local commits?", with Rebase onto Remote (`git
    rebase origin/x x`, conflicts as Rebase's, "Rebase successful" as Checkout and Rebase's,
    open to change), Drop Local Commits, and Cancel.
  - **Open Worktree:** a branch checked out in another worktree (git won't check it out twice)
    opens or shows that worktree's environment instead of checking out (Ido's choice).
  - **New Branch… and New Branch from 'x'…:** IntelliJ's Create New Branch dialog: Branch Name,
    Checkout branch (on), Overwrite existing branch (enabled when the name is a local branch's).
    Its errors, as it words them: "HEAD is a reserved keyword", "Branch name x is not valid" (git's
    `check-ref-format` rules), "… conflicts with remote branch with the same name", "… already
    exists. Change the name or overwrite existing branch".
  - **Rebase 'current' onto 'x':** not with HEAD detached (IntelliJ's). Local changes are put
    aside and back with `--autostash` (Cerebro's choice, open to change: IntelliJ saves them as
    Update Project does). "Rebase successful"; at conflicts, Continue Rebase's way: the Conflicts
    dialog, then on.
  - **Merge 'x' into 'current':** "Merged x to current", with Delete x for a local branch (IntelliJ
    proposes it), or "Already up to date". At conflicts, the Conflicts dialog, and the merge
    committed with git's message once none is left; closed with some, "x Merged with Conflicts".
  - **Rename…:** a local branch; the dialog titled "Rename Branch x", a name taken refused, its own
    included (Cerebro's, open to change: whether IntelliJ allows it wasn't checked).
  - **Delete:** a local branch, not the current one; `git branch -d`, then `-D` when it isn't fully
    merged, as IntelliJ deletes. "Deleted Branch: x" ("Unmerged commits were discarded" if so),
    with Restore, which puts it back where it was; and Delete Tracked Branch when the remote branch
    it tracked is there, no other local branch tracks it, and it isn't protected (main or master,
    as Push's), as IntelliJ's `GitDeleteBranchOperation` (added 2026-11-11).
  - **Delete, of a remote branch** (added 2026-11-11), as IntelliJ's
    `GitDeleteRemoteBranchOperation` and `confirmRemoteBranchDeletion`: asked first, "Delete Remote
    Branch", "Delete remote branch origin/x?", Delete or Cancel; with "Delete tracking local branch
    y as well" (or "Delete tracking local branches: y, z"), off to start with, when local branches
    other than the current one track it. Then a push of nothing to it (`git push origin
    :refs/heads/x`, the remote commands' git); a server that says the branch isn't there ("remote
    ref does not exist", the words IntelliJ looks for) has the remote's branches pruned instead
    (git's own warns and deletes it here: measured). "Deleted remote branch origin/x", with "Also
    deleted local branch: y" when they went too; "Failed to delete remote branch origin/x" with git's
    words. No icon in the question (IntelliJ's has its question icon; open to change).
  - **Checkout Tag or Revision…** (added 2026-11-11), after New Branch… in the popup, as IntelliJ's
    `Git.Branches.List` (`GitCheckoutFromInputAction`, `GitRefDialog`): the dialog "Checkout",
    "Enter reference (branch, tag) name or commit hash:", the local and remote branches and the
    tags that hold what's typed suggested (the tags read as it opens); OK checks it out with HEAD
    detached, a branch's name too (`git checkout --detach ref`; IntelliJ's `ref^0`, for gits before
    `--detach`), "Checked out ref", or "Could not checkout ref" with git's words. OK is off while
    the field is empty (Claude's: IntelliJ's leaves it to git). A reference starting with "-" is
    refused, git taking it for an option (checkout doesn't take `--end-of-options`: measured, git
    2.43).
  - **Before the first commit** (added 2026-11-13), New Branch… and Checkout Tag or Revision… are
    greyed in the popup, and off in the Git menu and Find Action, as IntelliJ's
    (`DvcsUtil.disableActionIfAnyRepositoryIsFresh`, read from its source): there's no commit to
    start a branch at or to check out. Choosing one greyed does nothing. Where HEAD can't be read,
    they stay on, and git says why if they fail. Recent is empty then without an error: git can't
    read the reflog of a branch with no commit (measured, git 2.43: "your current branch 'main'
    does not have any commits yet"), which was logged as an error each time the popup opened.
    **Not yet:** IntelliJ's description saying why ("Creating new branch is not possible before
    the first commit."), which Cerebro's popups have nowhere to show.
  - **Its settings** (added 2026-11-13): a gear at the search field's end, as IntelliJ's
    (`Git.Branches.Popup.Settings`, read from its source: `AllIcons.General.Settings` in the new
    UI), opens a menu below it with Show Actions in Search Results, then Show Recent Branches and
    Show Tags, checked while on, all on by default (IntelliJ's words and order). With actions off,
    New Branch… and Checkout Tag or Revision… don't show among what's typed, and show again once
    the field is empty; with Recent off, the recent branches are listed under Local. Show Tags is
    the Log's branches pane's own setting, one for both as IntelliJ's (`GitVcsSettings`); turning
    it on with the popup open reads the tags again. The settings are kept with the pane's. The
    popup stays open while its menu is used: a click in a menu opened from it isn't outside it.
    The search field keeps the focus, so typing goes on there once the menu closes.
    **Not yet:** Group by Directory and Restore Popup Size from the same menu, and the filters that
    apply with more than one repository.
  - **Tags** (added 2026-11-12), a Tags group after Remote, as IntelliJ's (`GitBranchesTreeModel`),
    while the Log's branches pane's Show Tags is on (IntelliJ's one setting for both); where they
    can't be read, the branches show without them. Favorites as the branches' (decision "Branches
    in the Log", Favorites in the branches popup). A tag's menu, as IntelliJ's
    (`GitBranchesTreeActionsForSelectionTest`'s tag actions): Checkout (HEAD detached at it, as
    Checkout Tag or Revision…), Merge into Current (no deletion proposed after), and Delete (as the
    pane's: unasked, with Restore and Delete on Remote). A row that's neither checked out nor a
    favorite has a branch's icon, or a tag's, as IntelliJ's (`GitBranchesTreeIconProvider`: its
    `BranchNode` and `BranchLabel`; the drawings are the Log's branches pane's), which the muted
    star takes the place of on the row highlighted; before, such a row had no icon. **Push to**
    (added 2026-11-12), one per remote ("Push to origin"), after Merge, as IntelliJ's
    (`GitPushTagsActionGroup`, `GitPushTagAction`, read from their source): the tag alone, `git push
    origin refs/tags/v1:refs/tags/v1`, asking for a login as a push does, "Pushing…" meanwhile and
    off while a push runs. How it went in IntelliJ's push words: "Pushed tag v1 to origin",
    "Everything is up to date" (the remote has it there already), "Push rejected" with "Push to
    origin was rejected" (it has it elsewhere: git's "already exists"), or "Push failed" with git's
    words. The remotes are read with the branches; where they can't be, there's no Push to.
    **Not yet:** IntelliJ's submenu from six remotes on; tags grouped by directory (the popup groups
    nothing yet).
  - **Checkout and Rebase onto Current** (added 2026-11-12), after New Branch from, as IntelliJ's
    (`GitCheckoutWithRebaseAction`, read from its source; its words "Checkout and Rebase onto
    'main'"): for a branch that isn't checked out here or in another worktree, not a tag. `git
    rebase HEAD feature`, as IntelliJ's `rebaseOnCurrent` (measured, git 2.43: feature is checked
    out and rebased onto what HEAD was), local changes stashed as Rebase's. A remote branch's local
    branch is made first, named without its remote and tracking it (`git branch side origin/side`,
    which tracks it by git's `branch.autoSetupMerge`), as IntelliJ's
    `GitCheckoutAndRebaseRemoteBranchWorkflow`. "Rebase successful", "Checked out feature and
    rebased it on main" (IntelliJ's); stopped at conflicts, as Rebase; "Checkout and Rebase
    failed" with git's words. A local branch of that name already there (added 2026-11-12), as
    IntelliJ's (`GitCheckoutAndRebaseRemoteBranchWorkflow`, read from its source): reset to the
    remote branch (`git branch -f side origin/side`) and rebased, after asking "Local branch 'side'
    has commits that do not exist in 'origin/side'. Do you want to drop local commits?" (Drop Local
    Commits, Cancel) when it has commits of its own; one that tracks another branch isn't taken
    over, a name asked for in the New Branch dialog titled "Checkout origin/side", with Overwrite
    and without Checkout (IntelliJ's `showCheckOutOption = false`); never the current branch
    ("Cannot overwrite current branch main", IntelliJ's). Hidden where it doesn't apply, as the menu's
    other actions (IntelliJ disables it; open to change).
  - **Show Diff with Working Tree** (added 2026-11-12), after Compare with Current, for any branch
    or tag, the current one too, as IntelliJ's (`GitShowDiffWithRefAction`,
    `GitShowDiffWithBranchPanel`, `CompareBranchesDiffPanel`, read from their source): the
    documents saved first, then a Changes tool window on the left, which appears the first time and
    stays (IntelliJ's `ChangesBrowserToolWindow`), shown. In it, IntelliJ's words ("Difference
    between current working tree on main and files in feature:"), then the files that differ
    (`git diff --name-status feature`: tracked files), each opening its diff, the file in the
    branch and as it is, as the Log's commit's files do; "No differences" when none do, and git's
    words where they can't be read (IntelliJ shows an error dialog: open to change). Another
    comparison takes the place of the one before. **Claude's, open to change:** Diff's icon for
    the window (IntelliJ's new UI has a Changes icon). **Get from Branch** (added 2026-11-12), in
    the window's toolbar and a file's menu, as IntelliJ's (`GetVersionActionProvider`,
    `GitLocalCommitCompareInfo.copyChangesFromBranch`, `ReplaceFileConfirmationDialog`, read from
    their source): the selected file made as the branch has it, in the index too (`git restore
    --source=feature --staged --worktree`, or `git rm` where the branch has none; a renamed one,
    the branch's path back in place of this one), recorded in the Local History as "Get from
    feature", the documents saved first, then the list read again. A file with local changes asks
    first ("File a.ts has been locally modified.", Overwrite Modified File); git's words in IntelliJ's
    "Cannot Copy Changes" error dialog. Its icon, an arrow down onto a line, is IntelliJ's
    `AllIcons.Actions.Download` (a claim: not IntelliJ's drawing). **Not yet:** IntelliJ's Swap
    Branches; several files at once (the list selects one); the window's toolbar's other actions.
  - **Update** (added 2026-11-12), after Merge, as IntelliJ's (`GitUpdateSelectedBranchAction`,
    read from its source): for a local branch, the current one too, as the Log's branches pane's
    Update Selected (the same code): the one checked out by Update Project, another fetched from
    the branch it tracks, there if it's checked out in another worktree. Hidden without remotes;
    shown but off while a fetch runs, or for a branch that tracks none, as IntelliJ's. **Not
    yet:** IntelliJ's tooltip saying why it's off ("Tracked branch is not configured for…").
  - **Push…** (added 2026-11-12), after Update, as IntelliJ's (`GitPushBranchAction`,
    `GitPushSource.create(branch)`, read from their source): the Push dialog for a local branch,
    the one checked out or another. For another, the host reads what it would send and pushes it by
    its name (`refs/heads/feature:refs/heads/<target>`) where it pushes HEAD for the one checked
    out; a new branch's upstream is set as for the one checked out (measured with real git:
    `--set-upstream` with that refspec sets feature's, and the branch checked out stays as it was).
  - **Pull into Current Using Rebase** and **Using Merge** (added 2026-11-12), after Push, for a
    remote branch, as IntelliJ's (`GitPullBranchAction`, read from its source; "Pull into 'main'
    Using Rebase"): Update Project from that remote branch into the one checked out, by that
    method, whatever Update Project's own is (its fetch, saved changes, conflicts and report).
    Measured with real git: the merge makes a merge commit over both. Off with HEAD detached
    (IntelliJ's does nothing there: open to change).
  - After each, the Commit window's lists, the repository's state, the branches and the worktrees
    are read again: the branch selector, the tab and the status bar follow a checkout.
  - **Smart Checkout** (added 2026-11-12), as IntelliJ's (`GitCheckoutOperation`,
    `GitSmartOperationDialog`, `GitPreservingProcess`, read from their source): where git says
    local changes would be overwritten by a checkout (a branch's, a tag's, Checkout Tag or Revision…,
    a new branch checked out from elsewhere, and Checkout's Drop Local Commits; changed
    2026-11-12, at first a branch's only), "Git Checkout Problem" lists the
    files git names, in IntelliJ's words ("Your local changes to the following files would be
    overwritten by checkout. Cerebro can shelve the changes, checkout and unshelve them after
    that.", or stash and unstash, as Settings' Save changes says). Smart Checkout saves the local
    changes ("Uncommitted changes before Checkout at …"), checks out, and puts them back; where they
    don't go back, they stay saved, and IntelliJ's "Local changes were not restored" says so, with
    View saved changes…, as Update's. Force Checkout overwrites them (`git checkout -f`). Don't
    Checkout does nothing, and says nothing (IntelliJ's, with one repository). **Claude's, open to
    change:** Force Checkout sits beside Smart Checkout (IntelliJ's is at the dialog's left), and
    the dialog's first button has the focus (IntelliJ's Don't Checkout has it); the files are a
    list, not IntelliJ's changes tree with Rollback.
  - **Smart Merge** (added 2026-11-12), Merge into Current's, as IntelliJ's (`GitMergeOperation`,
    read from its source): where git says local changes would be overwritten by the merge, "Git
    Merge Problem", in the same words with "merge", and Smart Merge or Don't Merge (no Force, as
    IntelliJ's). The changes are saved ("Uncommitted changes before Merge at …"), and put back
    after the merge; at its conflicts, once they're resolved and the merge committed, as IntelliJ's
    (`GitPreservingProcess.execute(myConflictedRepositories::isEmpty)`). **Claude's, open to
    change:** left with conflicts, they stay saved and "Local changes were not restored" says so;
    IntelliJ says that too, then tries to put them back over the unmerged files after its Conflicts
    dialog closes.
  - **View Commits** (added 2026-11-12), on the notification after a branch not fully merged was
    deleted, as IntelliJ's (`GitDeleteBranchOperation`, `GitBranchIsNotFullyMergedDialog`, read
    from their source): "Branch Was Not Fully Merged", "The branch X was not fully merged to Y.
    Below is the list of unmerged commits.", the commits in `Y..X` beside the selected one's files,
    and Restore or Close. Y is what git names ("not yet merged to 'refs/remotes/origin/x'", its
    upstream; measured with real git), or else the current branch (HEAD when detached), as
    IntelliJ's. **Claude's, open to change:** Restore from the dialog leaves the notification up
    (the notifications have no way to expire one yet); its own Restore stays there too.
- **A branch's menu opens on a click, Enter or Right only, not on hover:** as IntelliJ's
  (`GitBranchesPopupStepBase.isAutoSelectionEnabled()` is false there, so its hover timer opens
  nothing; read from its source). It was listed below as not yet done until then (changed
  2026-11-12).
- **Recent** (added 2026-11-13), a group before Local, as IntelliJ's (GitBranchesTreeModel,
  GitRecentCheckoutBranches, read from their source; "Recent", its word): the local branches the
  reflog's last 50 checkouts moved to (`git reflog --grep-reflog checkout:`), the latest first, in
  that order rather than sorted; Local lists the others. `git switch` writes the same entries, and
  a detached checkout's "to" is `HEAD` or a hash, so only names that are branches are kept
  (measured, git 2.43). Before a first commit there's no reflog to read (git fails), so there's no
  Recent. Favourites were done on 2026-11-12, in the Log's branches pane's entry.
- **Not yet:** the
  branch IntelliJ remembers as recent for a clone's first branch, which the reflog has no checkout
  for.

## Annotate with Git Blame (2026-11-09)

Ido, 2026-11-09 ("all of the above", to: committing a merge with Abort and Continue, Blame, branch
operations): the second of the three. Words, layout and colours from IntelliJ's source
(`AnnotateToggleAction`, `AnnotationPresentation`, `AspectAnnotationFieldGutter`,
`GitFileAnnotation`, `GitAnnotationProvider`, `AnnotateActionGroup`, `ShowShortenNames`,
`ShortNameType`, `ShowAnnotationColorsAction`, `AnnotationsSettings`, `ColorGenerator`,
`EditorGutterComponentImpl`, `EditorGutterLayout`, its themes' `VCS_ANNOTATIONS_COLOR_*`).

- **Where:** "Annotate with Git Blame" (its mnemonic N), first in the menu of a right-click on the
  editor's gutter, and in Git → Current File (IntelliJ's `Git.MainMenu.FileActions`); checked
  while annotated, and run again it closes them. Only for a file in a git worktree with a host.
- **What it shows:** a column in the gutter before the line numbers, as IntelliJ's new UI, in the UI
  font: for each line, the date (Today, Yesterday, or the short date, as `formatPrettyDate`) and the
  author's last name, IntelliJ's defaults; the revision (8 characters) can be turned on. Each column
  is as wide as its widest text and 5px more (`GAP_BETWEEN_ANNOTATIONS`), and keeps its width with no
  annotated line in view. The file's last commit is in IntelliJ's latest-commit colour.
- **Backgrounds,** as IntelliJ's: its five colours per theme, with four between each two (21), by age
  (Order, the default: newest first) or by author (the palette shuffled so neighbours differ); none
  with one commit, or with Hide. Tokens `--cerebro-annotations*`, IntelliJ's values.
- **The editor's text, not the file's:** blamed as it is (`git blame --porcelain --contents -`), so
  lines changed since the last commit show nothing, and asked again 500 ms after an edit settles;
  meanwhile the annotations move with their lines. Failing (a file git doesn't track, say), they
  close, with IntelliJ's "Cannot load annotations" and git's words.
- **The tooltip** is IntelliJ's text (the commit, Author with email, Date, Path when the file was
  elsewhere, then the message), shown as the browser's tooltip, as the gutter markers' are
  (Cerebro's choice, open to change: IntelliJ's is a popup with links).
- **The menu on an annotation** (changed 2026-11-11, Ido: "I'd expected the same context menu and
  mouse functionality (open the git tree log) on mouse events"), in IntelliJ's order: the gutter's
  Close Annotations (`EditorGutterComponentImpl.getTextAnnotationPopupActions`), then
  `AnnotateToggleAction`'s: Show Diff, View (Revision, Date, Author; Colors: Author, Order, Hide;
  Names: Initials, Last Name, First Name, Full Name, Email, shortened as `ShortNameType`, its tests'
  cases kept), Copy Revision Number; a separator; then Options (git's own,
  `GitToggleAnnotationOptionsActionProvider`). The view and the options are kept in the browser's
  storage for every file (IntelliJ keeps them in its settings: Cerebro's choice, open to change).
- **Show Diff** (added 2026-11-11), as `ShowDiffFromAnnotation`: the line's commit's changes to the
  file, in a diff tab, from the commit before that changed it (`previous` in `git blame
  --porcelain`), or from the empty tree where the commit added it. The file's path is the one it had
  in that commit; a rename's two paths aren't both followed yet (the diff compares one path).
- **Options** (added 2026-11-11), as `GitToggleAnnotationOptionsActionProvider` and
  `GitAnnotationProvider`: Ignore Whitespaces (`-w`, on by default as in IntelliJ, which Cerebro's
  blame hadn't been), Detect Movements Within File (`-M`), Detect Movements Across Files (`-C`;
  turning it on turns Within on, and off leaves Within on; Within off turns both off), and Show Commit
  Timestamp (the committer's date in the Date column). Measured on real git: `-C` follows lines only
  from files the same commit changed, as git's documentation says. IntelliJ's Show Commit Timestamp
  is the Log's setting too; here it's the annotations' alone (open to change).
- **A click on an annotation** (added 2026-11-11), as IntelliJ's (`LineAnnotationAspectAdapter`
  under a hand cursor, then `GitFileAnnotation.showAffectedPaths` → `jumpToRevisionAsync`): with the
  main button, it shows the Git tool window and selects the commit in the Log, loading pages until
  it's there, and then its file among the commit's changes. IntelliJ looks for the commit in its
  Log tabs, and when their filters leave it out, opens a new tab without filters
  (`IdeVcsLogManager.showCommitInLogTab`, read from its source); Cerebro has one Log, so its filters
  are cleared instead (open to change). A commit not in the log says so. A press in the gutter (an
  annotation, a line number) leaves the text focused: before, the browser focused the editor's
  scroller, which takes no keys and drew a focus ring (measured in the app, 2026-11-11).
- **Hidden for a file git hasn't committed** (added 2026-11-12), as IntelliJ's AnnotateToggleAction
  (no provider enabled: `AnnotateLocalFileAction.isEnabled`, not unknown, added or ignored):
  untracked or added, as the Commit window's lists know it, as Show Diff's (decision "Git → Current
  File → Show Diff"). **Claims:** shown before those lists are read, and for an ignored file.
- **Not yet:** Annotate Revision and Annotate Previous Revision, and Show in File History (they need
  a file's version at a commit, and a Git file history: Git → Current File's history, next); Show
  Diff On Hover; reading them again after a commit, or a change on disk; the editor's context
  menu's Git submenu.

## Committing a merge, and the Git menu's merge and rebase actions (2026-11-09)

Ido, 2026-11-09 ("all of the above", to: committing a merge with Abort and Continue, Blame, branch
operations): the first of the three. Words and behaviour from IntelliJ's source
(`GitResetAddStagingAreaStateManager`, `GitMergeCommitMessageReader`, `GitMergeCommitAction`,
`GitAbortOperationAction`, `GitRebaseContinue`, `GitRebaseAbort`, `GitRebaseSkip`,
`GitRebaseProcess`, `GitAbortRebaseProcess`, `Git.MainMenu.MergeActions` and
`Git.MainMenu.RebaseActions` in its `plugin.xml`, `GitBundle`).

- **The Commit window commits a merge,** as IntelliJ's: it commits the index, since git refuses a
  partial commit during a merge ("fatal: cannot do a partial commit during a merge.", measured).
  With files still unmerged it refuses, in IntelliJ's words ("Committing is not possible because you
  have unmerged files."). What's staged besides the files ticked is unstaged first and staged again
  after, whether the commit goes through or not; the commit has both parents (measured on real git,
  `packages/host/test/git.test.ts`, and end to end).
- **The merge's message:** an empty message field gets git's (`MERGE_MSG`, its "# Conflicts:" lines
  kept, as IntelliJ's), and loses it when the merge is over if it wasn't edited.
- **The Git menu,** after Update Project…, as IntelliJ's: Commit Merge (once no file is in
  conflict) and Abort Merge while a merge is under way; the Rebase menu (Abort Rebase, Continue
  Rebase, Skip Commit) while a rebase is; then Resolve Conflicts…, only while files are in
  conflict. Each asks, says how it went, and fails in IntelliJ's words ("Abort Merge" / "Abort
  merge?", "Merge abort succeeded"; "Abort rebase in {repository}?", "Abort rebase succeeded";
  "Merge commit failed", "Continue rebase failed"). Continue Rebase and Skip Commit go through
  conflicts as Update Project does: the Conflicts dialog, then on; closed with files left, "Rebase
  stopped due to conflicts" with Resolve…, Continue and Abort; at the end "Rebase successful".
- **In the host** (`conflicts.ts`): `git.state` (the operation under way, whether files are
  unmerged, a merge's message), `git.continue` (`git commit` with git's message for a merge,
  `git rebase --continue` for a rebase, with no editor), `git.skipCommit` and `git.abort`, each
  recorded in the Local History.
- **How the page knows what's under way:** it reads the active worktree's state every 2 seconds, as
  the window gets the focus, and after Cerebro's own git actions, so a merge started in the terminal
  shows (Cerebro's choice, open to change: IntelliJ watches `.git` for changes).
- **Not yet:** Edit a rebase's todo (interactive rebase). (A cherry-pick's and revert's Abort:
  decision "Cherry-Pick".)
  (Merge… and Rebase…, which start one: their decisions.)

## Merge conflicts (2026-11-09)

Ido, 2026-11-09 ("Update first, conflicts next", then "next"): IntelliJ's Conflicts dialog and its
3-way merge. Words, layout and behaviour from IntelliJ's source (`GitConflictResolver`,
`MultipleFileMergeDialog`, `GitDefaultMergeDialogCustomizer`, `TextMergeViewer`,
`GitMergeProvider`, `VcsBundle`, `GitBundle`, `DiffBundle`).

- **Where it shows:** Git → Resolve Conflicts…, after Merge and Rebase, as IntelliJ's; the Commit
  window's Merge Conflicts group, first, with Resolve on its row; and Update Project at conflicts
  (see "Updating the project"). Files in conflict (`U` on either side, `AA`, `DD`) are in that
  group, in IntelliJ's conflict red (#DE6A66 dark, #DE1B2E light, from its themes), never put in a
  commit.
- **The Conflicts dialog:** what's being merged over the list, in IntelliJ's words ("Merging branch
  origin/main into branch main", a rebase's "Rebasing branch … onto …", with the commit it stopped
  at); the files, with Yours (branch) and Theirs (branch), each Modified or Deleted. Accept Yours
  and Accept Theirs take that side for the files selected (git's stage 2 or 3, or the file deleted
  when that side deleted it); Merge…, or a double-click, opens the merge window for each in turn,
  until one is cancelled. It closes once no file is left. During a rebase, yours is the branch
  being rebased (git's stage 3), as IntelliJ swaps them.
- **The merge window,** "Merge Revisions for {path}": yours, the result and theirs, side by side,
  their titles IntelliJ's ("Changes from main", "Result", "Changes from origin/main"; a rebase's
  "Rebasing {hash} from {branch}" and "Already rebased commits and commits from {onto}"). Changes
  are found by whole lines against the base; changes from both sides that touch or overlap are one
  conflict, unless they're the same. Each change has IntelliJ's » or « to take it, and × to ignore
  it; Apply non-conflicting changes: Left, All, Right; the count of what's left ("2 changes, 1
  conflict", "All changes have been processed"). Accept Left and Accept Right take a side whole;
  Apply writes the result and marks the file resolved, asking first, in IntelliJ's words, when
  changes are left ("Apply Changes", Continue Merge). The panes are kept level with blank space
  where a side has fewer lines, and scroll together. Its colours are IntelliJ's (its default
  schemes, and the New UI's): modified #385570 / #C2D8F2, inserted #294436 / #BEE6BE, deleted
  #484A4A / #D6D6D6, conflict #45302B / #FFD5CC (dark / light).
- **In the host** (`conflicts.ts`): the files from `git ls-files -u`, their versions from the index's
  stages, Accept as `git checkout --ours/--theirs` and `git add` (or `git rm`), a merged text
  written and added. Measured on real git (`packages/host/test/conflicts.test.ts`). Each is
  recorded in the Local History ("Accept Yours", "Merge").
- **Rejected:** CodeMirror's own merge view (`@codemirror/merge`), which compares two documents,
  not three. Telling a both-added file's sides apart line by line: with no base, it's one conflict
  (Cerebro's choice, open to change).
- **Asking before the result's changes are lost** (added 2026-11-13): once the result has changed
  (a change taken, or typed), Cancel (Escape, the close button) and Accept Left or Right ask first,
  as IntelliJ's (MergeUtil.showConfirmDiscardChangesDialog, its words from DiffBundle, read from
  its source): titled with the button's name, "There are unsaved changes in the result file.
  Discard changes and cancel merge anyway?", with Discard Changes and Cancel Merge (or Accept Left,
  Right) and Continue Merge. Changed means changed since the window opened, even if back as it was,
  as IntelliJ's flag. ("Cancel File Merge", thought to be it, is IntelliJ's question when a
  conflict is outdated.)
- **Not yet:** undo in the merge window; merging a
  binary file (it says to accept a side); Group by directory and Resolve Simple Conflicts.
  (changed 2026-11-09: the Git menu's Continue Rebase, Abort Rebase and Abort Merge, Resolve
  Conflicts… shown only with conflicts, and committing a merge from the Commit window are done,
  see "Committing a merge, and the Git menu's merge and rebase actions".)

## Updating the project (2026-11-09)

Ido, 2026-11-09 ("do 1-3", the third being Update Project, then "Update first, conflicts next"):
IntelliJ's Update Project, without its Conflicts dialog, which comes next. Its words and behaviour
are from its source (`GitUpdateProcess`, `GitMergeUpdater`, `GitRebaseUpdater`,
`GitPreservingProcess`, `GitUpdateOptionsPanel`, `UpdateOptionsDialog`, `PushController`,
`GitBundle.properties`, `VcsBundle.properties`, `DvcsBundle.properties`, `VcsActions.xml`).

- **Where it starts:** Git → Update Project…, after Push…, as IntelliJ's Git menu; Ctrl+T (Cmd+T
  on macOS), IntelliJ's default. The keymaps follow IntelliJ's: Visual Studio's Ctrl+Alt+W (macOS:
  Cmd+Alt+W); none in Eclipse's and Sublime Text's, which remove it. VS Code's keymap has none
  either: its Ctrl+T is Go to Symbol in Workspace (Cerebro's choice, open to change). And the Push
  dialog's banner, when the remote has diverged, has IntelliJ's Update project…, which closes the
  dialog and updates.
- **The dialog,** IntelliJ's "Update Project": Merge or Rebase (the setting's value to start with;
  the choice is kept), with Don't show again. After that, it updates with the setting's method
  without asking, until Version Control → "Show options before update" is ticked again (IntelliJ's
  Show options before: Update, on its Confirmation page).
- **Settings,** IntelliJ's, with its defaults: Version Control → Git's "Update method" (Merge or
  Rebase; IntelliJ's Branch Default isn't there yet) and "Clean working tree using" (Shelve, or
  Stash). Global, as Use credential helper is (Cerebro's choice, open to change: IntelliJ keeps
  them by project).
- **What it does,** as IntelliJ's `GitUpdateProcess`, in the host (`update.ts`):
  - it won't start during a merge or a rebase, or with files unmerged; nor in a detached HEAD, nor
    on a branch with no upstream;
  - it fetches the upstream's remote, all of it, as IntelliJ's, with the same login as Push (see
    "Logging in to remotes"); with nothing new upstream, it stops there;
  - local changes in the way are saved first under IntelliJ's message ("Uncommitted changes before
    Update at {date}") and put back after: for a rebase, any; for a merge, when the index has
    changes, or a file changed here was changed upstream too (IntelliJ's `isSaveNeeded`). Untracked
    files stay where they are. A rebase with local changes tries a fast-forward first, which saves
    nothing (IntelliJ's `tryFastForwardMergeForRebaseUpdaters`);
  - then `git merge --no-stat -v @{upstream}`, or `git rebase @{upstream}`;
  - when git won't start it (untracked files in the way, say), what was saved is put back, and the
    error is git's.
  Measured on real git (`packages/host/test/update.test.ts`). It's recorded in the Local History, as
  other git changes are.
- **Updating…** on the status bar while it runs, as IntelliJ's; Update Project can't start another
  meanwhile.
- **How it went,** in IntelliJ's words: "2 files updated in 1 commit", with View Commits (below);
  "Nothing to update"; "Cannot update" with why ("You have unfinished merge. These
  conflicts must be resolved before update.", and its rebase's and unmerged files' words, "main has
  no tracked branch"); "Cannot Update: No Current Branch"; "Update failed" with git's words. When
  saved changes didn't go back over the update: "Local changes were not restored", "Before update
  your uncommitted changes were saved to shelf." (or stash), with View saved changes…, which shows
  the Commit window's Shelf or Stash tab. Errors stay, as IntelliJ's sticky balloons.
- **Conflicts** (changed 2026-11-09: the Conflicts dialog is here, see "Merge conflicts"): as
  IntelliJ's `GitConflictResolver`, the Conflicts dialog shows, saying "Merge conflicts detected.
  Resolve them before continuing update." (or "…continuing rebase."). Once no file is left in
  conflict, the update goes on: a merge is committed with git's message, a rebase continued, to
  its next stop or its end, and what was saved is put back. Closed with files left, the merge or
  rebase stays under way and what was saved stays saved: "Cannot complete update" (a rebase's:
  "Cannot continue rebase", with IntelliJ's words on continuing or aborting it), "There are
  pending unresolved conflicts.", with Resolve…, which shows the dialog again; as IntelliJ's, the
  update doesn't go on from there. Before, this entry gave the dialog's words as the
  notification's: IntelliJ's source has them as the dialog's.
- **View Commits** (added 2026-11-11), after an update, and View commits after a pull or a merge
  committed (not --squash or --no-commit, as IntelliJ's `GitMergeAction`, which offers it only
  then): the Git tool window shown, its Log's commits those from HEAD before to HEAD after (git's
  `before..after`, IntelliJ's `HashRange` and `VcsLogRangeFilter`). In the Branch filter, the Text,
  User and Date filters cleared, the Paths filter kept, as IntelliJ's tab for it has its Log's paths
  alone. IntelliJ opens a Log tab of its own for each, by itself unless Advanced Settings say not
  (`git.update.info.auto.open.enabled`); here the one Log shows it, when asked (Claude's choice, open
  to change: a second Log is a tab beside it, not here yet).
- **Not yet:** Reset to the Remote Branch
  (the dialog's left button), Branch Default, Choose upstream branch (on "no tracked branch"),
  the warning before rebasing published commits, and several repositories at once. (Unshelving a
  hunk whose lines moved, left out before, applies since 2026-11-13: decision "The shelf and the stash".)

## Reformat Code (2026-11-04)

After File Structure, IntelliJ's Reformat Code (Ido: "do them all"). Claude's choices, open to
change.

- **The file, or the selection, as IntelliJ's:** Ctrl+Alt+L formats the whole file when nothing is
  selected, and the selected text when something is. It's one change, which undo takes back as one
  ("Reformat Code" in Local History). If the text changes before the server answers, the answer is
  dropped.
- **A hint at the caret, in IntelliJ's words** (from its source): "Formatted 3 lines"
  (`hint.text.formatted.line`), or "No lines changed: content is already properly formatted". It
  is Rename's hint, now in its own module (`hint.ts`) for both. The count is of the lines the
  changes touch, as they are after formatting. That's a claim: IntelliJ counts the lines of its
  diff.
- **From the file's language server** (`lsp.format`, LSP's `textDocument/formatting` and
  `rangeFormatting`), with the Code Style's indent (changed 2026-11-08: it was the tab size, in
  spaces; see "Code Style: the indent"). Measured:
  - TypeScript 7 formats whole files and ranges, as does YAML's server.
  - bash-language-server formats whole files only, through shfmt; with no shfmt on the PATH, it
    answers with no edits, so the hint says the file's already formatted.
  - basedpyright doesn't format: the hint says "Its language server doesn't format it."
  - A server that formats only whole files, given a selection: "Its language server formats only
    whole files: select nothing to format all of it."
  - Cerebro's own server now formats JSON, CSS (with SCSS and Less) and HTML, whole or a range,
    through Microsoft's libraries.
- **Each keymap's keys,** from IntelliJ's files (`ReformatCode`) and VS Code's documentation of
  its default keys (Format Document, Format Selection):
  - IntelliJ IDEA: Ctrl+Alt+L; on macOS, Cmd+Alt+L. Emacs: none (IntelliJ's Emacs keymap removes
    it).
  - VS Code: Shift+Alt+F on Windows and macOS, Ctrl+Shift+I on Linux, and Ctrl+K Ctrl+F (Cmd+K
    Cmd+F on macOS) for the selection.
  - Eclipse: Ctrl+Shift+F (and Ctrl+Alt+L); on macOS, Cmd+Shift+F.
  - NetBeans: Alt+Shift+F.
  - Visual Studio: Ctrl+K Ctrl+D and Ctrl+K Ctrl+F, with their one-Ctrl forms and Ctrl+Alt+Enter;
    on macOS, the same with Cmd.
- **Not yet:**
  - A formatter for bash without shfmt, and for Python: the installer could bring them (backlog,
    "Binaries with the installer").
  - Formatting on save, IntelliJ's Reformat File dialog (optimize imports, rearrange), and
    formatting as one types.
  - Reformat Code in a menu: no editor action is in one yet.
  - Prettier: a plugin, later (backlog).

## File Structure (2026-11-04)

After Rename, IntelliJ's File Structure (Ido: "do them all"). Claude's choices, open to change.

- **A popup, as IntelliJ's:** Ctrl+F12 lists the file's symbols as a tree, titled with the
  file's name, the innermost symbol holding the caret highlighted. Typing narrows it to the
  symbols whose names match and what they're in, the first match highlighted; Enter goes to the
  symbol's name. It's the popups' search field over a list (`ui-popup`), its items now indented by
  their depth (19px a level, as the Project tree, measured from WebStorm), and its `initial` item
  now chosen from the items for each query as well.
- **Each symbol's icon is its letter in a circle** (C for a class, m for a method, f for a
  function or field...), drawn in the text's colour: IntelliJ's are coloured badges (a claim: not
  measured).
- **From the file's language server** (`lsp.structure`, LSP's `textDocument/documentSymbol`, which
  the gutter markers already ask). Measured:
  - TypeScript 7 and basedpyright nest their symbols, with no detail (no signature) to show after
    a name. TypeScript's lists an imported name too, as a variable; IntelliJ's leaves imports out.
  - bash-language-server answers flat (SymbolInformation), each with the function it's in: the
    host nests them by their ranges, so a function's `local` variables are in it. The gutter
    markers get them nested too.
  - Cerebro's own server for JSON, CSS and HTML now answers it, through Microsoft's libraries: a
    JSON file's keys and an HTML file's elements, nested, and a style sheet's rules (not the
    custom properties in them).
  - With no server's answer in time, the popup says so: "No language server answered".
- **Each keymap's keys,** from IntelliJ's files (`FileStructurePopup`) and VS Code's sheets (Go to
  Symbol in Editor):
  - Ctrl+F12: IntelliJ IDEA, Emacs. Cmd+F12: IntelliJ IDEA (macOS), IntelliJ IDEA Classic.
  - VS Code: Ctrl+Shift+O; on macOS, Cmd+Shift+O.
  - Eclipse: Ctrl+F3 and Ctrl+O; on macOS, Cmd+O.
  - NetBeans: Ctrl+F12 and Ctrl+Shift+F12. Sublime Text: Ctrl+R; on macOS, Cmd+R.
  - Visual Studio (both): Alt+\.
  - macOS System Shortcuts: Cmd+Shift+7 and Cmd+F12.
- **Not yet:**
  - IntelliJ's options (inherited members, fields shown or not) and its sorting by name.
  - A big file's symbols past the popup's 200 rows are counted, not listed.
  - The Structure tool window (Alt+7) doesn't list them yet.

## Rename (2026-11-04)

After Parameter Info, IntelliJ's Rename (Ido: "do them all", to Rename, File Structure, Reformat
Code and folding). Claude's choices, open to change.

- **In place, as IntelliJ's:** Shift+F6 boxes the name at the caret and selects it, and the new
  one is typed over it. Enter, or the caret leaving the box, renames it everywhere; Escape puts it
  back. The box is in the accent colour (a claim: IntelliJ's isn't measured). Where there's nothing
  to rename, a hint at the caret says why: IntelliJ's words ("Cannot perform refactoring. Caret
  should be positioned at the name of element to be refactored."), or the server's ("You cannot
  rename this element.", TypeScript's).
- **One change, undone as one:** the typing in the box isn't kept in the undo history. The name is
  put back, and the server's edits are made in each file's document as one edit, as Replace in
  Files does. They're saved, labelled "Rename" in the Local History.
- **The files are saved before the server is asked:** it reads the files not open in it from disk,
  so a file with unsaved edits would get edits in the wrong places.
- **From the file's language server** (`lsp.renaming` and `lsp.rename`, LSP's
  `textDocument/prepareRename` and `textDocument/rename`). Measured:
  - TypeScript 7 gives the name's range and the name. Renaming an imported function where it's
    used gave the import an alias (`tally as count`), VS Code's default; with
    `preferences.useAliasesForRenames` off, which Cerebro now gives it when it asks for its
    settings (`workspace/configuration`), it renames the function where it's defined too.
  - basedpyright gives the range alone, and its edits per version of a file (`documentChanges`),
    which the host takes as well.
  - bash-language-server renames in the scripts that source the function's, one never opened too.
  - Cerebro's own server for JSON, CSS and HTML now renames style sheets' names (custom
    properties, variables) through Microsoft's CSS library. HTML's library renames only a tag's
    pair, without saying where first, so HTML is left out.
  - An edit that makes, moves or deletes a file isn't made: none of these servers gave one.
- **Each keymap's keys,** from IntelliJ's files (`RenameElement`) and VS Code's sheets (Rename
  Symbol):
  - Shift+F6: IntelliJ IDEA and its macOS keymaps, Emacs, Sublime Text (both), Eclipse (macOS).
  - VS Code (both): F2. Eclipse: Alt+Shift+R. NetBeans: Ctrl+R.
  - Visual Studio: Ctrl+R R and Ctrl+R Ctrl+R; on macOS, Cmd+R R and Cmd+R Cmd+R.
  - macOS System Shortcuts: Cmd+Alt+R and Shift+F6.
- **Next and Previous Highlighted Error are in the keymaps now** (`GotoNextError`,
  `GotoPreviousError`). They were F2 and Shift+F2 in every keymap, which would have taken VS
  Code's F2 from Rename. VS Code's are F8 and Shift+F8 (its sheets). The others' are their files':
  - Eclipse: none, and Shift+F1. Eclipse (macOS): Cmd+. and Cmd+Shift+. (written Cmd+Shift+>).
  - Emacs: F2 and Ctrl+X `, with Shift for the previous one.
  - NetBeans: F2 and Ctrl+.; Shift+F2 and Ctrl+,.
  - Visual Studio (both): Alt+PageDown and Alt+PageUp.
  - macOS System Shortcuts: Ctrl+, and F2; Ctrl+Shift+, (written Ctrl+Shift+<) and Shift+F2.
  - Sublime Text (both): none.
- **Not yet:**
  - Undo in one file takes the rename back there only. IntelliJ's takes it back in every file at
    once, which needs an undo shared between documents.
  - The other places the name is in the file don't change as it's typed, as IntelliJ's do.
  - Renaming files, and IntelliJ's Rename dialog (Shift+F6 again), with its options for comments
    and strings.

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
- **Its tooltip names where it goes** (added 2026-11-01), after IntelliJ's "Implements method in
  Shape": "Implements area in Shape", "area is implemented in Circle, Square". The types are the
  bases' names going up, and going down the type each target is, or is a member of, from its file's
  symbols. The words are a claim, not measured.
- **Not yet:** shell scripts (bash-language-server offers neither request, measured).
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
- **Their marks on the scrollbar** (added 2026-11-01), as IntelliJ's error stripe: one per usage,
  over the scrollbar's band, written apart from read, always shown (not only with the thumb). From
  IntelliJ's source (`EditorMarkupModelImpl`): where the usage is in the whole text, scaled to the
  scroll area's height when the text is taller than it, else beside its line; 2px high
  (`ERROR_STRIPE_MARK_MIN_HEIGHT`'s default). Colours from the same attributes'
  `ERROR_STRIPE_COLOR`: Islands Dark `#5b786a` and `#ba6387`, Light `#d0a1ff` and `#f0a8d2`.
  IntelliJ's stripe is 14px beside its thumb. Cerebro's thumb is drawn over the content, so the
  marks sit in the thumb's band (10px, 2px from the edge), under it. That's a claim, open to
  change.
- **Clicking a mark puts the caret on its usage** (added 2026-11-01), as clicking IntelliJ's error
  stripe goes to its mark. A mark takes the click 2px above and below it too, since it's 2px high
  (a claim; IntelliJ's own reach wasn't measured). The scrollbar's track is drawn over the marks,
  so `ui-scrollbar` gives a press on a track to what's under it marked `data-scrollbar-through`;
  over the thumb, a press drags it.
- **Not yet:** a mark's tooltip, as IntelliJ's.
  (IntelliJ's gutter icons came next: "Gutter markers".)

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
- **A press held on a track goes on paging** (added 2026-11-01), as IntelliJ's `DefaultScrollBarUI`
  does (its source): after 300 ms, then every 60 ms, until the thumb reaches the pointer or the area
  its end. Moving the held pointer past the thumb again starts it again after the pause.
- **Not yet:** the macOS widening; IntelliJ's middle-button press on a track, which moves the thumb
  there and drags it.

## Window buttons in full screen on macOS (2026-10-27)

Ido: "it's always visible in intellij, it's us that drop them in full screen mode, and we
shouldn't". In full screen, macOS hides the traffic lights until the pointer reaches the top of the
screen, which left the room kept for them empty.

- **Real buttons, made by AppKit, put in the window where the traffic lights were** (changed
  2026-10-27, from buttons drawn in the page), as JetBrains Runtime does for IntelliJ (`setWindowFullScreenControls` in
  `AWTWindow.m`, on in the new UI through `apple.awt.newFullScreenControls`): close, minimize and
  zoom from `[NSWindow standardWindowButton:forStyleMask:]`, in a view in the window's frame view,
  over its content (changed 2026-11-04: they were in the content view, where clicks never reached
  them; see below).
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
- **Why they moved to the frame view (2026-11-04):** Ido: "trying to use them to get out of it or
  to close the app does nothing", with "Window move completed without beginning" in the log for
  each click. Chromium's content view answers no hit test in the page's draggable regions
  (`-[BridgedContentView hitTest:]` returns nil for them, in `bridged_content_view.mm`), and the
  toolbar under the buttons is one: the click went to the frame view, which made it a window drag
  (`cr_mouseDownOnFrameView:`), and a full-screen window can't move. The frame view asks its own
  subviews first. The e2e test now checks that a hit test at the buttons' middle, as AppKit finds
  a click's view, reaches them; the click itself is still Ido's to check on his Mac.
- **Leaving full screen** (changed 2026-11-04). Ido, once the buttons took clicks (#128): leaving
  full screen left "the transparent window, that's the app". **Measured on CI's macOS:** after
  leaving, by `setFullScreen(false)` or the green button, the window's frame view was hidden. The
  cause, from Electron's source and measured: as leaving starts, Electron hides "the window's close
  button's superview's superview", taking it for the title bar's container, and shows it again
  once leaving is done (`window_buttons_proxy.mm`, `NotifyWindowWillLeaveFullScreen`). While ours
  are in the window, AppKit gives ours as the window's close button (measured: `theWindows`), so
  Electron hid our view's superview, the frame view; by the time it showed the container again,
  ours were gone and it showed the real one's, leaving the frame view hidden. **Now** the buttons
  sit in a row inside their view, so what Electron hides is their own view: they hide as leaving
  starts, as JetBrains Runtime hides its own (`windowWillExitFullScreen:`). The module also hides
  them and gives macOS's copies back to the menu bar's window as leaving starts, as JetBrains
  Runtime does, watching for `NSWindowWillExitFullScreenNotification` itself, since Electron has no
  "will leave" event. The e2e test leaves full screen both ways and checks the window shows as
  before (visible, opaque, its content and frame views not hidden).
- **Not yet:** the Welcome window in full screen has them too, over no toolbar.

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
- **A tab's context menu has Rename Session and Close Tab** (added 2026-11-01). Rename Session
  asks for the name as IntelliJ's does ("Session name:", its `TerminalBundle` text), and the name
  is kept with the tabs. Closing a tab drops its name: a new tab with its number is "Local (n)"
  again. IntelliJ's tab menu has more (Close Other Tabs, Move to Editor); left out.
- These are Claude's choices, open to change.
- **Not yet:** several Claude sessions (Ido: to design later); IntelliJ's dropdown for choosing a
  shell.

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
- **VS Code's Linux keys on Linux** (added 2026-11-01): the VS Code keymap is for Windows and
  Linux, and on Linux it takes where VS Code's Linux sheet (`keyboard-shortcuts-linux.pdf`) differs
  from its Windows one, for Cerebro's commands. Go Back is Ctrl+Alt+- and Go Forward Ctrl+Shift+-,
  not Alt+Left and Alt+Right. Close Editor is Ctrl+W only, without Ctrl+F4. Save All is Ctrl+S only,
  without Ctrl+K S, which that sheet doesn't list.
- **IntelliJ's other keymaps** (added 2026-11-01, the backlog's rest of "Keymaps"): Eclipse,
  Eclipse (macOS), Emacs, IntelliJ IDEA Classic (macOS), macOS System Shortcuts, NetBeans, Sublime
  Text, Sublime Text (macOS), Visual Studio and Visual Studio (macOS), named as IntelliJ's Settings
  names them (`DefaultKeymap.kt`), all listed by name.
  - Their keys are IntelliJ's files for them (`plugins/keymaps` for Eclipse, NetBeans and Visual
    Studio, the rest beside `$default.xml`), for Cerebro's commands, converted by a script from
    each action's id (`GotoFile`, `FindInPath`…; the same ids give the IntelliJ keymaps' keys
    already here).
  - Each takes its parent's keys for the commands it doesn't name, as IntelliJ: `$default` (here
    IntelliJ IDEA) or `Mac OS X 10.5+` (IntelliJ IDEA (macOS)). IntelliJ IDEA Classic's parent is
    `$default` with Ctrl and Cmd swapped, as IntelliJ's `MacOSDefaultKeymap` does for keymaps
    named "Mac OS X…" (read in its source); `forMac` does it here.
  - Keys are all the file gives, alternates included (IntelliJ IDEA's own keep only the main
    ones: unchanged).
  - Emacs's sequences that start with Escape (`Escape X` for Find Action, `Escape .`, `Escape W`)
    are left out: Escape closes popups and dialogs here, and each of those has another key. Claude's
    choice, open to change.
- **Not yet:**
  - CodeMirror's text editing keys (moving by word, duplicating a line) follow CodeMirror, not the
    keymap;
  - punctuation with Shift is named by the character it types (Ctrl+Shift+- arrives as
    Ctrl+Shift+_), so VS Code's macOS Go Forward, and the other keymaps' keys with Shift and
    punctuation, are written for a US layout.

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
- **"… more" in All** (added 2026-11-01), after a kind with more than it lists, as IntelliJ's
  (its source: `SearchEverywhereUI`, `SEResultsListFactory`). Choosing it lists 15 more of that kind
  (IntelliJ's `MULTIPLE_CONTRIBUTORS_ELEMENTS_LIMIT`) and keeps the popup open. A new query or
  another tab starts over. The row is small and muted, as the group headers are. The popup's items
  can now show more instead of being chosen (`PickerItem.more`).
- **Not yet:**
  - "Include non-project items", the filter and "Open In Right Split" from IntelliJ's popup.
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
- **Preserve case** (added 2026-11-01): a toggle inside the Replace field, in the editor's bar and
  in Replace in Files, with IntelliJ's icon and its mnemonic, Alt+E. Each replacement takes the case
  of the text it replaces, word by word: a port of IntelliJ's `PreserveCaseUtil.applyCase` (its
  default, registry `ide.find.word.based.preserve.case`), passing IntelliJ's own test cases. With
  Regex, the case applies to what the expression gave, as IntelliJ's. In the editor, CodeMirror's
  Replace still replaces, and a transaction filter changes the case of what it inserts (a
  replacement whose length the case would change, `ß` to `SS`, is left as typed).
  - Alt+E is also the Edit menu's mnemonic, and the menu bar took it first. Now an element claims
    the letters it handles with Alt (`data-alt-keys`: the editor's bar and Find in Files' popup), and
    the menu bar leaves those to it, as Swing gives the focused component its keys before the menu
    bar's mnemonics.
- **The search and replace history** (added 2026-11-13; Ido: "in intellij the search input in
  the modal has a search icon with a cheveron that when clicked shows the search history - I want
  that too"), as IntelliJ's Find in Files (`SearchTextArea`'s ShowHistoryAction,
  `FindInProjectSettingsBase`, `FindPopupPanel`, `FindUIHelper`, read from their source):
  - The search field and the Replace field each have the magnifier with an arrow at their start
    (IntelliJ's SearchWithHistory icon; ours is drawn after it, a claim). A press on it, or
    Alt+Down in the field (ShowSearchHistory), lists "Search History" or "Replace History" below
    the field, the latest first; the text chosen goes in the field and is searched, as if typed.
  - What's kept, as IntelliJ's: what was searched for, and replaced with, as the popup closes
    (its `saveSettings`) and at Replace (`updateFindSettings`); 300 of each, the same text moved
    first, texts as they were typed; one for every repository, in the browser's storage.
  - The Log's text filter shows its history through the same list, and its magnifier now has
    the arrow too (decision "The Log", its history).
  - **Claude's, open to change:** a blank text isn't kept; nothing opens with no history yet
    (IntelliJ's shows an empty list); the list has a search field and is at least 360 pixels
    wide (IntelliJ's is a plain list, as wide as its texts up to the field's width and 200 more).
  - The popup opens with the last search in its field, selected so typing replaces it, and finds
    it; Replace in Files' Replace field has the last replacement (2026-11-13). As IntelliJ's
    `FindPopupPanel.initByModel`, which takes `getMostRecentFindString` and
    `getMostRecentReplaceString` when nothing else asks for a text, and selects the field's all
    (read from its source).
  - Before the last search, the focused editor's selection, as IntelliJ's
    (`FindInProjectUtil.initStringToFindFromDataContext`, read from its source): if shorter than
    10,000 characters; without a selection, its find bar's search and replacement while the bar
    is open. **Claude's, open to change:** a selection over several lines isn't taken, since the
    search is within lines (IntelliJ's searches over several).
- **Not yet:** the Find window's tabs (a search each), its preview, and IntelliJ's Group By
  options; Replace All undone as one step across files; the selection escaped for Regex
  (IntelliJ's, when Regex is on as the popup opens: ours always opens with it off).

## Editing and saving (2026-10-26)

The second part of "A basic IDE before git and agent management" (Ido: "Yes, edit and save"). The
choices below are Claude's, after IntelliJ, open to change.

- **A document per open file,** as IntelliJ's: it outlives the editors showing it, so switching tabs
  keeps the edits, the selection and the undo history (CodeMirror's state, kept as JSON with its
  history field between editors). It knows the text last read or saved, so whether it's modified.
  It keeps where its last editor was scrolled too (changed 2026-11-11, a bug Ido found: after going
  to a definition, a tab chosen again showed its file's top). A tab's editor is made again each time
  it's chosen, and only the state had been kept; now CodeMirror's scroll snapshot is too, given to
  the next editor. A position to reveal is revealed once, as a focus request is taken once: the
  tab of a definition gone to, chosen again, had gone back to the definition (both measured in the
  app: line 0 and line 85, where it had been left at 40 and 74).
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
  2 seconds is a claim of small cost, not measured. A jump to a place in an open file (Jump to
  Source from a diff, a usage, a declaration) reads it again first, and goes there once it's read
  (added 2026-11-13): a diff read from disk named lines the editor didn't have yet, and F4 put the
  caret in its old text (measured). A jump to a file that isn't open goes at once.
- **A file changed both in the editor and on disk is a conflict** (2026-10-27, Ido: "a popup should
  prompt the user to select between the two OR open a merge window"), found when it's read again or
  before it's saved (saving reads the file first, and doesn't write over a change it didn't read).
  It's asked about as IntelliJ's File Cache Conflict (`ConflictResolverDialog.java`, its words from
  `UIBundle.properties`): Load File System Changes, Keep Memory Changes (Escape too, IntelliJ's
  Cancel; saved over the disk's later), or Show Difference: the disk's text on the left and the
  edits on the right, editable, with an arrow by each change that takes the disk's, and Save Memory
  Content. Loading or merging is an edit undo takes back, on its own: typing next to it straight
  after isn't joined to it (changed 2026-11-01: CodeMirror joins an adjacent typed edit made within
  half a second to the change before it, so Undo took back both; the same holds for Replace in
  Files' edits). Before, the edits won and saving
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
- **The idle save is a setting** (added 2026-11-01), in Settings → System Settings, as IntelliJ's
  "Save files if the IDE is idle for 15 seconds" (`GeneralSettingsConfigurable.kt`). It's on by
  default (Ido asked for saving after a while; IntelliJ's is off), with the seconds 1 to 300 and 15
  by default (`GeneralSettings.SAVE_FILES_AFTER_IDLE_SEC`). The seconds are on the checkbox's
  row, after it, as Sync with OS is on the Theme's. A change counts from the next key or move.
- **Not yet:** Undo's names in a text field (only the editor's are known).

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
- **Go to File and the index in a folder without git** (changed 2026-11-01; they read git's file
  list, and had nothing there): the folder's files are ripgrep's list (`rg --files
  --no-require-git --hidden`, which respects `.gitignore` files and skips `.git`), and the index
  hashes them with `git hash-object`, which works outside a repository (measured). Git's list
  stays inside one: it knows what's tracked. Claude's choice, open to change.
- **Not yet:** the macOS menu bar with several windows (it's the menu of
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
- **After it:** committing from the Commit window, diffs to code (F4 from a diff line), then shelve
  and stash. (Changed 2026-11-03: the plan's "since the session started" and per-commit views are
  dropped; see "Phase 1 is WebStorm's functionality".)
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
changed, in a tool window of its own (the Commit tool window's, until 2026-11-03).

- **A snapshot before and after each turn,** not only at its end as the plan said: the difference
  between the two is what the turn changed, even when the user (or another tool) changed files
  between turns. The host takes them on the `UserPromptSubmit` and `Stop` hooks.
- **A snapshot is a commit** of every file git doesn't ignore, made through a copy of the
  worktree's index (`GIT_INDEX_FILE`), so what the user staged is untouched (measured), with
  Cerebro as its author, whoever the user is. Each turn's end is kept by a ref under
  `refs/worktree/cerebro/turns/`: git keeps the commits, and other worktrees don't see them
  (measured). The prompt, cut to 200 characters, is the commit's message. Nothing removes them yet.
- **The index's copy keeps the index's time** (fixed 2026-11-03): git trusts a file's size and
  time as the index has them unless the file's time isn't before the index's own; it then reads
  the file ("racy git"). A copy made later hid that, so a file changed in the second the index was
  written, keeping its size, was snapshotted as it was before (seen as a flaky Local History test;
  a host test with the times set shows it, and fails without the fix).
- **The prompt's hook waits for the snapshot** (the hook client waits for the host's reply), so the
  agent can't change a file before it's taken; the other hooks don't wait.
- **In a tool window of its own, Agent Changes** (changed 2026-11-03, Ido: "it shouldn't be in
  the commit window, it should have it's own panel", "similar to the FS and the git panels"), on
  the left stripe after Commit: each turn, the latest first, with its time and prompt; expanded,
  the files it changed, each opening the file (double click, Enter, F4) or the diff between the two
  snapshots (Ctrl/Cmd+D; a tab id `diff@from..to:path`). The Commit window's Show Diff, Jump to
  Source, Refresh, Expand All and Collapse All act on whichever of the two has the keyboard. Its
  name and place are Claude's, open to change. It was in the Commit window, under the uncommitted
  changes, before.
- **Not yet:** a turn that's under way when the app quits is lost. (The plan's "since the session
  started" and per-commit views were dropped on 2026-11-03: see "Phase 1 is WebStorm's
  functionality".)

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
  shadow root. Diff colours and the status colours are theme tokens, not measured. (Changed
  2026-11-11: two editors and a divider, in IntelliJ's colours, each side scrolling by itself, as
  IntelliJ's; see "The diff viewer, as IntelliJ's".)
- **A diff tab** is the file's path marked `diff:`; it reads both sides through the host when it
  shows (`git.diff`), so it's current each time it's switched to.
- **From a diff to the code** (added 2026-11-02, the next stage's second item): Jump to Source (F4,
  or Cmd+Down on macOS, as IntelliJ's) in a diff opens the file where the caret is, as IntelliJ's
  diff does (`TwosideTextDiffViewer.getNavigatable`): from the right side, at the caret; from the
  left, which is no file, at the line it corresponds to on the right, carried across the changes as
  IntelliJ's `BaseSyncScrollable.transferLine` does (a line after a change moves by the lines the
  change gained; one in a change goes as far into the right's lines, at most to their end; a line
  just after lines added goes to the first of them, as IntelliJ's). The side last focused is the
  current one, the right to start with. A deleted file's diff goes nowhere. A turn's diff goes to the
  file as it is now, at the snapshot's line: it may have changed since (a claim that this is what
  IntelliJ's history diffs do).
- **Not done:** staging, and refreshing a diff while it shows. Reverting came with the toolbar (see
  "The Commit tool window's toolbar"); committing later (see "Committing from the Commit tool
  window", 2026-11-02).
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
