# Backlog

Work to do, tracked here rather than in GitHub issues, which are for other people's reports (Ido,
2026-10-26). An item goes when it's done; the stages and their order are in `decisions.md` ("A
basic IDE before git and agent management").

## To fix soon

### Several Claude sessions, as tabs (to design later)

Raised by Ido (2026-10-26): IntelliJ lets several Claude Code sessions open as tabs. Ido: "that's
something we can get to designing a bit later on". It needs a design before it's built; the
Terminal tool window's tabs (decision "Several terminals") are the pieces to reuse.

### Agent Changes, aware of several sessions

From Ido (2026-11-03), on the Agent Changes tool window: "we could have multiple sessions per
project/worktree and so the changes window needs to be aware of this". Not to work on now. Turns
are listed per worktree, whichever session they came from; with several Claude sessions as tabs
(above), the window needs to tell them apart.

### Polish

- **Icons per file type** in the Project tree (and wherever files are listed: tabs, Go to File,
  Recent Files), as IntelliJ's. From Ido (2026-10-27), with a screenshot of the tree: "missing
  icons per file type - but don't work on the icons now just add it to the list of things to
  polish".

## Known gaps

- **Editing:** see "Not yet" in the decision "Editing and saving".
- **Errors and warnings:** see "Not yet" in the decision "Errors and warnings in the editor" (the
  Problems tool window, the file's status in its tab and the Project tree, shell scripts).
- **The macOS menu bar with several windows** is the menu of the window that last sent one, not of
  the focused one.
- **The agent e2e test's turn sometimes didn't expand** (3 runs in 9 locally: its file row never
  showed; cause not found). The test double-clicks again until the turn shows expanded. If it's a
  real bug, users could hit it too.
- **The Python e2e test's go to definition sometimes fails on Windows in CI** (#78 twice, #82 once):
  Ctrl+B never reaches lib.py in 30 s, while the host, asked directly then, answers the definition
  in 1 ms. The test now also prints where the page is (tab, line, focus, popup) when it fails.
  #103's run showed it in lib.py at the definition, under a name-match popup: the answer came after
  the test's check, and the test pressed Ctrl+B again from there. The test now checks before
  pressing again (2026-11-02); that this was the whole cause is a claim until Windows runs stay
  green. #104's run showed the other side of it: a second press's late answer took the next test
  back to lib.sh. After more than one press, the test now waits out the host's 3 s (2026-11-03).
  #111's run (and one of #109's) failed every test after the shell one on Windows: Go to File
  never showed, after the shell test pressed Ctrl+B more than once. That a late name-match popup
  was left open is a claim; the tests now print and close a popup left open before Go to File.
