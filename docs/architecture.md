# Architecture (draft)

Nothing here is built or measured yet. It records the shape agreed in the brainstorm and the
reasoning behind it.

## Code principles

We don't yet know what the final product will look like, so the code must be **modular, clean,
decoupled and extensible**, and it must **support plugins**. Every part of it should be
replaceable or extendable without rewriting the rest. That includes views and panels, language
support, agent CLIs, index backends and git features.

## Processes

```
Electron UI  ──(one protocol; local, or over an SSH tunnel)──  Host (Node)
                                                                 ├─ file system + git
                                                                 ├─ shared index (tree-sitter, keyed by blob hash)
                                                                 ├─ language server pool
                                                                 ├─ agent terminals (node-pty running `claude`, later other CLIs)
                                                                 └─ session DB (worktree → session ID, state)
```

- The UI never touches the file system; everything goes through the host.
- The host runs next to the repos (laptop or server), so the index and language servers stay
  local to the files, and only results cross the network.

## Indexing across worktrees

- Worktrees of one repo share git objects, so most files across worktrees are byte-identical and
  have the same blob hash.
- The index is keyed by blob hash: each distinct file content is parsed once (tree-sitter: symbols,
  definitions, references by name), and a worktree's index is a mapping from path to blob hash.
- A new worktree only parses the files whose content is new. Uncommitted edits are hashed the same
  way.
- This gives instant file, symbol and text search and name-based navigation in every worktree, cold
  or warm.

## Language servers

- Precise answers (type-aware go to definition, find usages) come from language servers.
- Language servers are not built to share an index across worktrees, and one tsserver per worktree
  costs hundreds of MB (a claim, to be measured in the spike).
- So the host runs a **lazy pool**: a server starts when the human opens a worktree for inspection,
  stays warm while it's active, and is shut down when idle. Agents don't use these servers.
- While a server warms up, the shared index answers by name. Whether that's good enough is the open
  risk the spike measures.

## Agent sessions

- Each worktree is bound to a session. The host starts the agent CLI in a terminal, records its
  session ID, and can restart it on a CLI update and resume (`claude --resume <id>`).
- Structured events (what the agent changed, when a turn ends) come from the CLI's hooks.
- IDE-wide skills and instructions are placed where the CLI loads them (for Claude Code: user-level
  `CLAUDE.md`, skills, plugins).
