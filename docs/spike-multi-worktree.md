# Spike: is running many worktrees solvable?

**Status: run on 2026-10-25 on iMoses-PC (WSL2), not the NAS.** Scripts are in `spike/`; the
worktrees and logs are in `spike/work/` (gitignored).

## Question

Can Cerebro serve many worktrees of a large repo with fast search and navigation in each, without
re-indexing shared files or running a language server per worktree?

## Test repo

[ag-charts](https://github.com/ag-grid/ag-charts), Ido's work repo (public). Facts measured on
2026-10-25 via the GitHub API: default branch `latest`, main language TypeScript, repo size about
2.2 GB including history.

## Setup (as run)

The plan was a fresh partial clone. Ido chose to use his existing clone (`~/workspace/ag-charts`)
instead, so the worktrees were added to it.

- Machine: 8 cores, 15.6 GB RAM, WSL2 on Windows, Ubuntu 20.04, ext4.
- Node 24.22.1 (installed globally; ag-charts requires `^24`). TypeScript 5.8.3, from each
  worktree's own `node_modules`.
- Three detached worktrees, spread like parallel agent branches:

  | worktree | commit | date |
  |---|---|---|
  | `wt-latest` | `42c05d7caf` | 2026-10-23 |
  | `wt-1w` | `0304cf455d` | 2026-10-16 |
  | `wt-1m` | `ffaeb28543` | 2026-09-24 |

- Dependencies: `yarn install` per worktree, about 25 s each with a warm Yarn cache, 2.2–2.5 GB of
  `node_modules` each. `wt-1m` predates the move to Yarn 4 and installed with Yarn 1 (244 s).
- tsserver driven directly over its stdio protocol (`spike/tsserver-client.mjs`), automatic type
  acquisition off, default heap limit. RSS is the server's whole process tree, sampled every 100 ms.
- Tree-sitter through **web-tree-sitter 0.25.10 (WASM)**, grammars `tree-sitter-typescript` 0.23.2
  and `tree-sitter-javascript` 0.23.1. The native `tree-sitter` package has no Linux prebuild and
  doesn't compile with Ubuntu 20.04's g++ 9 (no `-std=gnu++20`); native parsing would be faster, so
  the WASM numbers are an upper bound.
- The index (`spike/blob-index.mjs`) covers tracked TS/TSX/JS files only. Per distinct blob it keeps
  definitions (the upstream `tags.scm` queries plus type aliases, enums, class fields and top-level
  constants) and every identifier occurrence grouped by name.
- All runs had the OS file cache warm (dropping it needs root). A first open from a cold disk will
  be slower.

## Results

### 1. Identical file content across worktrees (`m1-blob-overlap.sh`)

All tracked files, compared with `wt-latest` by blob hash:

| worktree | files | blobs not in `wt-latest` | same files | same bytes |
|---|---|---|---|---|
| wt-latest | 12,552 | 0 | 100% | 100% |
| wt-1w | 12,386 | 649 | 94.7% | 94.9% |
| wt-1m | 11,361 | 1,988 | 82.2% | 88.3% |

The three worktrees hold 36,299 file entries but only 13,060 distinct blobs: a blob-keyed index
parses 64% less than indexing each worktree on its own, and the saving grows with each worktree.

### 2. tsserver cold start and memory (`m2-tsserver-cold.mjs`)

Query: find usages of `BBox` (`ag-charts-core`, used across the repo).

tsserver only searches the projects it has loaded. With only the file's own package loaded, it found
190 references in 27 files. Loading every package (opening each `packages/*/src/main.ts`) found 922
references in 170 files, which is the IntelliJ-style answer. The table uses the second setup.

| worktree | cold start → first find-usages | next query | RSS |
|---|---|---|---|
| wt-latest (3 runs) | 6.8–6.9 s | 87–90 ms | 1,035–1,047 MB |
| wt-1w | 7.2 s | 85 ms | 1,032 MB |
| wt-1m | 7.1 s | 77 ms | 1,069 MB |
| all three started together | 7.9–8.4 s each | 80–126 ms | 1,035–1,060 MB each |

With one package loaded: 3.3 s cold, about 25 ms per query, about 465 MB.

### 3. Tree-sitter index build (`m3-index-build.mjs`, `m3-parallel-build.mjs`, `m3-profile-split.mjs`)

Indexed in order, each worktree reusing what the previous ones parsed (single thread):

| worktree | source files | parsed | reused | parsed MB | time |
|---|---|---|---|---|---|
| wt-latest (from scratch) | 5,149 | 4,628 | 521 | 37.8 | 12.3 s |
| wt-1w | 5,053 | 512 | 4,541 | 11.0 | 3.9 s |
| wt-1m | 4,468 | 1,261 | 3,207 | 14.5 | 5.0 s |
| a worktree at an indexed commit | 5,149 | 0 | 5,149 | 0 | 25 ms |

- Cost follows bytes, about 3 MB/s per thread; the files that changed in a week are larger than
  average (about 21 KB against 8 KB).
- Time splits about 55% parsing, 45% the two queries.
- From scratch with worker threads: 12.7 s on 1, 4.1 s on 4, 2.7 s on 8.
- `wt-latest` reuses 521 blobs from itself: identical files at different paths.
- All three worktrees: 6,401 distinct blobs, 76,355 definitions, 2.33 M identifier occurrences;
  239 MB of heap, 25 MB serialized (write 151 ms, load 252 ms).

### 4. Name-based navigation against tsserver (`m4-name-vs-tsserver.mjs`, `m4-explain-misses.mjs`)

80 definitions sampled from the core, community and enterprise sources (seeded, 10 per kind), on
`wt-latest`. tsserver had every package loaded; both sides are limited to the 1,217 files in
tsserver's projects (tests are outside them).

- **Find usages**, name-based hits against tsserver's references:
  - recall: 100% overall, at least 95% for every kind;
  - precision: median per symbol 100% for every kind except fields (64%); pooled over all hits
    it's 10%, dominated by a few common names (field `type`: 2,692 name hits against 1 real
    reference; `height`: 2,906 against 3);
  - name-based matched tsserver's set exactly for 68% of symbols (classes and interfaces 80%,
    fields 30%).
