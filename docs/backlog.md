# Backlog

Work to do, tracked here rather than in GitHub issues, which are for other people's reports (Ido,
2026-10-26). An item goes when it's done; the stages and their order are in `decisions.md` ("A
basic IDE before git and agent management").

## To fix soon

### Tabs that don't fit: a dropdown listing them, and a fade at the cut edge, for every tab bar

Reported by Ido (2026-10-26), with screenshots of IntelliJ. When there isn't room for every tab,
IntelliJ:

- shows a chevron dropdown after the tabs, listing every tab with its icon and a close button, the
  active one highlighted;
- fades the last visible tab at the cut edge.

Today the tabs are cut off (an editor tab shows as "pack…", with no way to reach the rest). This
applies to every tab bar: editor tabs, and tool windows' tabs such as the Terminal's.

### Several terminals in the Terminal tool window (and, to design later, several Claude sessions)

Raised by Ido (2026-10-26), with a screenshot of IntelliJ's Terminal tool window.

- **The Terminal tool window holds several terminals, as tabs:** a + button to open another, and a
  dropdown beside it, as IntelliJ's. Its tabs overflow as every tab bar should (above).
- **Several Claude tabs:** IntelliJ also lets several Claude Code sessions open as tabs. Ido:
  "that's something we can get to designing a bit later on". It needs a design before it's built.

### Themes: match Islands Light, name them Islands Dark and Islands Light, choose them in Settings

From Ido (2026-10-26), with a screenshot of IntelliJ's light theme and its Settings dialog.

- **Match the light theme to IntelliJ's "Islands Light",** with that screenshot as the reference,
  as the dark theme was matched to Islands Dark. Today's light theme approximates IntelliJ's new UI
  and wasn't measured.
- **Names:** "Islands Dark" and "Islands Light". IntelliJ also has plain "Dark" and "Light",
  without the islands' rounded corners. Ido: "MAYBE we'll do in the future, but for now these are
  fine."
- **Where it's chosen, as in IntelliJ's Settings:** Appearance & Behavior → Appearance → Theme, a
  dropdown, with a "Sync with OS" checkbox beside it. Cerebro's Settings has an Appearance page
  with a Theme setting already; it should follow this layout and naming.

### Keymaps: configurable, with IntelliJ's ready-made ones to choose from

From Ido (2026-10-26), with a screenshot of IntelliJ's Settings → Keymap: "not only should keymapping
be configurable, but similar to intellij I want to offer out of the box multiple keymaps based on
common known configurations".

- **Configurable:** the user changes any action's shortcuts, as in IntelliJ's Keymap page.
- **Ready-made keymaps to start from,** chosen from a dropdown, as IntelliJ's list: Eclipse, Eclipse
  (macOS), Emacs, IntelliJ IDEA Classic, macOS System Shortcuts, NetBeans, Sublime Text, Sublime Text
  (macOS), Visual Studio, Visual Studio (macOS), VSCode, alongside the default one (IntelliJ's for
  each platform).

## Known gaps

- **Editing:** see "Not yet" in the decision "Editing and saving" (a file with unsaved edits changed
  on disk, the byte order mark, the Edit menu, deleted files).
- **Go to File and the index in a folder without git:** they read git's file list. With ripgrep, in
  the search step.
- **The macOS menu bar with several windows** is the menu of the window that last sent one, not of
  the focused one.
- **The Project tree doesn't show files added on disk** until it's opened again (seen in QA).
- **The agent e2e test's turn sometimes didn't expand** (3 runs in 9 locally: its file row never
  showed; cause not found). The test double-clicks again until the turn shows expanded. If it's a
  real bug, users could hit it too.
