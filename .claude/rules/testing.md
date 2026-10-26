---
paths:
  - "**/test/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/vitest.config.ts"
---

# Tests

- **Every bug fix comes with a test that fails without the fix.** Run it before the fix to see it
  fail, and say what it measured.
- **Coverage is 100% per file** (`vitest.config.ts`), for every package's `src/` but the
  playground's. A branch that can't be reached in a test is a design smell: pass the thing it
  depends on in (the host's functions take a `platform` or a `git` for this) rather than leaving it
  uncovered.
- **Where each package runs:** the UI packages (`jsx`, `ui-*`) in a real browser (Vitest's browser
  mode, Chromium through Playwright; CI uses its runner's Chrome through
  `CEREBRO_BROWSER_CHANNEL`); the rest in Node. `npm run check` runs formatting, lint, types and
  coverage, as CI's first job does.
- **Real git, not mocks, for git's behaviour:** a throwaway repository under `tmpdir()`, with
  `-c user.name=t -c user.email=t@t` on commits. Mock `git` only to test what's done with its
  output.
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
- **`expect.poll` gives up after 1 second.** Anything that goes through Claude Code's hooks (each
  starts Electron as Node) or another process gets an explicit `{ timeout: 15_000 }`.
- The Claude tool window is open by default and takes room from the editor: tests that click in the
  editor hide it first.
- A terminal's text is its `.cerebro-terminal__row` elements; a narrow terminal wraps lines, so join
  rows with `''` to find a line.
- On failure, print what was seen (the terminal's rows, `running.messages` for the console): CI's
  log is all there is.
- Windows can't run a script on the PATH by its `#!` line: tests with a pretend `claude` are skipped
  there.
