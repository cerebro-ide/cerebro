import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { filesByRipgrep, folderFiles, notARepository } from '../src/index.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-folder-files-')));
/** A folder without git: an ignore file, a hidden folder, a nested file. */
const plain = join(root, 'plain');
mkdirSync(join(plain, 'src', 'deep'), { recursive: true });
mkdirSync(join(plain, 'out'));
mkdirSync(join(plain, '.config'));
writeFileSync(join(plain, 'src', 'deep', 'a.ts'), 'export const a = 1;\n');
writeFileSync(join(plain, 'out', 'built.js'), '');
writeFileSync(join(plain, '.config', 'x.json'), '{}');
writeFileSync(join(plain, '.gitignore'), 'out/\n');
const repo = join(root, 'repo');
execFileSync('git', ['init', '-q', '-b', 'main', repo]);
writeFileSync(join(repo, 'tracked.ts'), '');
execFileSync('git', ['add', '.'], { cwd: repo });

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('folder files', () => {
  it('lists a folder without git with ripgrep: hidden files too, ignored ones not', async () => {
    expect(await filesByRipgrep(plain)).toEqual(['.config/x.json', '.gitignore', 'src/deep/a.ts']);
    expect(await folderFiles(plain)).toEqual(['.config/x.json', '.gitignore', 'src/deep/a.ts']);
  });

  it('lists none in an empty folder, and fails without ripgrep', async () => {
    const empty = join(root, 'empty');
    mkdirSync(empty);
    expect(await filesByRipgrep(empty)).toEqual([]);
    await expect(filesByRipgrep(plain, join(root, 'no-rg'))).rejects.toThrow();
  });

  it('takes git’s list in a repository, and passes on git’s other failures', async () => {
    expect(await folderFiles(repo)).toEqual(['tracked.ts']);
    const broken = () => Promise.reject(new Error('fatal: bad object'));
    await expect(folderFiles(repo, broken)).rejects.toThrow('bad object');
  });

  it('knows git’s failure outside a repository', () => {
    expect(notARepository(new Error('fatal: not a git repository (or any parent)'))).toBe(true);
    expect(notARepository(new Error('fatal: bad object'))).toBe(false);
    expect(notARepository('not a git repository')).toBe(false);
  });
});
