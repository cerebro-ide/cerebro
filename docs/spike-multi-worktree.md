# Spike: is running many worktrees solvable?

**Status: planned, not run.** It must run on a development machine, **not the NAS** (see
`CLAUDE.md`).

## Question

Can Cerebro serve many worktrees of a large repo with fast search and navigation in each, without
re-indexing shared files or running a language server per worktree?

## Test repo

[ag-charts](https://github.com/ag-grid/ag-charts), Ido's work repo (public). Facts measured on
2026-10-25 via the GitHub API: default branch `latest`, main language TypeScript, repo size about
2.2 GB including history.

## Setup

1. A partial clone (`git clone --filter=blob:none`) plus 2–3 worktrees on different branches or
   commits.
2. `npm install` in each worktree (tsserver needs dependency types to give realistic numbers).
   Expect several GB per worktree.
3. tsserver (via vtsls or typescript-language-server) and tree-sitter, installed inside the spike
   folder only, nothing global.

## Measurements

| # | measure | answers |
|---|---|---|
| 1 | Share of file content identical across the worktrees (compare git blob hashes, tracked files) | How much a blob-hash index saves |
| 2 | tsserver cold start time and memory (RSS) per worktree, until find-usages first answers | Cost of a warm language server, and so how big the lazy pool can be |
| 3 | Tree-sitter index build time: from scratch, then for an extra worktree reusing it | Whether a new worktree really is instant |
| 4 | Quality of name-based go to definition / find usages against tsserver's answers, on a sample of symbols | Whether the fallback is good enough while tsserver warms up |

Result: a table of the numbers, and a verdict on whether the approach in `architecture.md` holds.
