# Brainstorm log — 2026-10-25

The conversations in which Cerebro was scoped and planned. Sections 1–7 were held in the
`brainstorm` Claude session on the NAS; sections 8–15 in a session on Ido's development machine
(iMoses-PC, WSL2). Ido's messages are verbatim. Claude's replies are summarised, including the
points where Ido corrected Claude.

---

## 1. The idea

**Ido:**

> I wanted to run an idea I had by you, trying to determine if it's worth our time and if it have any potential to be used by other people/to be a product by itself and not just a personal tool used only by me.
>
> I really like intellij, currently using mainly webstorm by I have experience with other IDEs by them, all pretty much similar. Thing is, the set of features that I actually use it quite limited, and today with most of the coding done by AI I do wish to have a similar UI but with features that are more aligned with my current usage.
> What I wanted to have, and these are very early thoughts about this, is:
>
> * Same GUI - immitate the menus, docked panels, etc - this is actually something that I did myself about 10 years ago at a company I worked for, just due to how much I like this style of menus
> * Index files access worktrees - since I work a lot with worktree, meaning that the same repo is being cloned multiple times, it's a shame that indexing takes so long each time I open a worktree, while most files are the same as those that already were indexed
> * Same menu structure/IDE config in multiple projects/worktrees
> * The 2 mainly branches of features I like from IntelliJ is how search is done (file/class/method - all types of searches, including clicking on a method name and jumping to it's definition, or clicking a definition to see where it's used) and git management including conflict resolving (3-way diff) and blame view.
> * Each worktree should be connected to a session automatically, and session could be restarted when an update is available to the CLI of claude, immidietly resuming the same session - so some sort of DB for sessions as well
> * Ability to define IDE wide skills and instructions that every session will automatically load or be exposed to if needed.

**Claude (summary):** Worth it as a personal tool, but suggested most of it could be a WebStorm
plugin plus glue, and called it weak as a standalone product: a crowded market (Conductor, Crystal,
Claude Squad, vibe-kanban, Superset, Cursor's worktree/background agents, Anthropic's own apps —
all from memory, unverified), and JetBrains owns the UI and code intelligence. Ranked the
features by effort:

- skills and instructions mostly exist already (user-level `CLAUDE.md`, skills, plugins);
- session binding is small (`--resume <id>`);
- blame is small;
- search is medium if reusing language servers, but "multi-year" to match IntelliJ yourself;
- 3-way merge is medium to large;
- the IntelliJ GUI is large.

Called **indexes shared across worktrees, keyed by git blob hash**, the one novel piece.
Recommended a plugin plus a timing test of WebStorm indexing a fresh worktree.

## 2. Ido's correction and the reframe

**Ido:**

> Calling something a "multi-year project" in the age of AI is a bit of a joke. It's a couple of days at most to support all popular languages.
> Considering you think the GUI is the largest part tell me how much you're not judging this properly.
> About the potential, this is the initial idea, and it'll obviously grow from there, so don't be so narrow minded. The gist is to create an IDE that isn't focused around writting code but instead around inspecting code and managing AI agents work. Maybe the steps are managing a kanban board for agents, or special views to inspect AI work changes - nothing is very unique by itself but combining them all into a single tool with easy and fast accesss to both high and low level inspection is the strength I'm aimming for.
> I have a feeling that building a plugin will be very limiting, won't necessarily allow me to achieve the UX that I'm looking for, and eventually will force anyone using it to pay for an IntelliJ license - I want a tool that can be free to use.
> I want a tool, but ideally I could publish it and other people will find it helpful.
> I'm willing to spend time on it, and currently my claude subscription is hardly used, so that's a good way to spend those tokens.
> Not many languages at the first stage, but I do want many common languages, such as TS, HTML, CSS, Markdown, bash, Python, YAML, JSON, etc...
> I may be open to considering other OS IDEs like VSCode, but ideally I'd rather not since I see that as a separate product focused on UX and by inheriting a larger IDE I'm loosing on the edge of having a simple system that doesn't defocus the users. And anyhow monaco and other solutions are open source so they can be used as building blocks instead of extending an existing product...

**Claude (summary):** Conceded three points:

- "multi-year" was wrong, because every listed language has an existing language server;
- the GUI isn't the biggest part;
- the inspection-and-agent-management framing is much stronger, and a plugin can't own that UX.

Pushed back on two:

- one language server per worktree is memory-heavy, and language servers don't share indexes
  across worktrees;
