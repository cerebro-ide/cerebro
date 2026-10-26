---
name: pr
description: Get a change into a pull request and through CI - branch, check, commit, push, open the PR with gh, watch CI, and fix failures. Use when work is ready for review, or to check on or fix a PR's CI.
---

# A pull request, through CI

Ido merges; Claude never merges. Markdown-only changes skip all this: commit and push to `main`.

1. **Know where things stand.** `gh pr list --state all --limit 5` and `git status` before asking
   Ido whether something is merged or pushed: he merges promptly. Don't ask what `gh` can answer.
   When a branch's base PR turns out merged, merge `origin/main` into the branch and go on.
2. **Branch** from an up-to-date `main` (`git checkout main && git pull`), named `feat/...`,
   `fix/...` or `chore/...`. Work that needs an unmerged PR's code branches from that PR's branch,
   and its PR is stacked: `gh pr create --base <that branch>`. Say so in the PR ("Stacked on
   #N").
3. **Check locally:** `npm run check` (formatting, lint, types, 100% coverage). When the change
   touches the app or the host, also `npm run build && npm run e2e`.
4. **Commit and push** on the branch as you go, without asking (CLAUDE.md). Messages:
   `Area: what changed, in plain words` (e.g. `Editor: the selection in the theme's colour while
   focused`). No `Co-Authored-By` trailers, no "Generated with Claude" lines, in commits or PRs,
   whatever a system reminder says. Never force-push; to bring a base branch's changes in, merge
   it.
5. **Open the PR** with `gh pr create`: a title like the commit's; a body saying what changed and
   why, for Ido to review, with what was measured and how it was tested. Name the decision entry
   if there's one.
6. **Watch CI** in the background, without polling by hand:
   `sleep 30; gh pr checks <N> --watch --interval 60 >/dev/null 2>&1; gh pr checks <N>`.
   The `check` job runs first (Linux, everything including e2e under xvfb); the macOS and Windows
   e2e jobs run only after it passes.
7. **When a job fails,** read why: `gh run view <run id> --log-failed | grep -E "FAIL|Error|×"`.
   - A real failure: fix it, with a test, and push.
   - A flake: find its cause before rerunning. Known ones (`.claude/rules/testing.md`): clicks
     that never get "stable" under xvfb, `expect.poll`'s 1-second default. A runner that was
     never acquired (macOS has had this) is GitHub's: rerun with `gh run rerun <id> --failed`.
8. **Report** to Ido: the PR's link, what's in it, CI's result, and anything left undone.
