# Backlog

Work to do, tracked here rather than in GitHub issues, which are for other people's reports (Ido,
2026-10-26). An item goes when it's done; the stages and their order are in `decisions.md` ("A
basic IDE before git and agent management").

## To fix soon

### Several Claude sessions, as tabs (to design later)

Raised by Ido (2026-10-26): IntelliJ lets several Claude Code sessions open as tabs. Ido: "that's
something we can get to designing a bit later on". It needs a design before it's built; the
Terminal tool window's tabs (decision "Several terminals") are the pieces to reuse.

### Local History

From Ido (2026-10-27, "yes", when asked whether to add it): there's no undo for what happens to
files outside the editor. The editor's undo is per file and lives only while its document does.
Saving, Replace in Files, Rollback and an agent's edits can't be taken back. IntelliJ's Local
History keeps each file's versions, labelled by what changed them, to compare and revert to.

### Polish

- **Icons per file type** in the Project tree (and wherever files are listed: tabs, Go to File,
  Recent Files), as IntelliJ's. From Ido (2026-10-27), with a screenshot of the tree: "missing
  icons per file type - but don't work on the icons now just add it to the list of things to
  polish".

## Known gaps

- **Editing:** see "Not yet" in the decision "Editing and saving".
- **The macOS menu bar with several windows** is the menu of the window that last sent one, not of
  the focused one.
- **The agent e2e test's turn sometimes didn't expand** (3 runs in 9 locally: its file row never
  showed; cause not found). The test double-clicks again until the turn shows expanded. If it's a
  real bug, users could hit it too.
- **The Python e2e test's go to definition sometimes fails on Windows in CI** (#78 twice, #82 once):
  Ctrl+B never reaches lib.py in 30 s, while the host, asked directly then, answers the definition
  in 1 ms. The test now also prints where the page is (tab, line, focus, popup) when it fails.
