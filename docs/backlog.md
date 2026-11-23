# Backlog

Work to do, tracked here rather than in GitHub issues, which are for other people's reports (Ido,
2026-10-26). An item goes when it's done; the stages and their order are in `decisions.md` ("A
basic IDE before git and agent management").

## To fix soon

### The project's files under a virtual root, with scratch and external files

From Ido (2026-11-14): "the project files in intellij are under a product virtual "directory" -
that opens the door to a few things, like something to select for search within all the project
files, and having files which aren't part of the project like scratch files and external files -
that's missing and should be implemented as well". IntelliJ's Project view lists the project's
content under its own node, beside Scratches and Consoles and External Libraries; Find in Files
can then be scoped to the whole project from it. Done: the worktree's folder at the tree's top
(decision "The project tree"), and Scratches and Consoles with New Scratch File (decision
"Scratch files"). Left: "external files", which needs Ido's word on what it means here: IntelliJ's
External Libraries (for WebStorm, Node's own declarations and a project's `@types`), or files
opened from outside the project.

### The Log's subject column shrinks to nothing in a narrow window

Measured 2026-11-17 in an e2e run under xvfb: in an 854×682 window, with the Git tool window open
(its branches pane and commit details beside the list), the Log's `.playground-log__message` is 0
wide, so a commit's subject isn't seen at all. IntelliJ keeps the subject column and lets the
others go first (a claim, not checked). `log.test.ts` forces its clicks on rows, likely for this.
Left: find what takes the width and give the subject a minimum.

### Several Claude sessions, as tabs (to design later)

Raised by Ido (2026-10-26): IntelliJ lets several Claude Code sessions open as tabs. Ido: "that's
something we can get to designing a bit later on". It needs a design before it's built; the
Terminal tool window's tabs (decision "Several terminals") are the pieces to reuse.

### Agent Changes, aware of several sessions

From Ido (2026-11-03), on the Agent Changes tool window: "we could have multiple sessions per
project/worktree and so the changes window needs to be aware of this". Not to work on now. Turns
are listed per worktree, whichever session they came from; with several Claude sessions as tabs
(above), the window needs to tell them apart.

### The name "Cerebro IDE", with a release (later)

Ido (2026-11-23): "please rename the app to Cerebro IDE - it currently says Electron", and not to
patch much for development alone. The Dock's "Electron" is Electron's own bundle's name, which the
app can't change at runtime; a release's bundle is named as the app is. With it: `productName`, the
window and menu names, and the data folder, which moves with the name (projects, windows and
passwords kept there): moved once, or kept where it is.

### Binaries with the installer (later)

