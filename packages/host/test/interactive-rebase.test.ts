import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  continueOperation,
  COULDNT_START,
  editMessage,
  editSequence,
  git,
  interactiveRebase,
  rebaseCommits,
  rebaseEditor,
  shellWord,
} from '../src/index.js';

const folder = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-interactive-')));
// Git runs the editor as the host would, through a script importing its source as it is.
const shim = join(folder, 'editor.mjs');
writeFileSync(
  shim,
  `import { rebaseEditor } from ${JSON.stringify(resolve('src/rebase-editor.ts'))};\n` +
    'process.exitCode = rebaseEditor(process.argv.slice(2), process.env, process.stderr);\n',
);
const editor = `${shellWord(process.execPath)} ${shellWord(shim)}`;

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('Interactive Rebase, with real git', () => {
  const repo = join(folder, 'repo');
  mkdirSync(repo);
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();
  run('init', '-q', '-b', 'main');
  run('config', 'core.autocrlf', 'false');
  run('config', 'user.name', 't');
  run('config', 'user.email', 't@t');
  const commit = (name: string, message = name) => {
    writeFileSync(join(repo, `${name}.txt`), `${name}\n`);
    run('add', '.');
    run('commit', '-qm', message);
    return run('rev-parse', 'HEAD');
  };
  const first = commit('one');
  const second = commit('two', 'two\n\nits body');
  const third = commit('three');
  const fourth = commit('four');
  const subjects = () => run('log', '--format=%s', 'main').split('\n');

  beforeEach(() => {
    if (existsSync(join(repo, '.git', 'rebase-merge'))) run('rebase', '--abort');
    run('checkout', '-q', '-B', 'main');
    run('reset', '-q', '--hard', fourth);
  });

  it('lists the commits from one to HEAD, the oldest first, as git would, merges left out', async () => {
    expect(await rebaseCommits(repo, second, git)).toEqual([
      { hash: second, subject: 'two', message: 'two\n\nits body\n' },
      { hash: third, subject: 'three', message: 'three\n' },
      { hash: fourth, subject: 'four', message: 'four\n' },
    ]);
    // From the first: all of them.
    expect((await rebaseCommits(repo, first, git)).map((c) => c.subject)).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);
    run('checkout', '-q', '-b', 'side', third);
    const side = commit('side');
    run('checkout', '-q', 'main');
    run('merge', '-q', '--no-edit', side);
    expect((await rebaseCommits(repo, third, git)).map((c) => c.subject)).toEqual([
      'three',
      'four',
      'side',
    ]);
    run('branch', '-D', 'side');
  });

  it('rebases with the dialog’s list: moved, reworded, fixed up and dropped; local changes kept', async () => {
    writeFileSync(join(repo, 'one.txt'), 'local\n');
    const result = await interactiveRebase(
      repo,
      second,
      [second, third, fourth],
      [
        { action: 'reword', hash: fourth, message: 'four, better\n\nwhy' },
        { action: 'pick', hash: second },
        { action: 'fixup', hash: third },
      ],
      editor,
      git,
    );
    expect(result).toBe('done');
    expect(subjects()).toEqual(['two', 'four, better', 'one']);
    expect(run('log', '-1', '--format=%B', 'HEAD~1')).toBe('four, better\n\nwhy');
    // Fixed up into two: its file, two's message.
    expect(run('log', '-1', '--format=%B', 'HEAD')).toBe('two\n\nits body');
    expect(run('show', '--format=', '--name-only', 'HEAD')).toBe('three.txt\ntwo.txt');
    expect(run('status', '--porcelain')).toBe('M one.txt');
    run('checkout', '--', 'one.txt');
  });

  it('drops a commit, from the first one, with --root', async () => {
    expect(
      await interactiveRebase(
        repo,
        first,
        [first, second, third, fourth],
        [
          { action: 'pick', hash: first },
          { action: 'drop', hash: second },
          { action: 'pick', hash: third },
          { action: 'pick', hash: fourth },
        ],
        editor,
        git,
      ),
    ).toBe('done');
    expect(subjects()).toEqual(['four', 'three', 'one']);
  });

  it('stops to edit, and the rewords after it are made when it’s continued', async () => {
    const result = await interactiveRebase(
      repo,
      third,
      [third, fourth],
      [
        { action: 'edit', hash: third },
        { action: 'reword', hash: fourth, message: 'four, later' },
      ],
      editor,
      git,
    );
    expect(result).toBe('stopped');
    expect(run('log', '--format=%s', 'HEAD').split('\n')).toEqual(['three', 'two', 'one']);
    expect(await continueOperation(repo, git, editor)).toBe('done');
    expect(subjects()).toEqual(['four, later', 'three', 'two', 'one']);
  });

  it('stops at conflicts, under way', async () => {
    const edit = (text: string) => {
      writeFileSync(join(repo, 'x.txt'), text);
      run('add', '.');
      run('commit', '-qm', text.trim());
      return run('rev-parse', 'HEAD');
    };
    const a = edit('a\n');
    const b = edit('b\n');
    // b's change before a's, which made the line it changes: they clash.
    expect(
      await interactiveRebase(
        repo,
        a,
        [a, b],
        [
          { action: 'pick', hash: b },
          { action: 'pick', hash: a },
        ],
        editor,
        git,
      ),
    ).toBe('stopped');
    expect(run('ls-files', '-u')).toContain('x.txt');
  });

  it('does nothing, in IntelliJ’s words, when git’s list isn’t the dialog’s', async () => {
    await expect(
      interactiveRebase(
        repo,
        third,
        [fourth, third],
        [{ action: 'drop', hash: third }],
        editor,
        git,
      ),
    ).rejects.toThrow(COULDNT_START);
    expect(run('rev-parse', 'HEAD')).toBe(fourth);
    expect(existsSync(join(repo, '.git', 'rebase-merge'))).toBe(false);
  });
});

