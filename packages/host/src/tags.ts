// Git → New Tag…, as IntelliJ's (`GitTagDialog` and its `GitReferenceValidator`, read from its
// source): the tags there are, for the dialog to say a name is taken; the commit to tag checked;
// and the tag made, annotated when it has a message.

import type { Git } from './git.js';

/** The worktree's tags' names. */
export async function listTags(worktree: string, run: Git): Promise<string[]> {
  const output = await run(worktree, ['for-each-ref', '--format=%(refname:strip=2)', 'refs/tags']);
  return output.split('\n').filter(Boolean);
}

/**
 * The commit a hash (or its start), a branch or a tag names, in full; undefined if none: the Log's
 * Go To Hash/Branch/Tag.
 */
export async function resolveRevision(
  worktree: string,
  revision: string,
  run: Git,
): Promise<string | undefined> {
  try {
    const hash = await run(worktree, [
      'rev-parse',
      '--verify',
      '--quiet',
      '--end-of-options',
      `${revision}^{commit}`,
    ]);
    return hash.trim();
  } catch {
    return undefined;
  }
}

/** Whether `revision` names an object git knows: IntelliJ's Validate. */
export async function validRevision(
  worktree: string,
  revision: string,
  run: Git,
): Promise<boolean> {
  try {
    await run(worktree, ['rev-parse', '--verify', '--quiet', '--end-of-options', revision]);
    return true;
  } catch {
    return false;
  }
}

export interface NewTag {
  name: string;
  /** What's tagged: a commit or other object, or HEAD when undefined. */
  commit?: string;
  /** An annotated tag's message; a lightweight tag when undefined. */
  message?: string;
  /** Made over a tag of the same name, as IntelliJ's Force. */
  force: boolean;
}

/** Makes a tag: IntelliJ's `git tag [-a] [-f] [-F <message>] <name> [<commit>]`. */
export async function createTag(worktree: string, tag: NewTag, run: Git): Promise<void> {
  const annotated = tag.message !== undefined;
  await run(
    worktree,
    [
      'tag',
      ...(annotated ? ['-a'] : []),
      ...(tag.force ? ['-f'] : []),
      // The message on standard input, as IntelliJ's in a file: as typed, whatever it holds.
      ...(annotated ? ['-F', '-'] : []),
      '--',
      tag.name,
      ...(tag.commit === undefined ? [] : [tag.commit]),
    ],
    undefined,
    tag.message,
  );
}