From Ido (2026-11-04): "regarding binary installs, remember that eventually we'll build an
installer for the app, and in it we could also automatically install binaries". A tool that ships
as a binary rather than an npm package isn't ruled out; the installer can put it in place. Waiting
on it:
- Markdown's language server, marksman (the plan's), left out as it isn't on npm;
- a formatter for Python (basedpyright doesn't format);
- shfmt, which bash-language-server formats with: without it, Reformat Code leaves bash files
  as they are.

### Swap Branches in Show Diff with Working Tree (proposed: a reshaping, for Ido's word)

IntelliJ's link after the window's label (`CompareBranchesDiffPanel.swapSides`): a saved setting
(`DvcsCompareSettings`) that turns the label round ("Difference between files in feature and
current working tree on main:") and each change's sides. A diff tab can't show the working tree on
its left yet: its `Range` is a ref against a ref, or against the working tree on the right. Swapping
needs the range, the tab id's encoding, the Diff view's sides (titles, the editable one) and the
diff window's parameters to carry which side is which. Proposed before doing it, as it reshapes the
diff's model for one link (CLAUDE.md).

### Multiple carets: the rest

Ido approved them (2026-11-23); the first three parts are done (decision "Multiple carets"). Left:
Column Selection Mode; Cyclic Expand Word at every caret.

### A popup that holds controls (proposed: a reshaping, for Ido's word)

IntelliJ shows some choosers as popups with controls of their own, at the caret: Toggle Bookmark
Mnemonic's grid and description field (`BookmarkTypeChooser`), say, and Go to Mnemonic's tree,
centred, with no search field. Cerebro's popups are lists (the picker, the Switcher), each drawing
its own frame, so the mnemonic chooser is a dialog with OK and Cancel for now, and Go to Mnemonic
the picker at the top (decision "Bookmarks"). The Keymap page's Find Actions by Shortcut waits on it
too (found 2026-11-16): IntelliJ's opens a Find Shortcut popup under the search field
(`ShortcutFilteringPanel`, read from its source), a stroke field, Second stroke and its field, and
a mouse pad, the list filtered as a shortcut is pressed, which a modal dialog would hide. A popup
shell they'd share, with a title, a place and
the focus handled once, taking any content, would let it be IntelliJ's popup. Proposed before
doing it, as it reshapes the picker and the Switcher (CLAUDE.md).

### Scripts changed on disk, for bash-language-server (proposed: a special case, for Ido's word)

bash-language-server 5.8.1 doesn't take `workspace/didChangeWatchedFiles` (measured 2026-11-15;
decision "Language servers, first part"): a script changed or made on disk after it starts isn't
seen until it's restarted, so usages miss them. Opening each changed script in it and closing it
again would give it the text (its `onDidClose` keeps what it analysed: read from its code, not
measured). It's a special case for one server, so it's proposed before it's done.

### Several rows selected in a tree: the rest of the actions

Ido approved it (2026-11-23); `ui-tree` takes several rows, and the Commit window's Show Diff,
Rollback, Shelve and Space and the Project view's Delete take them all (decision "Several rows
selected in a tree"). Left: Copy, Cut, Paste and Move in the Project view; Show Diff and Rollback
in Agent Changes; the Log's, the shelf's and the other trees' actions.

### The Log's graph laid out as IntelliJ's (proposed: a reshaping, for Ido's word)

Found 2026-11-16, for the Log decision's Not yet (Show Long Edges, Collapse and Expand Linear
Branches). IntelliJ cuts an edge of 30 rows or more down to the row after its top and the row
before its bottom, each ending in an arrow, unless Show Long Edges is on; then it's drawn whole,
with arrows next to its ends, and only past 1000 rows is it cut, keeping 250 rows at each end
(`PrintElementGeneratorImpl`: `LONG_EDGE_SIZE` 30, `LONG_EDGE_PART_SIZE` 1, `VERY_LONG_EDGE_SIZE`
1000, `VERY_LONG_EDGE_PART_SIZE` 250, read from its source). A row's elements sit in their sorted
order, so a cut edge frees its column and the lines beside it move in. Cerebro's graph gives each
line a lane as a page of commits loads (`log-graph.ts`; the decision "The Git Log" marks it
Claude's design, IntelliJ's layout not copied), and an edge's length is known only once its
parent has loaded. Both actions need IntelliJ's layout (its `GraphLayoutBuilder` and the sorted
elements of each row) in place of the lanes: a rewrite of the graph, so it's proposed first.

### Polish

- **Icons per file type** in the Project tree (and wherever files are listed: tabs, Go to File,
  Recent Files), as IntelliJ's. From Ido (2026-10-27), with a screenshot of the tree: "missing
  icons per file type - but don't work on the icons now just add it to the list of things to
  polish".

- **In-editor hints, as IntelliJ's inlays** (last in the list): from Ido (2026-11-14), "intellij
  on editor indications, such as usages, type hint, and who authored each definitions are missing
  too - though that should be at the bottom of the backlog". IntelliJ's code vision (usages count,
  the author of each definition, from git) and its inlay type hints.

## Known gaps

- **The Log's commit menu item "not visible" as it was clicked, once on macOS in CI** (#455, run
  45271665375, 2026-11-23): log.test's "resets the branch to the commit right-clicked" found
  "Reset Current Branch to Here…" but Playwright's forced click said "Element is not visible". The
  trace's DOM snapshot as the click began holds no menu; the one after it, the menu open at the
  row's right-click with the item in it, as the screenshot shows. So the menu was opened, or opened
  again, during the click; why, not found. The same code passed on #456 and #457, and none of the
  60 failed runs before it had this error.
