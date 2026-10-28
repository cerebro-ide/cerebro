# Backlog

Work to do, tracked here rather than in GitHub issues, which are for other people's reports (Ido,
2026-10-26). An item goes when it's done; the stages and their order are in `decisions.md` ("A
basic IDE before git and agent management").

## To fix soon

### Several Claude sessions, as tabs (to design later)

Raised by Ido (2026-10-26): IntelliJ lets several Claude Code sessions open as tabs. Ido: "that's
something we can get to designing a bit later on". It needs a design before it's built; the
Terminal tool window's tabs (decision "Several terminals") are the pieces to reuse.

### Keymaps: configurable, with IntelliJ's ready-made ones to choose from

From Ido (2026-10-26), with a screenshot of IntelliJ's Settings → Keymap: "not only should keymapping
be configurable, but similar to intellij I want to offer out of the box multiple keymaps based on
common known configurations".

- **Configurable:** the user changes any action's shortcuts, as in IntelliJ's Keymap page.
- **Ready-made keymaps to start from,** chosen from a dropdown, as IntelliJ's list: Eclipse, Eclipse
  (macOS), Emacs, IntelliJ IDEA Classic, macOS System Shortcuts, NetBeans, Sublime Text, Sublime Text
  (macOS), Visual Studio, Visual Studio (macOS), VSCode, alongside the default one (IntelliJ's for
  each platform).
- **Step 1 done (2026-10-27):** IntelliJ's and VS Code's, for Windows and Linux and for macOS
  (decision "Ready-made keymaps"). Left: changing keys in the Keymap page, and the other keymaps.

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
- **Go to File and the index in a folder without git:** they read git's file list. With ripgrep, in
  the search step.
- **The macOS menu bar with several windows** is the menu of the window that last sent one, not of
  the focused one.
- **The Project tree doesn't show files added on disk** until it's opened again (seen in QA).
- **The agent e2e test's turn sometimes didn't expand** (3 runs in 9 locally: its file row never
  showed; cause not found). The test double-clicks again until the turn shows expanded. If it's a
  real bug, users could hit it too.