- a claim, unverified: Agent SDK apps may not offer claude.ai subscription login without
  Anthropic's approval, which matters for a published product.

Asked for three decisions: desktop shell (leaned Tauri for memory), agent integration (CLI or
SDK), first-version scope.

## 3. Decisions on stack and scope

**Ido:**

> 1. I'm experienced with Electron and don't know much about Tauri. If it's pratically the same I don't mind giving it a go...
> 2. CLI - I never intended to use the SDK
> 3. Yes + The GUI of course
>
> So regarding your pushback, the second I don't think matters to me, since I'm only providing a wrapper, and potentially users can use other CLI agents in the future, I won't mind. Running many worktrees at once is something that we need to validate in advance that we have a proper solution for - doesn't matter if it'll take more work to perfect, but we need to make sure it's a solveable problem.

**Claude (summary):** Recommended Electron. Tauri isn't practically the same: it swaps the Node
backend for Rust while the needed libraries are Node, and its Linux webview is weak. Its memory
saving is small next to the language servers, so Claude's earlier memory argument was weak.

Argued many worktrees is solvable (reasoning, not measured):

- agents don't use the IDE's language servers, so only inspected worktrees need one (a lazy pool);
- a tree-sitter index keyed by blob hash gives instant search and name-based navigation
  everywhere.

The open risk is tsserver warm-up time and fallback quality. Proposed a spike to measure blob
overlap, tsserver start time and memory, and tree-sitter index build and reuse time.

## 4. Test repo and remote use

**Ido:**

> I'd test against my work repo, which is ag-charts (publicly available on github)
> I should also note that I'd like the tool to be able to work both locally and remotely, meaning either on my laptop with the repo in the FS running of the local terminal, or from somewhere like the NAS server connecting to its terminal and running against repos stored there...

**Claude (summary):** Proposed the host/UI split, the same shape as VS Code Remote and JetBrains
Gateway:

- a Node host runs where the repos live and owns git, the file system, language servers, terminals
  and the index;
- Electron is only the UI, connected locally or over SSH;
- the UI never touches the file system.

Measured ag-charts at about 2.2 GB on GitHub. Found the session scratchpad is a 3.5 GB RAM disk,
too small for the spike, and the NAS root disk has 29 GB free. Asked where the spike should live.

## 5. Move to a repo, develop elsewhere

**Ido:**

> I think the better approach is to save what you learned into a git repo that will be used to create this project, then run the session on another computer instead of the NAS. We can later test that it works with the existing repos on the NAS, but this env was never meant for the multiple worktrees that we want the product for

**Claude (summary):** Asked four things: where the repo lives, its name, the remote (private or
public), and what goes in. Proposed `README.md`, `docs/decisions.md`, the spike doc,
`docs/open-questions.md` and an optional `CLAUDE.md`.

## 6. Name, location, contents

**Ido:**

> It can live on the NAS only so I could ask you to work on it from time to time, since the NAS is available 24/7 unlike my other machines, but do note that I don't want tools for this new project to be installed on the NAS - the NAS isn't a proper development env.
> At my old workplace, which is long gone, I named the tool Cerebro, I think it's a good project name for it. WDYT?
> yes, we need a new repo, and it should be private for now, which should contain for now all the info we gathered. all your suggestions, all my instructions, thoughts, ideas, everything...

**Claude (summary):** Cerebro is a good name for now. `iMoses/cerebro` is free on GitHub, but
other popular projects already use the name (see `open-questions.md`), so check it before
publishing. Created this repo's contents at `/home/claude/repos/cerebro`.

## 7. Code principles

**Ido:**

> note in the architecture that while we still don't know how the final product would look like, the code must be modular, clean, decoupled, and extensible (support plugins)

**Claude (summary):** Added a "Code principles" section to `architecture.md`.

## 8. The spike

Run on iMoses-PC; full results in `spike-multi-worktree.md`. Ido's choices when Claude asked how to
set it up: keep everything inside the repo, gitignored; worktrees spread like agent branches
(latest, a week old, a month old); and:

> Use the local copy - it's not used by anyone but you

(his existing ag-charts clone), and install Node 24 globally.

**Claude (summary):**

- Results:
  - a worktree at an indexed commit indexes in 25 ms;
  - a warm whole-repo tsserver costs about 1 GB and takes about 7 s to answer the first query;
  - name-based navigation finds nearly every real reference but is noisy for common member names.
- Verdict: the approach holds.
- Reported the problems met on the way, including a postinstall script that changed the main
  clone's git config (reverted).
