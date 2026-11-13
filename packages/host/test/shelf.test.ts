import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  clearStashes,
  deleteShelf,
  dropStash,
  EMPTY_TREE,
  git,
  type Git,
  listChanges,
  listChangesBetween,
  listShelves,
  listStashes,
  shelve,
  stash,
  unshelve,
  unstash,
} from '../src/index.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-shelf-')));
const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
/** Git, as someone to commit as: stashes are commits, and a test machine may have no one set. */
const as: Git = (cwd, args, env, input) =>
  git(
    cwd,
    args,
    {
      ...env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
    input,
  );

/** A new repository with a.txt, b.txt and c.txt committed; or none, if `empty`. */
function repository(name: string, empty = false): string {
  const repo = join(root, name);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  if (!empty) {
    for (const file of ['a', 'b', 'c']) writeFileSync(join(repo, `${file}.txt`), file);
    run(repo, 'add', '.');
    run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
  }
  return repo;
}

const read = (repo: string, file: string) => readFileSync(join(repo, file), 'utf8');

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the shelf', () => {
  it('shelves the files named, takes them back, and gives them back unshelved', async () => {
    const repo = repository('shelve');
    // Modified; deleted; renamed; added and staged; untracked; and one not shelved, staged.
    writeFileSync(join(repo, 'a.txt'), 'changed');
    rmSync(join(repo, 'b.txt'));
    run(repo, 'mv', 'c.txt', 'moved.txt');
    writeFileSync(join(repo, 'added.txt'), 'added');
    run(repo, 'add', 'added.txt');
    writeFileSync(join(repo, 'new.txt'), 'new');
    writeFileSync(join(repo, 'kept.txt'), 'kept');
    run(repo, 'add', 'kept.txt');
    const changes = (await listChanges(repo)).filter((c) => c.path !== 'kept.txt');
    let time = 1000;
    const id = await shelve(repo, changes, 'Aside', git, () => time);
    // Back as last committed; added and untracked files gone; the other still staged.
    expect(await listChanges(repo)).toEqual([{ path: 'kept.txt', status: 'added' }]);
    expect(existsSync(join(repo, 'new.txt'))).toBe(false);
    expect(read(repo, 'a.txt')).toBe('a');
    const [shelf] = await listShelves(repo, git);
    expect(shelf).toEqual({
      id,
      commit: expect.any(String) as string,
      base: run(repo, 'rev-parse', 'HEAD').trim(),
      message: 'Aside',
      time: 1000,
    });
    const { base, commit } = shelf as NonNullable<typeof shelf>;
    expect(await listChangesBetween(repo, base, commit)).toEqual([
      { path: 'a.txt', status: 'modified' },
      { path: 'added.txt', status: 'added' },
      { path: 'b.txt', status: 'deleted' },
      { path: 'moved.txt', status: 'renamed', from: 'c.txt' },
      { path: 'new.txt', status: 'added' },
    ]);
    // A later one is listed first.
    time = 2000;
    writeFileSync(join(repo, 'a.txt'), 'later');
    await shelve(
      repo,
      await listChanges(repo).then((c) => c.slice(0, 1)),
      'Later',
      git,
      () => time,
    );
    expect((await listShelves(repo, git)).map((s) => s.message)).toEqual(['Later', 'Aside']);
    await deleteShelf(repo, (await listShelves(repo, git))[0]?.id as string, git);
    // Unshelved: the changes again, in the worktree, and the shelf without it.
    await unshelve(repo, id, git);
    expect(read(repo, 'a.txt')).toBe('changed');
    expect(read(repo, 'new.txt')).toBe('new');
    expect(read(repo, 'moved.txt')).toBe('c');
    expect(existsSync(join(repo, 'b.txt'))).toBe(false);
    expect(existsSync(join(repo, 'c.txt'))).toBe(false);
    expect(await listShelves(repo, git)).toEqual([]);
    await expect(unshelve(repo, id, git)).rejects.toThrow(`No shelved changes ${id}`);
  });

  it('keeps a list shelved when it doesn’t apply to the files as they are', async () => {
    const repo = repository('conflict');
    writeFileSync(join(repo, 'a.txt'), 'shelved');
    const id = await shelve(repo, await listChanges(repo), 'Aside', git);
    writeFileSync(join(repo, 'a.txt'), 'changed since');
    await expect(unshelve(repo, id, git)).rejects.toThrow();
    expect(read(repo, 'a.txt')).toBe('changed since');
    expect(await listShelves(repo, git)).toHaveLength(1);
  });

  it('unshelves a change at a file’s start after lines are added above it', async () => {
    const repo = repository('moved');
    // The lines as written, whatever the machine's git converts them to (Windows' to CRLF).
    run(repo, 'config', 'core.autocrlf', 'false');
    writeFileSync(join(repo, 'b.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'lines');
    writeFileSync(join(repo, 'b.txt'), 'one\nTWO\nthree\nfour\nfive\n');
    const id = await shelve(repo, await listChanges(repo), 'Aside', git);
    // An update, say, adds a line at the top: the hunk, at line 1, has moved.
    writeFileSync(join(repo, 'b.txt'), 'zero\none\ntwo\nthree\nfour\nfive\n');
    await unshelve(repo, id, git);
    expect(read(repo, 'b.txt')).toBe('zero\none\nTWO\nthree\nfour\nfive\n');
    expect(await listShelves(repo, git)).toEqual([]);
  });

  it('unshelves a change two lines from a file’s start after lines are added above it', async () => {
    const repo = repository('moved-two');
    run(repo, 'config', 'core.autocrlf', 'false');
    writeFileSync(join(repo, 'b.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'lines');
    // Its hunk is the whole file: from line 1, two lines before the change and two after.
    writeFileSync(join(repo, 'b.txt'), 'one\ntwo\nTHREE\nfour\nfive\n');
    const id = await shelve(repo, await listChanges(repo), 'Aside', git);
    writeFileSync(join(repo, 'b.txt'), 'zero\none\ntwo\nthree\nfour\nfive\n');
    await unshelve(repo, id, git);
    expect(read(repo, 'b.txt')).toBe('zero\none\ntwo\nTHREE\nfour\nfive\n');
    expect(await listShelves(repo, git)).toEqual([]);
  });

  it('shelves before the first commit, against the empty tree', async () => {
    const repo = repository('no-commits', true);
    writeFileSync(join(repo, 'a.txt'), 'a');
    const id = await shelve(repo, await listChanges(repo), 'First', git);
    expect(existsSync(join(repo, 'a.txt'))).toBe(false);
    expect((await listShelves(repo, git))[0]?.base).toBe(EMPTY_TREE);
    await unshelve(repo, id, git);
    expect(read(repo, 'a.txt')).toBe('a');
  });

  it('unshelves a list that changes nothing', async () => {
    const repo = repository('nothing');
    const id = await shelve(repo, [], 'Nothing', git);
    await unshelve(repo, id, git);
    expect(await listShelves(repo, git)).toEqual([]);
  });
});

describe('the stash', () => {
  it('stashes, lists, applies, pops, drops and clears, as git does', async () => {
    const repo = repository('stash');
    expect(await listStashes(repo, as)).toEqual([]);
    writeFileSync(join(repo, 'a.txt'), 'first');
    await stash(repo, 'First', { keepIndex: false, includeUntracked: false }, as);
    expect(read(repo, 'a.txt')).toBe('a');
    // Keep index leaves what's staged; Include untracked takes new files too; no message: git's.
    writeFileSync(join(repo, 'b.txt'), 'staged');
    run(repo, 'add', 'b.txt');
    writeFileSync(join(repo, 'new.txt'), 'new');
    await stash(repo, '', { keepIndex: true, includeUntracked: true }, as);
    expect(read(repo, 'b.txt')).toBe('staged');
    expect(existsSync(join(repo, 'new.txt'))).toBe(false);
    const stashes = await listStashes(repo, as);
    expect(stashes.map((s) => [s.ref, s.message])).toEqual([
      ['stash@{0}', expect.stringMatching(/^WIP on main: /) as string],
      ['stash@{1}', 'On main: First'],
    ]);
    const first = stashes[1] as NonNullable<(typeof stashes)[1]>;
    expect(first.parent).toBe(run(repo, 'rev-parse', 'HEAD').trim());
    expect(Math.abs(first.time - Date.now())).toBeLessThan(60_000);
    expect(await listChangesBetween(repo, first.parent, first.hash)).toEqual([
      { path: 'a.txt', status: 'modified' },
    ]);
    // Applied, it stays; popped, it goes; with the index reinstated.
    run(repo, 'reset', '-q', '--hard');
    await unstash(repo, 'stash@{1}', { pop: false, reinstateIndex: false }, as);
    expect(read(repo, 'a.txt')).toBe('first');
    expect(await listStashes(repo, as)).toHaveLength(2);
    run(repo, 'reset', '-q', '--hard');
    await unstash(repo, 'stash@{0}', { pop: true, reinstateIndex: true }, as);
    expect(run(repo, 'diff', '--cached', '--name-only')).toBe('b.txt\n');
    expect(read(repo, 'new.txt')).toBe('new');
    expect(await listStashes(repo, as)).toHaveLength(1);
    await dropStash(repo, 'stash@{0}', as);
    expect(await listStashes(repo, as)).toEqual([]);
    writeFileSync(join(repo, 'c.txt'), 'changed');
    await stash(repo, 'Again', { keepIndex: false, includeUntracked: false }, as);
    await clearStashes(repo, as);
    expect(await listStashes(repo, as)).toEqual([]);
  });

  it('lists none outside a repository', async () => {
    expect(await listStashes(join(root, 'nowhere'), as)).toEqual([]);
  });
});
