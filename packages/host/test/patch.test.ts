import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createPatch, git, messageHeader, writePatch } from '../src/index.js';

describe('Create Patch, with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-patch-')));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
  const write = (cwd: string, files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(cwd, name, '..'), { recursive: true });
      writeFileSync(join(cwd, name), text);
    }
  };
  /** A repository under `root/projects/r`: `a.txt` and `src/b.txt`, then both changed. */
  const repo = join(root, 'projects', 'r');
  mkdirSync(repo, { recursive: true });
  run(repo, 'init', '-q', '-b', 'main');
  run(repo, 'config', 'core.autocrlf', 'false');
  run(repo, 'config', 'user.name', 'me');
  run(repo, 'config', 'user.email', 'me@t');
  write(repo, { 'a.txt': 'a\n', 'src/b.txt': 'b\n' });
  run(repo, 'add', '-A');
  run(repo, 'commit', '-qm', 'base');
  const base = run(repo, 'rev-parse', 'HEAD');
  write(repo, { 'a.txt': 'a2\n', 'src/b.txt': 'b2\n' });
  run(repo, 'add', '-A');
  run(repo, 'commit', '-qm', 'Change both\n\nWith a body.');
  const head = run(repo, 'rev-parse', 'HEAD');
  const range = { from: base, to: head };

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is git’s diff of the commit under its message, as IntelliJ’s, and applies with git', async () => {
    const patch = await createPatch(
      repo,
      range,
      [],
      { base: repo, reverse: false, message: 'Change both\n\nWith a body.\n' },
      git,
    );
    expect(
      patch.startsWith(
        'Subject: [PATCH] Change both\n\nWith a body.\n---\ndiff --git a/a.txt b/a.txt\n',
      ),
    ).toBe(true);
    expect(patch).toContain('+++ b/src/b.txt\n');
    // Applied where the commit isn't, it makes the commit's files.
    run(repo, 'checkout', '-q', base);
    writeFileSync(join(root, 'all.patch'), patch);
    run(repo, 'apply', join(root, 'all.patch'));
    expect(readFileSync(join(repo, 'src/b.txt'), 'utf8')).toBe('b2\n');
    run(repo, 'checkout', '-q', '-f', 'main');
  });

  it('keeps to the files asked for, and reversed, undoes them', async () => {
    const patch = await createPatch(repo, range, ['src/b.txt'], { base: repo, reverse: true }, git);
    expect(patch.startsWith('diff --git a/src/b.txt b/src/b.txt\n')).toBe(true);
    expect(patch).not.toContain('a.txt');
    expect(patch).toContain('-b2\n+b\n');
  });

  it('has paths relative to its base path: a folder in the repository, or one above it', async () => {
    const inside = await createPatch(
      repo,
      range,
      ['src/b.txt'],
      { base: join(repo, 'src'), reverse: false },
      git,
    );
    expect(inside.startsWith('diff --git a/b.txt b/b.txt\n')).toBe(true);
    const above = await createPatch(repo, range, ['a.txt'], { base: root, reverse: false }, git);
    expect(above.startsWith('diff --git a/projects/r/a.txt b/projects/r/a.txt\n')).toBe(true);
    expect(above).toContain('--- a/projects/r/a.txt\n+++ b/projects/r/a.txt\n');
    // Applied from the base path, it changes the repository's file.
    writeFileSync(
      join(root, 'above.patch'),
      await createPatch(repo, range, ['a.txt'], { base: root, reverse: true }, git),
    );
    execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', 'above.patch'], { cwd: root });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('a\n');
    run(repo, 'checkout', '-q', '--', 'a.txt');
    // Beside the repository, it holds none of it.
    await expect(
      createPatch(repo, range, [], { base: join(root, 'other'), reverse: false }, git),
    ).rejects.toThrow(`${join(root, 'other')} holds none of the repository`);
  });

  it('is the working tree’s changes, untracked files as new, the index untouched', async () => {
    write(repo, { 'a.txt': 'a3\n', 'new.txt': 'new\n' });
    const patch = await createPatch(
      repo,
      { from: 'HEAD' },
      ['a.txt', 'new.txt'],
      { base: repo, reverse: false, untracked: ['new.txt'] },
      git,
    );
    expect(patch).toContain('diff --git a/a.txt b/a.txt\n');
    expect(patch).toContain('-a2\n+a3\n');
    expect(patch).toContain('diff --git a/new.txt b/new.txt\nnew file mode 100644\n');
    expect(run(repo, 'status', '--porcelain')).toBe('M a.txt\n?? new.txt');
    // Reversed, still "a/" then "b/", above the repository too.
    const reversed = await createPatch(
      repo,
      { from: 'HEAD' },
      ['a.txt', 'new.txt'],
      { base: root, reverse: true, untracked: ['new.txt'] },
      git,
    );
    expect(reversed).toContain('--- a/projects/r/a.txt\n+++ b/projects/r/a.txt\n');
    expect(reversed).toContain('-a3\n+a2\n');
    expect(reversed).toContain('deleted file mode 100644');
    // Without untracked files, no index of its own.
    expect(
      await createPatch(repo, { from: 'HEAD' }, ['a.txt'], { base: repo, reverse: false }, git),
    ).toContain('+a3\n');
    run(repo, 'checkout', '-q', '--', 'a.txt');
    rmSync(join(repo, 'new.txt'));
  });

  it('is a new repository’s files, before anything was added: its index not there yet', async () => {
    const fresh = join(root, 'fresh');
    run(root, 'init', '-q', fresh);
    write(fresh, { 'f.txt': 'f\n' });
    const patch = await createPatch(
      fresh,
      { from: '4b825dc642cb6eb9a060e54bf8d69288fbee4904' },
      [],
      { base: fresh, reverse: false, untracked: ['f.txt'] },
      git,
    );
    expect(patch).toContain('diff --git a/f.txt b/f.txt\nnew file mode 100644\n');
    expect(run(fresh, 'status', '--porcelain')).toBe('?? f.txt');
  });

  it('sees a change only the index’s time tells of, with untracked files', async () => {
    // A file changed to the same size in the second its index entry was written, as a quick edit
    // after a checkout: git tells it from unchanged only as the index is no older than the file
    // ("racy git"). The copy of the index that untracked files take keeps its time (measured: a
    // copy made now hid the change, as in a full run under load).
    const racy = join(root, 'racy');
    mkdirSync(racy);
    run(racy, 'init', '-q', '-b', 'main');
    // Only the size and the time in seconds, as git compares by default.
    run(racy, 'config', 'core.checkStat', 'minimal');
    run(racy, 'config', 'user.name', 'me');
    run(racy, 'config', 'user.email', 'me@t');
    // A minute ago, so the copy made now is later.
    const mtime = new Date(Math.floor(Date.now() / 1000 - 60) * 1000);
    write(racy, { 'a.txt': 'x1\n' });
    utimesSync(join(racy, 'a.txt'), mtime, mtime);
    run(racy, 'add', 'a.txt');
    run(racy, 'commit', '-qm', 'x1');
    write(racy, { 'a.txt': 'x2\n', 'new.txt': 'new\n' });
    utimesSync(join(racy, 'a.txt'), mtime, mtime);
    utimesSync(join(racy, '.git', 'index'), mtime, mtime);
    const patch = await createPatch(
      racy,
      { from: 'HEAD' },
      ['a.txt', 'new.txt'],
      { base: racy, reverse: false, untracked: ['new.txt'] },
      git,
    );
    expect(patch).toContain('-x1\n+x2\n');
  });

  it('is written to its file, its folders made', async () => {
    const file = join(root, 'out', 'deep', 'x.patch');
    await writePatch(file, 'the patch');
    expect(readFileSync(file, 'utf8')).toBe('the patch');
  });

  it('has no header without a message', () => {
    expect(messageHeader(undefined)).toBe('');
    expect(messageHeader('  \n')).toBe('');
    expect(messageHeader(' Fix it \n')).toBe('Subject: [PATCH] Fix it\n---\n');
  });
});
