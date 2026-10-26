---
name: qa
description: Build and run the real desktop app on a throwaway repository, drive it with Playwright, and take screenshots, to see a change working before telling Ido it works. Use for anything visual or that the unit and e2e tests don't show.
---

# Seeing it in the real app

Passing tests aren't the same as working. For a change Ido will look at, see it in the built app.
Not on the NAS: nothing is built or run there (CLAUDE.md).

1. **Build** what the app runs: `npm run build && npm run build:web -w @cerebro-ide/playground &&
   npm run build -w @cerebro-ide/app`. (Only the host changed:
   `npx tsc -b packages/host/tsconfig.build.json`.)
2. **Run it:** `node packages/e2e/scripts/qa.mjs --out <scratchpad dir>`. It opens the app at
   1600×1000 on a new repository with one commit (or `--repo <path>`), with a throwaway data
   folder, waits, saves `qa.png`, prints the page's console errors, and quits. `--wait <ms>` waits
   longer (an agent starting).
3. **Drive it** for anything more: write a script in the scratchpad that imports `launch` from
   `packages/e2e/scripts/qa.mjs` (it returns `{ app, page, repo, close }`) and uses Playwright's
   `page` as the e2e tests do: the same selectors (`.cerebro-stripe-button[data-id="commit"]`,
   `.cerebro-tree-row[data-key="..."]`, `.cerebro-terminal__row`, `.cerebro-statusbar`).
   - The real `claude` in the Claude tool window first asks to trust the folder: focus its
     terminal (`.cerebro-terminal` nth 0), then ArrowDown and Enter.
4. **Look at the screenshots** (Read them) and compare with what was meant; for look, with IntelliJ.
   Send Ido the ones that show the change when he's following from elsewhere.
5. Say what was seen, and what wasn't checked.
