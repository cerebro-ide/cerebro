import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listFolder, MAX_FILE_SIZE, readTextFile, toSlashes } from '../src/index.js';

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

  it('reads a text file as UTF-8', async () => {
    writeFileSync(join(root, 'text.md'), '# héllo\nwörld ✓');
    expect(await readTextFile(join(root, 'text.md'))).toBe('# héllo\nwörld ✓');
    writeFileSync(join(root, 'empty.txt'), '');
    expect(await readTextFile(join(root, 'empty.txt'))).toBe('');
  });

  it('refuses binary files and oversized ones', async () => {
    writeFileSync(join(root, 'image.png'), new Uint8Array([137, 80, 78, 71, 0, 1, 2]));
    await expect(readTextFile(join(root, 'image.png'))).rejects.toMatchObject({
      reason: 'binary',
      message: expect.stringContaining('binary') as unknown,
    });
    writeFileSync(join(root, 'huge.log'), new Uint8Array(MAX_FILE_SIZE + 1).fill(97));
    await expect(readTextFile(join(root, 'huge.log'))).rejects.toMatchObject({
      reason: 'too large',
      message: expect.stringContaining('too large') as unknown,
    });
    await expect(readTextFile(join(root, 'missing.txt'))).rejects.toThrow(/ENOENT/);
  });

  it('fails for a folder that isn’t there', async () => {
    await expect(listFolder(join(root, 'missing'))).rejects.toThrow(/ENOENT/);
  });
});
