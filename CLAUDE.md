# Cerebro

Ido's project: a free, standalone IDE for inspecting code and managing AI agents' work. Read
`README.md` first, then the index of `docs/decisions.md` (and the entries that bear on the work)
before proposing anything that contradicts a decision.

More instructions load when they apply: `.claude/rules/` for parts of the code (tests, UI, host,
dependencies, docs), and skills for procedures: `/pr` (a change through review and CI), `/qa` (see
it in the real app), `/decision` (record a decision).

## Where this repo lives

- The canonical copy also sits on Ido's homelab NAS (`/home/claude/repos/cerebro`) so a Claude
  session there can work on it any time; the NAS is always on, his other machines are not.
- **The NAS is not a development environment for this project.** Never install this project's
  tooling there: no `npm install`, no language servers, no clones of test repos, no builds. On the
  NAS, work on docs and code text only. Development and the spike run on another machine.
- Testing against repos stored on the NAS (remote mode) comes later, and only when Ido asks.

## Working rules

- Do exactly what Ido asked; if unclear, ask. Don't fill in what he didn't say, and don't swap in
  your own judgment for his: if an instruction seems wrong or can't be followed, ask before doing
  anything else. An instruction applies to the task it was given for, unless he says it's standing.
- Commit only when asked; a commit is always pushed in the same step.
- On a feature branch, Claude commits and pushes as it goes, without asking each time (Ido,
  2026-10-25, after a WSL update ended a session with uncommitted work on disk).
- Changes go through a pull request: commit on a branch, push it, open a PR with `gh`. CI runs on
  it, and Ido merges; Claude never merges.
- Until code review starts, a PR may bundle several commits: no need for a PR per commit.
- Exception: a change that touches only Markdown files may be committed and pushed straight to
  `main`. PRs are mostly for CI, and Markdown files don't go through CI.
- Work to do is tracked in `docs/backlog.md`, not GitHub issues: issues are only for other people
  reporting problems (Ido, 2026-10-26).
- No "Generated with Claude" footers or `Co-Authored-By` trailers in commits, PRs or issues.
- Proof is a measurement or official documentation; anything else is labelled as a claim.
- **Fix the cause, not the symptom.** Find out why it fails before changing anything: a log, a
  measurement, or a test that fails. Then fix what's wrong, in the app or in the test, whichever it
  is. A longer wait or a retry is a fix only when the measured cause is that something is slow. A
  bug in a dependency may be worked around, labelled, with what was measured. When the cause can't
  be found yet, adding output that will show it next time is the next step, and the gap goes in
  `docs/backlog.md`. Don't present a guess as the cause. If the cause lies outside the task, say so
  before fixing it.
- **If a test can be added, it's added.** Every fix comes with a test that fails without it, a
  workaround for a dependency's bug included. So does every change whose behaviour a test can
  check. Tests are how we gain confidence that a change breaks nothing else. A fix that can't be
  tested says why.
- **When the plan stops holding, re-plan.** When a measurement disproves an assumption, or the same
  approach fails twice, don't push on with it. Work out a new plan from what's now known and
  continue. The new plan changes how, not what: if it would change what Ido gets (scope, behaviour,
  a decision), that's his call (see the first rule). Say what changed when reporting, and in
  `docs/decisions.md` when it changes a decision.
- **The change that fits the whole, and no more.** Before calling a change done, check it against
  the code around it: does it reuse what's there, follow the patterns already used, and sit where a
  reader would look for it? Sometimes that's the smallest change. Sometimes it means reshaping
  what's there so the new case isn't a special one, as the error stripe became one piece shared by
  usages and problems. A special case, a flag, or a comment that explains a workaround is a sign to
  look again. Don't over-engineer:
  - no abstraction until there's a second real use;
  - no options, hooks or layers for cases nobody has asked for;
  - reshaping beyond what the task needs is proposed first, or goes in the backlog.
- When a decision changes, update `docs/decisions.md` and say why.
