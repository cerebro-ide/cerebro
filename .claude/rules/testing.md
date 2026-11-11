---
paths:
  - "**/test/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/vitest.config.ts"
---

# Tests

- **If a test can be added, it's added** (CLAUDE.md): every change whose behaviour a test can
  check. A fix's test fails without the fix: run it before the fix to see it fail, and say what it
  measured.
- **Coverage is 100% per file** (`vitest.config.ts`), for every package's `src/`. A branch that
  can't be reached in a test is a design smell: pass the thing it depends on in (the host's
  functions take a `platform` or a `git` for this) rather than leaving it uncovered.
- **Where each package runs:** the UI packages (`jsx`, `ui-*`) in a real browser (Vitest's browser
  mode, Chromium through Playwright; CI uses its runner's Chrome through
  `CEREBRO_BROWSER_CHANNEL`); the rest in Node. `npm run check` runs formatting, lint, types and
  coverage, as CI's first job does.
- **Real git, not mocks, for git's behaviour:** a throwaway repository under `tmpdir()`, with
  `-c user.name=t -c user.email=t@t` on commits. Mock `git` only to test what's done with its
  output.
- **Time a test measures is `performance.now()`'s**, not `Date.now()`'s: the wall clock can step
  back while a test runs (measured under WSL: a wait came out as −840 ms).
- **The browser tests' page runs its wall clock on the monotonic one** (`test/setup.ts` in
  `ui-editor` and `playground`): under WSL the clock steps back about 2.4 s every 30 s (measured),
  and CodeMirror times a hover and its completion list's first 75 ms with `Date.now()`. A package
  with new CodeMirror tests that wait on either gets the same setup.
- **A browser test file that never loads** ("Failed to fetch dynamically imported module", or an
  iframe that never becomes ready) can be Chrome cancelling requests in flight when the machine's
  network changes (`ERR_NETWORK_CHANGED` in its net log, `--log-net-log`). Measured on 2026-11-03:
  a Docker container restarting in a loop added an interface each minute. `ip monitor address`
  shows such changes.
- **A page that runs as it's imported** (`main.tsx`, `welcome.tsx`, `boot.ts`) has a test file
  for each way it starts (`main-browser`, `main-app`, `main-mac`, `main-reload`): each sets up
  `window.cerebro` and `#app`, then imports it. A module that reads something as it's imported
  (`navigator.platform`) needs it set in `vi.hoisted`.
- **UI tests use real input** (`userEvent` from `vitest/browser`), not dispatched events, where
  the behaviour depends on it (focus, selection, keys).

## End-to-end (`packages/e2e`)

- They run the built app: `npm run e2e` builds the playground and the app first; the host needs
  `npm run build` (CI runs it). In CI on Linux they run under `xvfb-run`.
- One app per test file (`launch()` in `test/app.ts`), with a throwaway data folder; tests share it,
  so a test leaves the app as it found it, or later tests expect what earlier ones leave
  (`expect.arrayContaining`).
- **Under xvfb in CI, Playwright's click can wait forever for an element to be "stable"** (not
  reproduced locally, even under xvfb). Clicks that hit this use `{ force: true }`, with a comment.
  Why isn't known: "stable" is measured over animation frames, and every page now says on the
  console when none came for over a second, and whether it was visible and focused (`watchFrames`
  in `test/app.ts`); each file prints those as it ends.
- **The harness's reports go to the standard error** (`report` in `test/app.ts`): Vitest shows a
  test's `console.log` only when it fails.
- **`expect.poll` gives up after 1 second.** Anything that goes through Claude Code's hooks (each
  starts Electron as Node) or another process gets an explicit `{ timeout: 15_000 }`.
- **A test that needs another window size starts the app at it** (`CEREBRO_WINDOW_SIZE: '1024x768'`
  in `launch()`'s environment), never resizes after launch: Linux's window manager can undo a resize
  made before it places the window (measured under WSLg).
- The Claude tool window is open by default and takes room from the editor: tests that click in the
  editor hide it first.
- A terminal's text is its `.cerebro-terminal__row` elements; a narrow terminal wraps lines, so join
  rows with `''` to find a line.
- On failure, print what was seen (the terminal's rows, `running.messages` for the console): CI's
  log is all there is.
- Windows can't run a script on the PATH by its `#!` line: tests with a pretend `claude` are skipped
  there.
