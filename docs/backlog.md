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
- **The host's errors reach the page with Electron's wrapping** (seen 2026-11-08 in QA of Define
  Remote): "Error invoking remote method 'cerebro:host:request': ResponseError: fatal: …", where
  git's words alone were meant. `ipcRenderer.invoke` puts that in front of an error thrown in
  `ipcMain.handle` (`packages/app/src/host.ts`). Every place that shows a host error's message has
  it in the app (Push failed's notification, Define Remote's URL), not in the browser tests,
  whose fake host throws plain errors. A fix would pass the error back as a value and rethrow it in
  the preload, with an e2e test that reads a shown message.
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
- **The Log e2e tests fail in some full local runs: the window manager places the window late**
  (first 2026-11-07; 4 full runs in 6 on 2026-11-08, feat/push-dialog; again on feat/push-force
  and feat/git-credentials, the same 4 tests, passing alone right after; never alone, never in
  CI).
  Measured with the window's `resize` and `move` events: the test's resize to 1024×768 right after
  launch took effect, the window went back to 1440×900 a millisecond later, and WSLg's window
  manager placed it 2.8 s later (moved off-screen, then to its centred place). Depending on that
  last step the window ended at 1440×900 (the toolbar's filters fit, so its » never showed) or
  1024×768, and a click before it was lost (the Git stripe button's: once, and again on
  2026-11-08 on feat/push-remote, where all 6 failed with the window at 1024×768 and no Git tool
  window open; the file passed alone twice right after). The tests print the
  window's, the screen's and the toolbar's sizes when the » is hidden. Fixing it needs the e2e
  harness (and `qa.mjs`, which resizes the same way) to wait until the window is placed, or the
  app to take its size at launch, as IntelliJ restores a project's window bounds; neither is done
  yet.
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
  page's long tasks.
