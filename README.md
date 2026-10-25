# Cerebro

An IDE that is not built around *writing* code but around **inspecting code and managing the
work of AI agents**. Status: milestone 1 of the first version (`docs/plan-v1.md`) in progress; the
reactive core, the JSX runtime, the layout model and the first part of the layout view are done.

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

Then open the address it prints (`http://localhost:5173`) in a browser. The playground shows the
window layout with sample tool windows.

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
