import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BadQuery, rgArguments, searchText, toMatch } from '../src/index.js';

/** A folder, a git repository, with files to search. */
function folder(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-search-')));
  execFileSync('git', ['init', '-q', dir]);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, '.github'));
  mkdirSync(join(dir, 'build'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'const shape = new Shape();\nlet Shapes = [];\n');
  writeFileSync(join(dir, 'src', 'b.ts'), '// ünïcode shape\n');
  writeFileSync(join(dir, '.github', 'ci.yml'), 'shape: 1\n');
  writeFileSync(join(dir, 'build', 'out.js'), 'shape\n');
  writeFileSync(join(dir, '.gitignore'), 'build/\n');
  return dir;
}

const slashes = (path: string) => path.replaceAll('\\', '/');

describe('searchText', () => {
  it('finds a text ignoring case, in hidden files too, not in ignored ones, sorted', async () => {
    const dir = folder();
    const { matches, limited } = await searchText(dir, { query: 'shape' });
    expect(limited).toBe(false);
    expect(matches.map((m) => [m.path, m.line, m.ranges])).toEqual([
      [`${slashes(dir)}/.github/ci.yml`, 0, [[0, 5]]],
      [
        `${slashes(dir)}/src/a.ts`,
        0,
        [
          [6, 11],
          [18, 23],
        ],
      ],
      [`${slashes(dir)}/src/a.ts`, 1, [[4, 9]]],
      // After characters of two bytes: offsets in UTF-16, not bytes.
      [`${slashes(dir)}/src/b.ts`, 0, [[11, 16]]],
    ]);
    expect(matches[3]?.text).toBe('// ünïcode shape');
  });

  it('matches case, whole words, and regular expressions when asked', async () => {
    const dir = folder();
    const lines = async (query: string, options: object) =>
      (await searchText(dir, { query, ...options })).matches.map(
        (m) => `${m.path.slice(slashes(dir).length)}:${String(m.line)}`,
      );
    expect(await lines('Shape', { matchCase: true })).toEqual(['/src/a.ts:0', '/src/a.ts:1']);
    expect(await lines('Shape', { matchCase: true, words: true })).toEqual(['/src/a.ts:0']);
    expect(await lines('Shapes?\\b', { regex: true, matchCase: true })).toEqual([
      '/src/a.ts:0',
      '/src/a.ts:1',
    ]);
    // Not a regular expression unless asked.
    expect(await lines('Shapes?', {})).toEqual([]);
    expect(await lines('nowhere', {})).toEqual([]);
  });

  it('stops at its limit', async () => {
    const dir = folder();
    const { matches, limited } = await searchText(dir, { query: 'shape', limit: 2 });
    expect(matches).toHaveLength(2);
    expect(limited).toBe(true);
  });

  it('refuses a pattern ripgrep can’t read, and fails without ripgrep', async () => {
    const dir = folder();
    await expect(searchText(dir, { query: '(', regex: true })).rejects.toBeInstanceOf(BadQuery);
    await expect(searchText(dir, { query: 'x' }, join(dir, 'no-rg'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  // A script on Windows can't be run by its #! line.
  it.skipIf(process.platform === 'win32')(
    'says why when ripgrep fails without saying',
    async () => {
      const dir = folder();
      // Exits with 2, printing nothing.
      const script = join(dir, 'fail.sh');
      writeFileSync(script, '#!/bin/sh\nexit 2\n', { mode: 0o755 });
      await expect(searchText(dir, { query: 'x' }, script)).rejects.toThrow('The search failed');
    },
  );
});

describe('ripgrep', () => {
  it('is asked for what was set', () => {
    expect(rgArguments({ query: 'a' })).toEqual(
      expect.arrayContaining(['--fixed-strings', '--ignore-case', '--', 'a']),
    );
    const all = rgArguments({ query: '-a', matchCase: true, words: true, regex: true });
    expect(all).toEqual(expect.arrayContaining(['--case-sensitive', '--word-regexp']));
    expect(all).not.toContain('--fixed-strings');
    expect(all.at(-1)).toBe('-a');
  });

  it('skips lines that aren’t UTF-8, and drops matches past a cut line', () => {
    const data = { path: { text: 'a' }, lines: {}, line_number: 1, submatches: [] };
    expect(toMatch('/f', data)).toBeUndefined();
    expect(
      toMatch('/f/', {
        ...data,
        lines: { text: 'abc\r\n' },
        submatches: [
          { start: 1, end: 9 },
          { start: 9, end: 10 },
        ],
      }),
    ).toEqual({ path: '/f/a', line: 0, text: 'abc', ranges: [[1, 3]] });
  });
});
