import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listFolder, toSlashes } from '../src/index.js';

describe('listFolder', () => {
  const root = mkdtempSync(join(tmpdir(), 'cerebro-files-'));
  for (const dir of ['src', 'Docs', '.git', 'node_modules']) mkdirSync(join(root, dir));
  for (const file of ['b.ts', 'README.md', 'a.ts', '.gitignore'])
    writeFileSync(join(root, file), '');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists folders first, then files, by name ignoring case, without .git', async () => {
    const entries = await listFolder(root);
    expect(entries.map((e) => `${e.kind === 'directory' ? '/' : ''}${e.name}`)).toEqual([
      '/Docs',
      '/node_modules',
      '/src',
      '.gitignore',
      'a.ts',
      'b.ts',
      'README.md',
    ]);
    expect(entries[0]?.path).toBe(`${toSlashes(root)}/Docs`);
  });

  it('joins with a slash, even after a trailing one', async () => {
    const entries = await listFolder(`${root}/`);
    expect(entries[0]?.path).toBe(`${toSlashes(root)}/Docs`);
  });

  it('writes Windows paths with slashes, and leaves others alone', () => {
    expect(toSlashes('C:\\repo\\src', 'win32')).toBe('C:/repo/src');
    expect(toSlashes('/odd\\name', 'linux')).toBe('/odd\\name');
    expect(toSlashes(root)).toBe(process.platform === 'win32' ? root.replaceAll('\\', '/') : root);
  });

  it('fails for a folder that isn’t there', async () => {
    await expect(listFolder(join(root, 'missing'))).rejects.toThrow(/ENOENT/);
  });
});
