# Brainstorm log — 2026-10-25

The conversation in which Cerebro was scoped, held in the `brainstorm` Claude session on the NAS.
Ido's messages are verbatim. Claude's replies are summarised, including the points where Ido
corrected Claude.

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
