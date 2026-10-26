---
name: decision
description: Add or update an entry in docs/decisions.md, in its format, with the index at its top kept in step. Use when a decision is made or changed, including when work departs from docs/plan-v1.md.
---

# Recording a decision

CLAUDE.md: when a decision changes, update `docs/decisions.md` and say why.

1. **Find the entry** in the index at the top of `docs/decisions.md`. A change to an existing
   decision updates that entry: say what changed, when (`(changed YYYY-MM-DD)`), and why; keep what
   was rejected before, and why, unless it no longer holds.
2. **A new entry** goes above the newest one, as `## Title (YYYY-MM-DD)`, with today's date:
   - a line on what it's for (the milestone, or Ido's request, quoted when it was his);
   - bullets with a bold lead: what was decided, why, and what was rejected;
   - what's measured says so (or names the source); anything else is a claim;
   - Claude's own choices are marked open to change; Ido's are attributed to him;
   - **Not yet:** what's left out, when something is.
3. **The index:** add or update its line: `- [Title](#anchor): one line`. The anchor is GitHub's:
   the heading in lower case, punctuation dropped, spaces as hyphens.
4. It's Markdown: commit it with the change it belongs to, or alone straight to `main`.
