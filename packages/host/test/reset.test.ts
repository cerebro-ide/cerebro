import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { git, resetHead } from '../src/index.js';

describe('Reset HEAD, with real git', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-reset-')));
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();
  run('init', '-q', '-b', 'main');
  run('config', 'core.autocrlf', 'false');
  run('config', 'user.name', 't');
  run('config', 'user.email', 't@t');
  const commit = (text: string) => {
    writeFileSync(join(repo, 'a.txt'), text);
    run('add', '.');
    run('commit', '-qm', text);
  };
  commit('one\n');
  const first = run('rev-parse', 'HEAD');
  let second = '';
  const file = () => readFileSync(join(repo, 'a.txt'), 'utf8');
  const staged = () => run('diff', '--cached', '--name-only');

  beforeEach(() => {
    run('reset', '-q', '--hard', first);
    commit('two\n');
    second = run('rev-parse', 'HEAD');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('Mixed: the branch moved, the file as it was, its changes not staged', async () => {
    await resetHead(repo, 'mixed', first, git);
    expect(run('rev-parse', 'HEAD')).toBe(first);
    expect(file()).toBe('two\n');
    expect(staged()).toBe('');
  });

  it('Soft: the branch moved, its changes staged', async () => {
    await resetHead(repo, 'soft', 'HEAD~1', git);
    expect(run('rev-parse', 'HEAD')).toBe(first);
    expect(staged()).toBe('a.txt');
  });

  it('Hard: the files as the commit has them, local changes gone', async () => {
    writeFileSync(join(repo, 'a.txt'), 'local\n');
    await resetHead(repo, 'hard', first, git);
    expect(run('rev-parse', 'HEAD')).toBe(first);
    expect(file()).toBe('one\n');
  });

  it('to HEAD when no commit is given; a commit named as a file is taken as a commit', async () => {
    writeFileSync(join(repo, 'a.txt'), 'local\n');
    run('add', '.');
    await resetHead(repo, 'mixed', undefined, git);
    expect(run('rev-parse', 'HEAD')).toBe(second);
    expect(staged()).toBe('');
    await expect(resetHead(repo, 'mixed', 'a.txt', git)).rejects.toThrow();
    expect(file()).toBe('local\n');
  });
});
