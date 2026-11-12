// Git → New Tag…, as IntelliJ's (`GitTagDialog` and its `GitReferenceValidator`, read from its
// source): the tags there are, for the dialog to say a name is taken; the commit to tag checked;
// and the tag made, annotated when it has a message.

import { porcelainPush, type Git } from './git.js';

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

/**
 * Deletes a tag, as IntelliJ's `GitDeleteTagOperation`: what it pointed at kept, an annotated
 * tag's object, to restore it as it was; and how many remotes there are, which it may be deleted
 * on too.
 */
export async function deleteTag(
  worktree: string,
  name: string,
  run: Git,
): Promise<{ hash: string; remotes: number }> {
  const ref = `refs/tags/${name}`;
  const hash = (await run(worktree, ['rev-parse', '--verify', '--end-of-options', ref])).trim();
  await run(worktree, ['tag', '--delete', '--', name]);
  return { hash, remotes: (await remotesOf(worktree, run)).length };
}

const remotesOf = async (worktree: string, run: Git) =>
  (await run(worktree, ['remote'])).split('\n').filter(Boolean);

/** Where a tag was deleted on the remotes, and where it couldn't be, with git's words. */
export interface RemoteTagDeletion {
  deleted: string[];
  failed: { remote: string; error: string }[];
}

/**
 * Deletes a tag deleted here on each remote that has it, as IntelliJ's
 * `GitDeleteRemoteTagOperation`: a push of nothing to it, with the remote commands' git
 * (`remote`), leased on what the tag here pointed at, so one the remote has elsewhere stays.
 */
export async function deleteRemoteTag(
  worktree: string,
  name: string,
  hash: string,
  run: Git,
  remote: Git,
): Promise<RemoteTagDeletion> {
  const ref = `refs/tags/${name}`;
  const quiet = { GIT_TERMINAL_PROMPT: '0' };
  const result: RemoteTagDeletion = { deleted: [], failed: [] };
  for (const at of await remotesOf(worktree, run)) {
    try {
      const listed = await remote(
        worktree,
        ['ls-remote', '--tags', '--end-of-options', at, ref],
        quiet,
      );
      if (!listed.split('\n').some((line) => line.split('\t')[1] === ref)) continue;
      await remote(
        worktree,
        ['push', `--force-with-lease=${ref}:${hash}`, '--end-of-options', at, `:${ref}`],
        quiet,
      );
      result.deleted.push(at);
    } catch (error) {
      result.failed.push({ remote: at, error: (error as Error).message });
    }
  }
  return result;
}

/** Makes a deleted tag again, at what it pointed at: IntelliJ's Restore. */
export async function restoreTag(
  worktree: string,
  name: string,
  hash: string,
  run: Git,
): Promise<void> {
  await run(worktree, ['tag', '--', name, hash]);
}

/**
 * Pushes a tag to a remote, as IntelliJ's `GitPushTagAction` (the branches popup's Push to): the
 * tag alone, by its full name, with the remote commands' git (`remote`). Whether it was sent: not
 * when the remote has it already, there.
 */
export async function pushTag(
  worktree: string,
  name: string,
  at: string,
  remote: Git,
): Promise<boolean> {
  const ref = `refs/tags/${name}`;
  const lines = await porcelainPush(worktree, remote, ['--end-of-options', at, `${ref}:${ref}`]);
  // "=", up to date.
  return !lines.some((line) => line.startsWith('=\t'));
}
