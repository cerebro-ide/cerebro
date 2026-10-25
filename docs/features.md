# Features

Ido's early list, in his order, with notes from the brainstorm. "First version" marks what is in
scope for the first release (see `decisions.md`).

## 1. IntelliJ-style GUI — first version

Imitate IntelliJ's menus, docked tool windows and layout. Ido has built this before. Docking can
start from an existing library (candidates: dockview, FlexLayout; not evaluated yet). The editor
and diff views can be built on Monaco or CodeMirror rather than inheriting a whole IDE.

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

Initial languages: TypeScript, HTML, CSS, Markdown, Bash, Python, YAML, JSON (more later). All of
these have existing language servers, so this is integration work:

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
