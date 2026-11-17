// Git's editors in an interactive rebase, as IntelliJ's `GitInteractiveRebaseEditorHandler` (read
// from its source). As the sequence editor, git's list of commits is checked against the one the
// dialog showed (IntelliJ's `validateEntries`), then the dialog's written in its place; the reworded
// messages are kept with the commit the rebase goes onto (IntelliJ's
// `GitRewordedCommitMessageProvider.save`). As the commit message's editor, each is given in turn
// where git's message starts with the one it replaces (`getRewordedCommitMessage`), else git's is
// left as it is: a rebase continued after it stopped gives the rest.
//
// Run by git as the host's entry, `main.js rebase-editor sequence|message <file>`; it imports only
// Node's modules, so the host's tests can run it as it is.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A commit's message as it was, and the one it's reworded to. */
export interface Reworded {
  original: string;
  reworded: string;
}

/** What the sequence editor's given, by the host. */
export interface RebasePlan {
  /** The commits git should list, in its order: the dialog's, before they were changed. */
  expected: string[];
  /** The list to write in its place, as git reads it. */
  todo: string;
  /** The reworded messages, in the list's order. */
  messages: Reworded[];
}

/** Where the reworded messages are kept, in the repository's git folder. */
const KEPT = 'cerebro-reworded.json';

interface Kept {
  /** The commit the rebase goes onto, as git keeps it: the messages are for that rebase alone. */
  onto: string;
  /** The next message to give. */
  current: number;
  messages: Reworded[];
}

/**
 * IntelliJ's words (`rebase.using.log.couldnt.start.error`), its first sentence: the retry with
 * git's own list it offers after it isn't Cerebro's (Claude's choice, open to change).
 */
export const COULDNT_START =
  "Cannot perform the rebase because the IDE generated an invalid 'git-rebase-todo' file.";

/** The commit the rebase under way goes onto. */
const ontoOf = (gitDir: string) =>
  readFileSync(join(gitDir, 'rebase-merge', 'onto'), 'utf8').trim();

/** The commits a list of git's picks, comments and blank lines left out; undefined for anything else. */
function picked(todo: string): string[] | undefined {
  const hashes: string[] = [];
  for (const line of todo.split('\n')) {
    const [command, hash] = line.trim().split(/\s+/);
    if (command === undefined || command === '' || command.startsWith('#')) continue;
    if ((command !== 'pick' && command !== 'p') || hash === undefined) return undefined;
    hashes.push(hash);
  }
  return hashes;
}

/** The sequence editor: the plan's list written over git's, or why not. */
export function editSequence(file: string, plan: RebasePlan, gitDir: string): string | undefined {
  const hashes = picked(readFileSync(file, 'utf8'));
  const same =
    hashes?.length === plan.expected.length &&
    hashes.every((hash, i) => plan.expected[i]?.startsWith(hash));
  if (!same) return COULDNT_START;
  writeFileSync(file, plan.todo);
  // Written each time: messages kept from an earlier rebase onto the same commit aren't given.
  const kept: Kept = { onto: ontoOf(gitDir), current: 0, messages: plan.messages };
  writeFileSync(join(gitDir, KEPT), JSON.stringify(kept));
  return undefined;
}

/** The commit message's editor: the next reworded message, where it's the one git's replaces. */
export function editMessage(file: string, gitDir: string): void {
  let kept: Kept;
  let onto: string;
  try {
    kept = JSON.parse(readFileSync(join(gitDir, KEPT), 'utf8')) as Kept;
    onto = ontoOf(gitDir);
  } catch {
    // None kept, or no rebase under way: git's message.
    return;
  }
  const next = kept.messages[kept.current];
  if (kept.onto !== onto || !next) return;
  if (!readFileSync(file, 'utf8').startsWith(next.original)) return;
  writeFileSync(file, next.reworded);
  kept.current++;
  writeFileSync(join(gitDir, KEPT), JSON.stringify(kept));
}

/**
 * The client, `rebase-editor sequence|message <file>`: its plan's file and the git folder named by
 * the environment (`CEREBRO_REBASE_PLAN`, `CEREBRO_GIT_DIR`). Gives the exit code: a list that
 * doesn't match stops the rebase before it starts, its words on the standard error.
 */
export function rebaseEditor(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  stderr: { write: (text: string) => unknown },
): number {
  const [mode, file = ''] = args;
  const gitDir = env['CEREBRO_GIT_DIR'] ?? '';
  if (mode !== 'sequence') {
    editMessage(file, gitDir);
    return 0;
  }
  const plan = JSON.parse(readFileSync(env['CEREBRO_REBASE_PLAN'] as string, 'utf8')) as RebasePlan;
  const why = editSequence(file, plan, gitDir);
  if (why === undefined) return 0;
  stderr.write(`${why}\n`);
  return 1;
}
