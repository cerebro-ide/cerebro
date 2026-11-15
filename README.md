# Cerebro

An IDE that is not built around *writing* code but around **inspecting code and managing the
work of AI agents**.

**Status:** phase 1, a copy of WebStorm's functionality (decision "Phase 1 is WebStorm's
functionality"). Built so far, in the desktop app:

- IntelliJ's window: menus, tool windows, the editor area's tabs and splits, the status bar;
- the editor, with language servers: completion, go to definition, find usages, rename;
- search and navigation over an index shared by a repository's worktrees;
- git as IntelliJ's: commit, log, branches, blame, conflicts, shelf, push and pull;
- terminals, and an agent's session per worktree, with what each turn changed.

`docs/decisions.md` records each part as it was built.

Most coding is now done by agents. What the human still needs is fast access to both high-level
and low-level inspection of that work: which agent is doing what in which worktree, what it
changed, and the ability to drop straight into the code to check it. No single feature here is
unique; the strength is combining them in one focused, simple tool.

## Goals

- **IntelliJ-style GUI**: the same menus, docked panels and overall feel (Ido built a tool like
  this himself about ten years ago, at a company that no longer exists, also named Cerebro).
- **Built for worktrees**: many checkouts of the same repo, indexed once and shared, with the same
  IDE configuration across all of them.
- **IntelliJ-grade search and navigation**: find file, class, symbol and text; go to definition;
  find usages.
- **IntelliJ-grade git**: 3-way conflict resolution, blame, history.
- **Agent management**: each worktree bound to an agent session automatically; sessions survive
  CLI updates (restart and resume); IDE-wide skills and instructions every session gets.
- **Grows from there**: kanban board for agents, dedicated views for inspecting agent changes.
- **Free to use** and standalone: no IntelliJ licence, not a VS Code fork.
- **Local and remote**: run against repos on the local machine, or connect to a server (such as
  the NAS) and work against repos stored there.

## Try it

```
npm install
npm run dev
```

Then open the address it prints (`http://localhost:5173`) in a browser. In a browser there's no
host, so the page shows sample worktrees with sample files; the desktop app is the real thing.

Or run the same page in the desktop app, reloading as the code changes:

```
npm run app
```

## Test it

```
npm run check   # formatting, lint, types, and the unit tests with coverage
npm run e2e     # builds the desktop app and drives it end to end (needs a display)
```

## Docs

| file | what's in it |
|---|---|
| [docs/features.md](docs/features.md) | the feature list, with notes on each |
| [docs/decisions.md](docs/decisions.md) | what has been decided, and why |
| [docs/architecture.md](docs/architecture.md) | code principles, packages, host/UI split, UI, indexing, language servers |
| [docs/plan-v1.md](docs/plan-v1.md) | the first version's milestones |
| [docs/spike-multi-worktree.md](docs/spike-multi-worktree.md) | the first experiment: is running many worktrees solvable? (done: yes) |
| [docs/open-questions.md](docs/open-questions.md) | what is still undecided |
| [docs/brainstorm-log.md](docs/brainstorm-log.md) | the conversations so far: Ido's messages verbatim, Claude's replies summarised |