- **Go to definition** from up to 3 usage sites per symbol (230 sites):
  - tsserver's target was among the name-based candidates at 96% of sites;
  - it was the only candidate at 76% (classes 100%, interfaces 96%, methods 28%);
  - median candidates per name: 1 (methods 3).
- **The misses:**
  - recall: `this` inside a static method, which tsserver counts as a class reference, and a
    `{@link}` in a JSDoc comment;
  - go to definition: names whose definition is an object-literal member or interface property
    (`update`, `action`), which the index doesn't record as definitions.
- **Warm tsserver:** a find-usages query took a median of 16 ms on these symbols.

## Verdict

The approach in `architecture.md` holds for ag-charts on this machine.

- **Sharing the index works.** A worktree at an already-indexed commit takes 25 ms, and a worktree a
  week away needs about 10% of its files parsed. The one-time from-scratch build is 2.7 s on 8
  threads, even with WASM.
- **A lazy pool of tsservers is affordable.** A warm whole-repo tsserver costs about 1 GB and
  answers in tens of milliseconds. Three ran side by side at 3.1 GB of 15.6 GB.
  - Claim, not measured: about 4–6 warm servers fit on a 16 GB laptop next to the rest of the
    system.
- **The fallback carries the warm-up.** tsserver takes about 7 s to answer the first query in a
  worktree. Until then, name-based results:
  - find almost every real reference;
  - are exact for type-level names (classes, interfaces, types, enums);
  - are noisy for common member names, so those results should be labelled as name matches and
    replaced by tsserver's answer once it's warm.

## Problems met on the way

- Ido's global `~/.gitconfig` sets `core.autocrlf=true`, so checkouts get CRLF and the repo's
  bash scripts fail ("command not found"). The spike worktrees were re-checked out with LF for
  that command only; the global setting is unchanged. Cerebro will meet repos and configs like
  this.
- `wt-1m`'s Yarn 1 install ran ag-charts' postinstall scripts:
  - one set `core.hooksPath` in the main clone's git config to a folder inside `wt-1m`; there was
    none before, and it was unset again afterwards;
  - one created an empty `~/.cache/ag-dev-prompts` (its clone failed on auth), now removed;
  - one ran `pkill -f "nx dev"`, which may have stopped an `nx dev` process if one was running.

  The Yarn 4 installs used `--mode=skip-build` to avoid these.

## Not measured

- Cold-disk timings, native tree-sitter, and the other languages (HTML, CSS, Markdown, Bash,
  Python, YAML, JSON).
- Memory of a full IntelliJ-style session: language servers for those languages, the Electron UI,
  and the agents themselves.
- Uncommitted edits: the index used the committed blob hashes of clean worktrees.
