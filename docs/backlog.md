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

### Binaries with the installer (later)

From Ido (2026-11-04): "regarding binary installs, remember that eventually we'll build an
installer for the app, and in it we could also automatically install binaries". A tool that ships
as a binary rather than an npm package isn't ruled out; the installer can put it in place. Waiting
on it:
- Markdown's language server, marksman (the plan's), left out as it isn't on npm;
- a formatter for Python (basedpyright doesn't format);
- shfmt, which bash-language-server formats with: without it, Reformat Code leaves bash files
  as they are.

### Polish

- **Icons per file type** in the Project tree (and wherever files are listed: tabs, Go to File,
  Recent Files), as IntelliJ's. From Ido (2026-10-27), with a screenshot of the tree: "missing
  icons per file type - but don't work on the icons now just add it to the list of things to
  polish".

## Known gaps

- **Editing:** see "Not yet" in the decision "Editing and saving".
- **Errors and warnings:** see "Not yet" in the decisions "Errors and warnings in the editor" (the
  Problems window's Project Errors tab and View Options, shell scripts) and "Quick fixes:
  Alt+Enter" (the bulb, commands, fixes across files).
- **Unshelving won't apply a hunk whose lines moved** (measured 2026-11-09, writing Update
  Project's tests): the shelf applies its patch with `git apply`, which anchors a hunk that starts
  at line 1 to the file's start, so a line added above it (by an update, say) makes it fail, where
  IntelliJ's own applier finds the lines elsewhere. Update Project then says "Local changes were
  not restored", the changes kept on the shelf. `git apply --3way` or an applier of Cerebro's own
  are options.
- **Merge conflicts:** see "Not yet" in the decision "Merge conflicts".
- **Jump to Source can land before an open file reads a change made outside Cerebro** (measured
  2026-11-11, writing the diff viewer's e2e test): the file changed on disk while its tab was open;
  the diff, read from disk, had the new lines, but F4 from it put the caret in the editor's old text
  (on its last, empty line), and the text was reloaded around a second later, the caret staying
  there. The jump should wait for the reload, or the reload be asked for first.
- **The diff viewer:** see "Not yet" in the decision "The diff viewer, as IntelliJ's".
- **The agent's e2e test "lists its turn … and shows its diff" failed once in five runs**
  (2026-11-11, on the diff viewer's branch, in a full local run; the file alone passed four times):
  which assertion wasn't kept. The next failure's message will say.
- **The CSP test's click on New Branch… found it "not visible" on macOS in CI** (#168, run
  42993777988, 2026-11-11): the trace's screencast shows the branches popup open with the item
  highlighted 10 ms before the click. The popup closes when the window loses the focus or is
  resized; that either happened isn't known. The test now prints the popups, their items' boxes,
  the focus and the window's size when the click fails.
- **The app stalls for tens of seconds in CI, now and then** (Windows: #161 and #162; macOS: #165,
  run 42944609115; Linux: #165, run 42988680864; 2026-11-11): "commits a merge started elsewhere"
  pressed Ctrl+Enter with the conflicts resolved and the message filled, and nothing was committed
  in 15 s. On Linux the commit landed about 29 s after Ctrl+Enter ("Done 13497 ms after the test
  gave up"), and the next test's Pull did nothing for 15 s more, while the Merge test after took
  0.4 s: about 45 s in all; on macOS, "Done 15280 ms after the test gave up". The page sends the
  commit to the host without waiting on anything first (`changes.tsx`); the page's console was
  empty. Which held it up, the host or git, isn't
  known. The status bar printed in those runs seemed to show Pushing…, Updating…, Fetching… and a
  pull under way, but that was `textContent`, which takes hidden items' text too: it's `innerText`
  now, only what's shown. The host now says on its standard error when a git command takes over
  5 s, with its arguments, or its event loop is held up over 2 s (`slow.ts`), and the e2e tests
  keep the app's standard error (`running.output`) and print it when this test fails (measured:
  a git made 6 s slow showed "Slow: git check-ignore -z --stdin in … took 6005 ms").
  It stalled again on 2026-11-11, on macOS (#169, run 42998193659) and Windows (#166, run
  42998184065) at once: the commit done about 44 s after Ctrl+Enter ("Done 13873 ms after the test
  gave up"), the next test's Pull timing out too, and the standard error empty: no git command took
  5 s, nor was the host's event loop held up 2 s. So each request is now reported if the host took
  over 5 s to answer it ("Slow: request git.commit took …"), and if it took that long from the app
  to the host and back ("Slow: git.commit from the app to the host of … and back took …"); and the
  app's own event loop held up is reported, as the host's. Next time, which of these speaks says
  where the time went: in the host's work, on the way, or in the app.
  The runs after (2026-11-11: #168 run 43003363747 and #171 run 43004785796 on Windows, #169 run
  43003368712 on macOS) stalled in the same test, the merge never committed in 30 s and the Pull
  after done 13 to 14 s after its test gave up, and still said nothing: no request was slow, from
  the app or in the host, nor any event loop held up. Two gaps remained: a report came only once
  the work ended, so a request still going when the test ended said nothing; and nothing watched the
  page, where `changes.tsx` sends the commit. And on Linux (#166, run 43003358765) the page stopped
  taking clicks for the rest of `editing.test.ts` (a click waited "performing click action" until it
  timed out, and every test after failed). So a request or a git command is now reported once it's
  been going 5 s, as well as when it ends; the app asks each page for an answer every second and
  reports one held up over 2 s, with the call stack it was running (Chromium's
  `collectJavaScriptCallStack`, which needs a `Document-Policy` header the app now adds: measured,
  a page kept busy 6 s said "held up over 2000 ms", "was running: at spinForever (…)", "answered
  after 5200 ms"); and every e2e file prints these lines when it ends, failed or not. Electron's own
  `unresponsive` event never came for a page kept busy 55 s with a click waiting (measured on
  Linux), so it isn't used.
  The run after (#168, run 43007941029, Windows) failed the same way, with all of these quiet: no
  request or git command went on 5 s, no page or event loop was held up. So the page never sent the
  commit, or sent it late without being busy. Its "Done 14913 ms after the test gave up" isn't the
  merge's commit, as it was read before: it tests HEAD for two parents, which the next test's Pull
  gives too, and git's status printed then still said "All conflicts fixed but you are still
  merging". The page sends the commit at once, unless it finds no files or no message to commit,
  when it only says why under the message: the test now prints that, and the Commit window's rows,
  with which are put in.
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
- **A tree doesn't widen when a row's own content does** (`ui-tree`'s fit runs when its rows
  change, it's resized or scrolled): measured 2026-11-08, the Push dialog's row grew from 359 to
  407 pixels while its branch was typed (field and "Set upstream"), and was cut at the pane's
  edge. Worked around by a narrower field (110 pixels); a longer remote or branch name still
  overflows. The fix is likely the tree refitting when a row's content resizes.
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
  #115's run failed one step later: Ctrl+B reached lib.py, then Alt+F7 there never showed "Usages
  of walk" in 30 s (not reproduced in 3 runs on a local Windows machine). That step now prints
  the page and the host's answer too (2026-11-03).
- **The e2e completion test once showed no list on Windows** (CI on #121, 2026-11-04): after
  `shape.wi` was typed, with the editor focused and no popup open, the list never showed. The cause
  isn't found. The test's output asked the server again with the file as on disk, not as typed, so
  it showed nothing useful. It now asks with the editor's text (checked locally: `width`).
- **The e2e test of saving when idle sometimes doesn't save in time** (a full local run and CI on
  #121, both 2026-11-04; reruns pass): `second.ts` wasn't saved within 5 s of an edit, with the
  idle time set to 1 s, and the next test failed from it. In CI the page printed the edit in the
  editor, the page focused, and the editor focused; the file was saved later, before the next test
  looked. The cause isn't found: the timer set with the old 15 s, or the save waiting behind
  another, would both fit. The test now also prints the settings the page stored and how long the
  save took (up to 35 s). Measured in CI on #136 (2026-11-04): the stored setting was 1 s, and the
  file was saved 7 s after the edit, the editor focused. So it isn't the old 15 s. The test now
  also prints the keys and mouse events after the edit, which start the idle time again, and the
  page's long tasks. Measured in CI on #153 (2026-11-08): saved 6.0 s after the edit, with no key
  or mouse event after the typing and no long task, the editor focused, the setting 1 s. So
  nothing started the idle time again; the delay's cause is still not found. Seen again on #158 (2026-11-09):
  saved 6.1 s after the edit, the editor focused, the setting 1 s, no key after the typing; the
  race test before it took 18 s there, against 8–12 s on earlier branches, but locally #158 took
  8.0–8.7 s against main's 9.5–10.5 s (three runs each), so that isn't reproduced. Seen again on #163
  (2026-11-11): saved 6.2 s after the edit, the same otherwise. A save slower than 2 s now says on
  the console how long it waited behind the saves before, read the file, ran the hooks before
  saving, and wrote it; the test prints that.