- Ido asked for the conclusions, then had the results committed and the spike worktrees and data
  removed.

## 9. Planning the first version

**Ido:**

> let's plan the first version

**Claude (summary):**

- Proposed:
  - a monorepo with every feature built as a plugin;
  - JSON-RPC over stdio for local, WSL and SSH;
  - seven milestones;
  - Monaco, dockview and React.
- Asked four questions: the UI framework, where the window runs, whether remote mode is in the
  first version, and which languages get language-server navigation.

**Ido** (answers):

> UI framework: Let's talk about it. The original was actually done in React, but these days I'm not sure if we need to use a framework - I'm interested in your opinion. The ecosystem doesn't matter to me much since I plan on implementing ALL components and having the least amount of deps possible.
>
> Where the window runs: All of the above. My work laptop is Mac, we'll develop on WSL but I want it to be able to run on native windows and linux as well...
>
> Remote mode: We could do it slighlty later, after we get the main shell ready, but ideally it'll be very soon after. Testing would be best with the NAS before actually starting to use it on my work laptop where it'll run locally.
>
> Languages: All target languages

**Claude (summary):**

- Recommended no framework: plain TypeScript and DOM with its own small reactive core. Reasons:
  the plugin boundary should be the DOM, IDE components are imperative anyway, and VS Code's
  workbench does the same. Solid was offered as the middle ground.
- Switched the editor recommendation from Monaco to CodeMirror 6, since the host owns the language
  servers.
- Dropped dockview, since Cerebro builds its own docking.
- Noted what all target languages and all platforms add to the first version.
- Raised a conflict: testing remote mode on the NAS would mean installing the host there.
- Listed which pieces stay libraries.

**Ido:**

> A few questions.
> - What about a MobX style reactive state management?
> - No templating engine, does it include no JSX?
> - Doesn't Monaco buys us in editor validations? As in, wiggly lines under bad code, mismatching types, etc? Or it that relatively easy to implement on CodeMirror?
> - Ignore my note about the NAS, I'd rather keep the contraint and not install anything new there. We'll test it on this machine and my other Windows laptop.
> - You read of libraries usage seems accurate to me

**Claude (summary):**

- MobX's model is signals one layer up, so: a signals core with MobX-style decorators on top,
  without deep proxies, plus explicit observable collections.
- JSX is syntax, not templating. TypeScript compiles it into Cerebro's own runtime, which builds
  DOM directly, with reactive parts bound explicitly.
- Monaco's validation runs in the UI and doesn't see the worktree, so it's wrong in a monorepo.
  Real diagnostics come from the host's language servers, and CodeMirror's official
  `@codemirror/lint` draws them.

**Ido:**

> I agree about mobx proxies - but do note that we need an observed collection type and something similar for nested objects.
> I like JSX, so unless there's a good reason not to use it (e.g. does it play nicely with web-components and/or shadow dom?) then let's have it.
> So let's go with CodeMirror, it sounds that Monaco is an overkill for what we're aiming for.
>
> write this to the docs. Make a specific note that by modular approach I mean that every part of the system must be developed and tested in isolation - meaning that any part of the system could be used as a standalone library if ever needed. We'll have a few layers of tests, the first being unit-tests with full coverage, before we move into e2e and integration tests which we'll define later on, probably on top of real browsers using playwright.

**Claude (summary):**

- JSX works with web components and shadow DOM: custom elements are ordinary tags, rich data goes
  in as properties, and events crossing a shadow root need `composed: true`. Whether Cerebro uses
  web components at all is left open.
- Wrote the decisions, the architecture and `plan-v1.md`.

## 10. Build tooling

**Claude (summary):**

- Recommended pnpm, TypeScript 7, esbuild, Vitest (in Node and in browser mode), Biome, and no Nx
  or Turborepo.
- Asked whether "minimal dependencies" covers development tools. Ido: runtime only.

**Ido:**

> I'm not against pnpm but I'm also not that big of a fan - so I need you to convince me.
> I know that Node has it's own builtin test library, what benifits do we get from using Vitest?
> I'm unfamiliar with Biome - any risks going with it?
> Why are you against Nx pr Turborepo? I need to understand your reasoning.

**Claude (summary):**

- pnpm: its strictness can be had from a lint rule. The stronger argument is its shared store
  across many worktrees.
- Vitest: runs tests in a real browser, compiles JSX itself, and enforces coverage per file.
- Biome: weaker type-aware linting, a smaller ecosystem, and the project's history as a fork of
  Rome.