- **A kept tab's editor not shown yet missed a change on disk** (measured 2026-11-18, on
  fix/tab-switch-flicker): with every open tab's editor made at once, the host e2e test's
  `shape.ts`, changed on disk and opened from the Commit window, showed its old text until the next
  periodic re-read (its diff about 1,050 ms late, 30 ms on main). Avoided by making a tab's editor
  the first time it's shown, as IntelliJ does; why a made but hidden editor missed it, not found.
  A tab shown once, then hidden, could miss a change the same way: untested.
- **Two hover tooltips at once, in one full e2e run** (2026-11-18, fix/tab-switch-flicker): the
  Ctrl+Q test found `module "./lib"` beside its own; not seen in two more runs, nor in the app
  switching tabs by mouse or Ctrl+Tab with a hover showing (each closed it). The test now looks at
  the shown editor's and, failing, prints each editor's tooltips and whether it's shown.

- **Lezer's HTML reads a tag's name without its digits** (`@lezer/html` 1.3.13, `nameChar`,
  measured 2026-11-16): `<h2>` is read as `h`, so its rules for closing an open `<p>` (`closeOnOpen`)
  never match a heading. A heading after a `<p>` left open is the paragraph's child: indented in
  it, folded with it, and moved inside it (IntelliJ's `htmlUnclosed` mover test, kept as expected
  to fail). To report to Lezer, at Ido's word (it's outward-facing).

- **Two fields still take the focus a frame after their dialog opens**: `branchField` (Merge,
  Rebase, Pull) and the Log's values field (`log-filters.tsx`). Keys typed before that frame go to
  the dialog's first control. Measured in the Shelve dialog, whose field did the same (#353's macOS
  e2e, run 43579834672, 2026-11-14: "Aside" was lost and Shelve Changes stayed disabled). The dialogs
  now focus a control marked `autofocus` as they open, and the Shelve, stash and Put Label dialogs
  use it. These two also select their text, which `autofocus` doesn't do, and a dialog's field may
  not be first; left for now.

- **Browser test files that sometimes don't load in a full local run** (2026-11-16, #432's check
  in a worktree, 240 files): four files (playground's `git-log`, `main-app`; ui-editor's `editor`,
  `completions`) failed with "Vitest failed to find the runner" / "the current suite", or "The
  iframe … did not become ready within 60000ms". Rerun alone, all four passed. No container was
  running, and `ip monitor address` showed no change in 20 s, but only after the run, so the
  testing rule's measured cause (Chrome's `ERR_NETWORK_CHANGED`) isn't ruled out. Next time: run
  `ip monitor address` with timestamps through the run, and Chrome's `--log-net-log`.

