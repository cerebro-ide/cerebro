# Decisions

Agreed during the 2026-10-25 brainstorm unless dated otherwise. Each entry: the decision, why, and
what was rejected.

## A standalone app, not a plugin or a fork

- **Not a JetBrains plugin.** A plugin limits the UX Cerebro is after and forces every user to pay
  for an IntelliJ licence; Cerebro should be free to use.
- **Not a VS Code fork or extension.** Inheriting a large IDE loses the edge of a simple tool that
  doesn't defocus the user. Open-source building blocks (Monaco, CodeMirror, language servers) are
  used instead.
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
before committing. Approach (to be validated by the spike):

- agents use their own tools, not Cerebro's language servers, so only worktrees the human is
  inspecting need one: a lazy pool, warm servers for active worktrees, idle ones shut down;
- a Cerebro-owned tree-sitter index keyed by git blob hash, shared across worktrees, gives instant
  search and name-based navigation everywhere, including cold worktrees.

## First version scope

The GUI, the worktree list with each worktree bound to a resumable session, the agent change
inspection view, and navigation (go to definition, find usages) through language servers.
Kanban, 3-way merge and the rest come after.

## Name: Cerebro

The name Ido used for his earlier tool. Fine while private; check before publishing (see
`open-questions.md`).

## Where it lives and where it's developed

- Private GitHub repo `iMoses/cerebro`; a copy on the NAS so a session there can work on it any
  time (the NAS is always on).
- **No tooling for this project is installed on the NAS**; it isn't a proper development
  environment. Development and the spike run on another machine. Testing against repos stored on
  the NAS comes later.

## Goal: a tool first, ideally published

Primarily a tool for Ido, ideally published so others find it useful. Ido is willing to spend time
on it and has spare Claude subscription capacity to put into it.