- Nx and Turborepo: not against them, but they don't pay for themselves at this size.

**Ido:**

> To be clear, my approach is the minimal approach. I don't wanna go on adventures with new tools and exotic libraries unless there's a good reason to do so. You also assume we're using decorators and I'm not sure where this is coming from.
> I generally prefer: No pnpm, yes vitest, no biome, no nx/turorepo (for now)

**Claude (summary):**

- Admitted that decorators had been recorded as decided without Ido choosing them, and corrected
  the docs.
- Proposed npm workspaces, Vite (already required by Vitest) instead of esbuild, TypeScript 6.0.3,
  and ESLint + typescript-eslint + Prettier.

**Ido** (answers):

> ESLint + typescript-eslint + Prettier
>
> If you're sure tooling doesn't work well with v7 then go v6, but I need you to validate this claim because it doesn't sound correct to me

**Claude (summary):** validated the claim and corrected its scope. TypeScript 7 itself works; only
typescript-eslint doesn't:

- every release line on npm declares TypeScript `<6.1.0`;
- Microsoft's 7.0 announcement says there's no API and recommends TS 6 and 7 side by side through
  npm aliases.

So the choice is TypeScript 6.0.3, moving to 7 once typescript-eslint supports it.

## 11. The MobX-style API

**Ido:**

> let's settle the MobX-style API

**Claude (summary):** laid out four decisions with code: how models are declared, nested objects,
collections without proxies, and when effects run. Ido picked Claude's recommendation in each:

- inferred `makeObservable(this)`;
- nested objects stored as-is, wrapped explicitly with `observableObject`;
- collections with explicit methods and bulk change events;
- synchronous effects.

## 12. CI

**Ido:**

> let's set up CI first - but the per OS tests are only needed for e2e browser tests, and we can start at this point with only unit tests which don't require this level of complexity

**Claude (summary):**

- Set up one Linux GitHub Actions job: `npm ci`, `npm run check`, build.
- Updated the plan: macOS and Windows runs come with the end-to-end tests.

## 13. Pull requests

**Ido:**

> should we run tests on every commit or should we start utilising PRs for CI?

**Claude (summary):**

- Recommended PRs now: `main` stays green, and it mirrors how Cerebro is meant to be used.
- What it needs: `gh` on the development machine and an update to the working rules.
- Who merges: Claude suggested Ido.
- It can't be enforced while the repo is private in a free org.
- Local hooks for every commit aren't worth a dependency.

**Ido:** "yes". Claude installed `gh` (checksum verified), Ido logged in, and PR #1 (CI) ran green.

**Ido:**

> for updating only the md file I give you permission to do it without a PR. PRs are mostly needed for CI, and these file don't go through CI anyhow

**Ido** (after merging PR #1):

> yes, add the paths-ignore - also, pr is merged, so take care of all open issues

## 14. The JSX runtime

**Ido:**

> merged, let's start the JSX runtime

**Claude (summary):**

- Found a blocker: Playwright 1.64 doesn't support Ubuntu 20.04, so DOM tests can't run on this
  machine. Offered three fixes:
  - a new Ubuntu 24.04 distro (recommended);
  - an in-place upgrade;
  - Docker.
- Asked three API questions: event syntax, how components receive reactive values, and whether
  to add list and conditional helpers now.

**Ido** (answers):

- the environment: upgrade this distro;
- events: `on:click`;
- props: functions, explicitly;
- helpers: later, with the UI components.

## 15. The shell window

**Ido:**

> merged, let's start the shell window

**Claude (summary):** proposed five steps, each its own PR: layout model, layout view, menu and
status bars, a dev page, then Electron. Asked four questions. Ido picked Claude's recommendation
in each:

- IntelliJ's fixed docking areas;
- plain elements with prefixed CSS;
- CSS custom properties for themes;
- browser first, Electron later.

**Ido** (while Claude wrote the layout model with left, right and bottom areas):

> it can also anchor at the top

**Ido** (while Claude built the layout view):

> at what stage can we open a dev server so i can start playing with what you created?

**Claude (summary):** the layout view (step 2) is the first point with something to see. Proposed
folding the dev server into that step.

**Ido:**

> okay, the first thing I want to play with is the layout istelf, specifically the menus. I wanna see drag and drop of them between anchors and primary/secondary views, i wanna see them open and close properly, and I wanna see that the design CSS is implemented properly.

> also, until we actually start reviewing the code, i don't want a PR per commit. I think we can put a few commits into each PR
