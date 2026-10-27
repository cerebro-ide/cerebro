import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BadQuery, byPlace, rgArguments, searchText, toMatch } from '../src/index.js';

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
  // Not UTF-8 (Latin-1's é): ripgrep gives its bytes, and it's left out.
  writeFileSync(
    join(dir, 'src', 'latin1.txt'),
    Buffer.from([0x73, 0x68, 0x61, 0x70, 0x65, 0xe9, 0x0a]),
  );
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

  it.skipIf(process.platform === 'win32')(
    'stops ripgrep when aborted, answering with what it found so far',
    async () => {
      const dir = folder();
      // Never finishes on its own; exec, so killing it kills the sleep, as it would ripgrep.
      const script = join(dir, 'slow.sh');
      writeFileSync(script, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
      const abortedAfter = async (ms: number) => {
        const controller = new AbortController();
        const searching = searchText(dir, { query: 'x' }, script, controller.signal);
        if (ms > 0) await new Promise((done) => setTimeout(done, ms));
        controller.abort();
        const started = Date.now();
        expect(await searching).toEqual({ matches: [], limited: true });
        expect(Date.now() - started).toBeLessThan(5000);
      };
      // While ripgrep runs, and before it started.
      await abortedAfter(200);
      await abortedAfter(0);
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

  it('keeps only the files the masks match, and leaves out those a ! mask names', async () => {
    const dir = folder();
    const files = async (masks: string[]) => [
      ...new Set(
        (await searchText(dir, { query: 'shape', masks })).matches.map((m) =>
          m.path.slice(slashes(dir).length),
        ),
      ),
    ];
    // A mask without a slash matches a name in any folder.
    expect(await files(['*.ts'])).toEqual(['/src/a.ts', '/src/b.ts']);
    expect(await files(['*.ts', '!b.ts'])).toEqual(['/src/a.ts']);
    expect(await files(['!*.ts'])).toEqual(['/.github/ci.yml']);
    expect(rgArguments({ query: 'a', masks: ['*.ts'] })).toContain('--glob=*.ts');
  });

  it('refuses a folder that isn’t there', async () => {
    const dir = folder();
    await expect(searchText(join(dir, 'none'), { query: 'a' })).rejects.toThrow(BadQuery);
    await expect(searchText(join(dir, '.gitignore'), { query: 'a' })).rejects.toThrow(
      'No such folder',
    );
  });

  it('orders lines by path, then line', () => {
    const at = (path: string, line: number) => ({ path, line, text: '', ranges: [] });
    expect([at('/b', 0), at('/a', 2), at('/a', 1)].sort(byPlace)).toEqual([
      at('/a', 1),
      at('/a', 2),
      at('/b', 0),
    ]);
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
