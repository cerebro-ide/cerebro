# Features

Ido's early list, in his order, with notes from the brainstorm. "First version" marks what is in
scope for the first release (see `decisions.md`).

## 1. IntelliJ-style GUI — first version

Imitate IntelliJ's menus, docked tool windows and layout. Ido has built this before. Cerebro
writes its own components, docking included, without a UI framework. The editor is CodeMirror 6;
the diff views are Cerebro's own, on top of it (see `decisions.md`).

### The window's parts (Ido, 2026-10-25)

- **Menu bar**, like an OS menu: File, Edit and so on.
  - Mnemonic letters, as in existing OSes: Alt plus a letter opens a menu (for example Alt+O).
  - Items that open a dialog end with `…`; others don't.
  - Menus can nest.
  - It can be hidden by default, as IntelliJ's new UI does, which Ido calls a very nice feature.
- **Context menus** are built on the same menus and offer the same features.
- **A main toolbar** at the top, like IntelliJ's, with branch and worktree selection.
- **Two layers of tabs:** one for environments (a worktree with its session), and inside each, the
  file tabs.
  - Switching environment tabs switches the editor area and the tool windows' contents (project
    tree, terminal, changes): each environment has its own. The tool-window layout (which windows
    sit where) is IDE-wide, so the window doesn't rearrange on a switch. (Claude's proposal, which
    Ido confirmed: "that's what i had in mind".)
- **Keyboard navigation and shortcuts everywhere**, and the shortcuts are configurable.
- **A status bar** at the bottom. Its contents are to be discussed; like IntelliJ's, it will
  probably show running background tasks, services, and basic information about the active
  environment, session and file.

## 2. Indexing shared across worktrees — first version (via the spike)

Opening a new worktree should not re-index files that are identical to ones already indexed.
Worktrees of one repo share git objects, so an index keyed by **git blob hash** indexes each
distinct file content once. See `architecture.md` and `spike-multi-worktree.md`.

## 3. Same menu structure and IDE config across projects and worktrees

Configuration is shared rather than per-checkout. Mostly a matter of where settings live and how
they are layered (global → repo → worktree).

## 4. Search and navigation — first version

The IntelliJ features Ido uses most: search by file, class, method/symbol and text; click a usage
to jump to its definition; click a definition to see its usages.

Initial languages, **all in the first version**: TypeScript, HTML, CSS, Markdown, Bash, Python,
YAML, JSON (more later). All of these have existing language servers, so this is integration
work:

| language | language server |
|---|---|
| TypeScript / JavaScript | vtsls or typescript-language-server (both wrap tsserver) |
| HTML, CSS, JSON | the VS Code language servers (vscode-langservers-extracted) |
| Markdown | marksman |
| Bash | bash-language-server |
| Python | basedpyright or pyright |
| YAML | yaml-language-server |

## 5. Git — blame first version, merge later

The other IntelliJ feature family Ido relies on: git management, including **3-way diff conflict
resolution** and **blame view**.

## 6. Worktree ↔ agent session binding — first version

Each worktree is connected to an agent session automatically. When the agent CLI (Claude Code) has
an update, the session can be restarted onto the new version and resumed immediately, so Cerebro
keeps a small database of sessions (worktree → session ID, state). Claude Code already stores
transcripts per directory and supports `--resume <session-id>`.

## 7. IDE-wide skills and instructions

Skills and instructions defined once at the IDE level that every session loads automatically, or
can reach when needed. Claude Code already loads user-level `CLAUDE.md`, skills and plugins;
Cerebro's job is to manage and distribute them, and later to map them onto other agent CLIs.

## 8. Agent change inspection views — first version (core)

A view of what an agent changed in a worktree (since the session started, per turn, per commit),
with fast movement between the high level (which files, which tasks) and the low level (the diff,
then the code with full navigation).

## 9. Kanban board for agents — later

Manage agents' tasks as a board: what each agent is working on, in which worktree, its status.

## Not goals

- Being a code *writing* IDE first. Editing exists, but the focus is inspection and agent
  management.
- Extending IntelliJ or VS Code (see `decisions.md`).
