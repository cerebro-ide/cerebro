# Cerebro

Ido's project: a free, standalone IDE for inspecting code and managing AI agents' work. Read
`README.md` first, then `docs/decisions.md` before proposing anything that contradicts a decision.

## Where this repo lives

- The canonical copy also sits on Ido's homelab NAS (`/home/claude/repos/cerebro`) so a Claude
  session there can work on it any time; the NAS is always on, his other machines are not.
- **The NAS is not a development environment for this project.** Never install this project's
  tooling there: no `npm install`, no language servers, no clones of test repos, no builds. On the
  NAS, work on docs and code text only. Development and the spike run on another machine.
- Testing against repos stored on the NAS (remote mode) comes later, and only when Ido asks.

## Working rules

- Do exactly what Ido asked; if unclear, ask. Don't fill in what he didn't say.
- Commit only when asked; a commit is always pushed in the same step.
- No "Generated with Claude" footers or `Co-Authored-By` trailers in commits, PRs or issues.
- Proof is a measurement or official documentation; anything else is labelled as a claim.
- When a decision changes, update `docs/decisions.md` and say why.