- **A popup stays open when the focus moves to the editor in code** (measured on macOS in CI,
  #233, run 43315646427, 2026-11-12): language-servers' Python test pressed Ctrl+B again while an
  earlier press could still be answered; one press opened a chooser of walk's definitions, another's
  answer opened lib.py and focused its editor, and the chooser stayed open without the focus, where
  Escape, sent to the body, didn't close it, so every later test failed behind it (as in #228's
  run). The test now waits for each press's answer, or the host's name matches, before pressing
  again. The app's side isn't decided: IntelliJ's choosers close on a click outside and when the
  window is left, as ours. Read from IntelliJ's source (2026-11-16): they don't close when the
  focus moves elsewhere (AbstractPopup's ChildFocusWatcher only marks the popup inactive), but
  every key goes to the open popups first, the topmost first, wherever the focus is
  (IdePopupManager's dispatch stack; a list popup's through PopupDispatcher), and Escape cancels
  one (`AbstractPopup.dispatchKeyEvent`). Ours take keys only through their focused search field
  (`ui-popup`'s `popup.tsx`), so Escape at the body leaves one open. Proposed, for Ido's word (a
  reshaping of `ui-popup`'s keys): keys reach the open popup wherever the focus is, as IntelliJ's.
- **Double Shift once didn't open Search Everywhere in main-app's Show History test** (CI, #221,
  2026-11-12; not reproduced in six local runs, three at once). Not measured why: double Shift
  wants its second tap within 400 ms of the first (`ModifierTaps`), and the window losing the focus
  forgets taps. The test now prints its taps' times and the window's focus if the popup doesn't
  open.
- **Editing:** see "Not yet" in the decision "Editing and saving".
- **Errors and warnings:** see "Not yet" in the decisions "Errors and warnings in the editor" (the
  Problems window's Project Errors tab and Group by Inspection, shell scripts) and "Quick fixes:
  Alt+Enter" (the bulb, commands, fixes across files).
- **Merge conflicts:** see "Not yet" in the decision "Merge conflicts".
- **The diff viewer:** see "Not yet" in the decision "The diff viewer, as IntelliJ's".
- **The Log's Checkout submenu needs menu items made from the context** (found 2026-11-11, adding
  the Log's commit menu, #182): IntelliJ's lists the commit's branches (then Checkout Revision),
  which change from commit to commit, but `@cerebro-ide/commands`' menus are contributed once and
  a submenu only refers to another menu, so its items can't come from the commit right-clicked.
  It needs a contribution that makes its items from the context (as the Branches popup's lists
  are made today, outside the menus): a change to a shared package, to be proposed before it's
  built. The Git submenu's Add to .gitignore needs it too (2026-11-16): IntelliJ's lists each
  .gitignore in the file's folder or above it.
- **Two read marks for a variable read once** (measured 2026-11-11, #192's macOS e2e, run
  43111846003: "goes to a usage when its mark on the scrollbar is clicked" found two
  `.cerebro-usageMark` without `--write` in `long.ts`, whose `distant` is declared once and read
  once). Why isn't known: that TypeScript's highlights came back empty and the references
  fallback (`highlights` in `lsp.ts`) marked the declaration as read is a claim. The test now
  prints each mark and each usage in the text when it fails. It came back on #403's macOS run
  (2026-11-16, run 43817944365), whose output showed no marks and no editors: it queried the
  document, and the marks are in the editors' shadow roots. It now looks in them too (#406).
- **The e2e run's first app start can take over 5 s on macOS and Windows in CI** (measured
  2026-11-11, #179, run 43049756595: `app.test.ts`, the first file, timed out waiting 5 s for the
  window on both, its toolbar showing just then on macOS; the run's other starts took 0.2–0.9 s,
  from their traces). Why isn't known: that it's the OS checking the Electron binary just
  downloaded is a claim. The wait for a window is now 30 s, and a start over 2 s prints how long
  it took. On Linux under xvfb (#202, 2026-11-12), the first launch took 4.9 s and 2.5 s to its
  first window, and showed it (Electron's `ready-to-show`) 1.7 s and 4.6 s after its page loaded;
  later launches, 0.3 s and 50 ms. The tests now wait for the window to show (testing.md).
- **Closing the app after host.test ran past the 60 s hook** (2026-11-16, a local full run under
  xvfb on #406's branch, other tests running beside it): all 23 of its tests passed, then its
  `afterAll` timed out. Which step (saving the trace, or the app's close) isn't known; each now
  says if it's still running after 20 s. The next time, that line shows which. A ui-tree test failed
  once beside it as well ("selects the row clicked when the click focuses it, scrolled": its row
  not drawn 20 ms after the scroll), and passed 5 of 5 alone; that the load was why is a claim.
- **The editor tabs' e2e test fails in a full local run under xvfb** (2026-11-12, and with main's
  harness too; passes in CI): "scrolls tabs that don't fit…" finds "Show Hidden Tabs" still shown
  after its 16 tabs are closed. The local window is 854×682, CI's 1280×900; that the size is why
  is a claim.
- **Find Action didn't list "Unstash Changes" once in a full local e2e run** (2026-11-11,
  feat/diff-window: the shelf test "unstashes the stash chosen", right after the test before it
  closed a diff window; the file alone passed five times). The trace was overwritten before it was
  read. `findAction` now prints the popup's field, its items and the focus when it fails.
- **The e2e test of saving when idle saved late again** (#186, run 43084558097, Linux, 2026-11-11;
  on time on all three OSes in #181's runs before): saved 5.3 s after the edit with the idle time
  at 1 s, the editor focused, no key, pointer or wheel event after the last key and no long task;
  no save of the file was slow (over 2 s from asked to written), so it was asked for late, or an
  earlier one found nothing to save. The page now logs each idle save as it starts, with the files
  modified then, which the test prints when it fails.
- **The agent's e2e test "lists its turn … and shows its diff" failed once in five runs**
  (2026-11-11, on the diff viewer's branch, in a full local run; the file alone passed four times):
  which assertion wasn't kept. The next failure's message will say. On macOS in CI (#169, run
  43007945845) it counted one "Write a file" turn in 15 s, not the two of the runs before and after
  the restart; it now prints the rows, the status bar, the agent's terminal and the app's standard
  error when that fails. Again on macOS (#184, run 43081109016): one turn, the status bar "Claude is
  done", the terminal "pretend claude: --resume fake-session" (the second run started), nothing in
  the standard error. Whether its hooks ran isn't shown: the pretend claude now prints each hook's
  end, how long it took, or its error.
  Again on macOS (#213, run 43207833335, 2026-11-12): one turn; the second run's hooks both ran
  (UserPromptSubmit in 1274 ms, Stop in 324 ms), so the turn was lost after them. A candidate, not
  measured: the host tells the UI "done" before it takes the turn's last snapshot and writes its
  ref, and the first test restarts the app as soon as "done" shows, which kills the host. Locally
  the ref was written by then in 4 runs of 4, but in one of them 6 ms before "done" was seen. The test now prints the turns' refs when the first
  run was done and when it fails (each id starts with the time it was kept), which tells which
  turn is missing. Since 2026-11-15 the app ends the host's input and the host finishes the
  snapshots under way before it stops (decision "The protocol and the host"): if the candidate was
  the cause, this doesn't happen again. That it was is still a claim.
- **The CSP test's click on New Branch… found it "not visible" on macOS in CI** (#168, run
  42993777988, 2026-11-11): the trace's screencast shows the branches popup open with the item
  highlighted 10 ms before the click. The popup closes when the window loses the focus or is
  resized; that either happened isn't known. The test now prints the popups, their items' boxes,
  the focus and the window's size when the click fails. The same click failed the same way in
  `app.test.ts` on Linux in CI (#181, 2026-11-11), with no frame report: every page now also says
  when its window is resized or loses focus, printed as each e2e file ends. In #181's passing run
  (43076863326) Linux's window had none; macOS's resizes came from the full-screen test alone.
- **The page stopped taking clicks for the rest of `editing.test.ts` on Linux in CI** (once, on
  2026-11-11, #166, run 43003358765): a click on System Settings' Global waited "performing click
  action" until it timed out, and every test after failed. The app now reports a page held up over
  2 s with the call stack it was running, and every e2e file prints these reports as it ends.
  (The "stall" in "commits a merge started elsewhere", thought to be the same, wasn't one: the
  test pressed Ctrl+Enter before the Commit window listed the resolved file, and Commit said
  "Select files to commit", as IntelliJ's; it now waits for the file to be put in.)
- **The HTTP login e2e test was never asked to log in, on macOS in CI** (#233, run 43309706008,
  2026-11-12; passed on #233's two runs before, and on Linux and Windows in the same run; the only
  such failure in the last 60 failed runs): after Push was clicked, no "Log In to" dialog in 15 s,
  and the tests after it timed out as if Push stayed busy, then the repository was left mid-merge.
  Whether git reached the test's server, or asked and the page never showed it, wasn't printed.
  The test now prints the window, the server's requests and their answers, and whether the login
  was asked within a minute after.
- **Push's e2e test "says why a push failed" found no Push dialog on Windows in CI** (twice in a
  row on 2026-11-09, PR #157, runs 42630517881 and 42632719305; passed on the next run and on
  Linux and macOS): Ctrl+Shift+K opened no dialog (none in the page), the commit there and its
  balloons as expected. That a push still under way had Push turned off is a claim: in the run
  after, Pushing… had already gone when the test before it ended. The test now prints the dialogs,
  balloons, log and status bar when it fails.
- **The agents' hooks may not wait for the host on Windows** (seen 2026-11-08 while measuring
  askpass there): the hook client ends its side of the socket and waits for it to close, as the
  askpass client did; on Windows, a named pipe closed for writing is closed both ways (measured
  for askpass: the host's reply failed with EPIPE). That the prompt's hook then returns before the
  host's snapshot, or that the host's `socket.end()` errors, is a claim, not measured. Askpass now
  sends its question as a line (`askpass.ts`); the hooks could do the same.
- **The macOS menu bar with several windows** is the menu of the window that last sent one, not of
  the focused one.
- **The editor test "edits its document by real typing, with undo" failed once in CI** (Linux,
  2026-11-04, run 41836677496, on a change to the macOS native module alone): expected `'one'`,
  got `'one '`. Cause not found yet; not reproduced locally.
- **Two Find in Files tests failed in a full local run** (2026-11-07, on feat/log-filters; they
  pass alone): "searches only files the File mask takes" saw a search for each of three keys where
  it expects one, and "opens what it finds in the Find window" failed after it. That the keys
  came further apart than the search's 150 ms delay under the run's load is a claim, not measured;
  the earlier fix (ed7bffc) measured that for the test of typing.
  Again on 2026-11-08 (feat/indent, a full run while the machine's network kept changing): 4
  searches where 2 were expected; it passed alone 3 times.
- **A Log e2e test sometimes finds its toolbar's » hidden in a full local run** (WSLg; never alone,
  never in CI). Most of these failures were the test resizing the window after launch, before
  WSLg's window manager placed it, which undid the size (measured 2026-11-09: 1024×768, then back to
  1440×900 1 ms later, placed 0.85 s and 2.3 s after); the window now starts at the test's size
  (`CEREBRO_WINDOW_SIZE`), and in 6 full runs since, its size was never undone. Left: in 1 of
  those runs, the window at its size but off-screen (x -21824, where WSLg puts a window before placing it), the
  toolbar's items overflowing (289 pixels in 70) with its » hidden: the row's fit, in an animation
  frame, hadn't run. That frames don't run off-screen is a claim: WSLg won't move a window
  off-screen to measure it, and waiting for the window to be placed failed other files (a window
  stayed off-screen for over 15 s, which they ran fine in). The test now also prints how many
  frames the page draws in 500 ms when it finds the » hidden. On 2026-11-11 (feat/diff-unified,
  full local run), another way: nothing printed, so the » showed when checked, then hover found it
  hidden ("Element is not visible"): the row's fit changed between the two. What changed it isn't
  known yet.
- **The agent e2e test's turn sometimes didn't expand** (3 runs in 9 locally: its file row never
  showed; cause not found). The test double-clicks again until the turn shows expanded. If it's a
  real bug, users could hit it too. Again on 2026-11-15 (once in four local runs, the turn shown,
  its file row not after 5 s of double-clicks), so the retry doesn't hide it either.
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
  #115's run failed one step later: Ctrl+B reached lib.py, then Alt+F7 there never showed "Usages
  of walk" in 30 s (not reproduced in 3 runs on a local Windows machine). That step now prints
  the page and the host's answer too (2026-11-03).
- **Find Usages showed no name matches once on macOS in CI** (#326's run, 2026-11-14): host.test's
  "goes to a definition with Ctrl+click, and finds usages with Alt+F7" reached `export class Shape`
  in shape.ts, then Alt+F7 showed no popup in 5 s. The cause isn't known (the run printed nothing
  more); the test now prints the focus, the caret's line, the popups and the balloons when it
  happens again. #361's run showed the same (focus in the editor on that line, no popup or
  balloon); the test now also waits 25 s more and prints whether, and when, the list showed.
- **The e2e completion test once showed no list on Windows** (CI on #121, 2026-11-04): after
  `shape.wi` was typed, with the editor focused and no popup open, the list never showed. The cause
  isn't found. The test's output asked the server again with the file as on disk, not as typed, so
  it showed nothing useful. It now asks with the editor's text (checked locally: `width`).