describe('git’s editors in an interactive rebase', () => {
  const gitDir = join(folder, 'git');
  const file = join(folder, 'file');
  const onto = (hash: string) => {
    mkdirSync(join(gitDir, 'rebase-merge'), { recursive: true });
    writeFileSync(join(gitDir, 'rebase-merge', 'onto'), `${hash}\n`);
  };
  const kept = () =>
    JSON.parse(readFileSync(join(gitDir, 'cerebro-reworded.json'), 'utf8')) as unknown;
  const plan = {
    expected: ['abcdef12', '12345678'],
    todo: 'reword 12345678\npick abcdef12\n',
    messages: [{ original: 'old', reworded: 'new' }],
  };

  beforeEach(() => {
    rmSync(gitDir, { recursive: true, force: true });
    onto('aaaa');
  });

  it('writes the list over git’s where git’s is the one expected, keeping the messages', () => {
    writeFileSync(file, '# a comment\npick abcdef1 Its subject\n\np 1234567 Another\n');
    expect(editSequence(file, plan, gitDir)).toBeUndefined();
    expect(readFileSync(file, 'utf8')).toBe(plan.todo);
    expect(kept()).toEqual({ onto: 'aaaa', current: 0, messages: plan.messages });
    // Other commands, fewer commits, or others: not git's list as expected.
    for (const todo of [
      'exec make\n',
      'pick abcdef1\n',
      'pick 1234567\npick abcdef1\n',
      'pick\n',
    ]) {
      writeFileSync(file, todo);
      expect(editSequence(file, plan, gitDir)).toBe(COULDNT_START);
    }
  });

  it('gives each message in turn, where git’s starts with the one it replaces', () => {
    writeFileSync(file, 'pick abcdef1\npick 1234567\n');
    editSequence(
      file,
      { ...plan, messages: [...plan.messages, { original: 'b', reworded: 'B' }] },
      gitDir,
    );
    writeFileSync(file, 'old\n# Please enter the commit message\n');
    editMessage(file, gitDir);
    expect(readFileSync(file, 'utf8')).toBe('new');
    // Not the next one's: left as git wrote it.
    writeFileSync(file, 'other\n');
    editMessage(file, gitDir);
    expect(readFileSync(file, 'utf8')).toBe('other\n');
    // Another rebase's: left.
    onto('bbbb');
    writeFileSync(file, 'b\n');
    editMessage(file, gitDir);
    expect(readFileSync(file, 'utf8')).toBe('b\n');
    onto('aaaa');
    editMessage(file, gitDir);
    expect(readFileSync(file, 'utf8')).toBe('B');
    // None left.
    writeFileSync(file, 'b\n');
    editMessage(file, gitDir);
    expect(readFileSync(file, 'utf8')).toBe('b\n');
  });

  it('leaves git’s message with none kept, or no rebase under way', () => {
    writeFileSync(file, 'old\n');
    editMessage(file, gitDir);
    expect(readFileSync(file, 'utf8')).toBe('old\n');
    writeFileSync(
      join(gitDir, 'cerebro-reworded.json'),
      JSON.stringify({ onto: 'aaaa', current: 0, messages: plan.messages }),
    );
    rmSync(join(gitDir, 'rebase-merge'), { recursive: true });
    editMessage(file, gitDir);
    expect(readFileSync(file, 'utf8')).toBe('old\n');
  });

  it('runs as git’s editor: its exit code, and why on the standard error', () => {
    const planFile = join(folder, 'plan.json');
    writeFileSync(planFile, JSON.stringify(plan));
    const env = { CEREBRO_REBASE_PLAN: planFile, CEREBRO_GIT_DIR: gitDir };
    const said: string[] = [];
    const stderr = { write: (text: string) => said.push(text) };
    writeFileSync(file, 'pick abcdef1\npick 1234567\n');
    expect(rebaseEditor(['sequence', file], env, stderr)).toBe(0);
    writeFileSync(file, 'pick 1234567\n');
    expect(rebaseEditor(['sequence', file], env, stderr)).toBe(1);
    expect(said).toEqual([`${COULDNT_START}\n`]);
    writeFileSync(file, 'old\n');
    expect(rebaseEditor(['message', file], env, stderr)).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('new');
    // Without its environment: git's message left.
    writeFileSync(file, 'old\n');
    expect(rebaseEditor(['message'], {}, stderr)).toBe(0);
    expect(rebaseEditor(['message', file], {}, stderr)).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('old\n');
  });
});
