import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  createEntry,
  createScratch,
  empty,
  exists,
  listFolder,
  MAPPED_WAIT,
  MAX_FILE_SIZE,
  readFileBytes,
  readTextFile,
  renameEntry,
  copyEntry,
  toSlashes,
} from '../src/index.js';

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
    // A byte order mark is kept, for the file to be saved with it.
    writeFileSync(join(root, 'bom.txt'), '\uFEFFmarked');
    expect(await readTextFile(join(root, 'bom.txt'))).toBe('\uFEFFmarked');
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

  it('reads a file’s bytes, binary or not, refusing an oversized one', async () => {
    expect(await readFileBytes(join(root, 'image.png'))).toEqual(
      new Uint8Array([137, 80, 78, 71, 0, 1, 2]),
    );
    await expect(readFileBytes(join(root, 'huge.log'))).rejects.toMatchObject({
      reason: 'too large',
    });
  });

  it('tells whether a file is there, and fails when it can’t tell', async () => {
    writeFileSync(join(root, 'here.txt'), '');
    expect(await exists(join(root, 'here.txt'))).toBe(true);
    expect(await exists(join(root, 'gone.txt'))).toBe(false);
    // A file on the path where a folder should be.
    expect(await exists(join(root, 'here.txt', 'below.txt'))).toBe(false);
    await expect(exists('\0')).rejects.toThrow();
  });

  it('fails for a folder that isn’t there', async () => {
    await expect(listFolder(join(root, 'missing'))).rejects.toThrow(/ENOENT/);
  });
});

describe('createEntry', () => {
  const root = mkdtempSync(join(tmpdir(), 'cerebro-create-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('makes an empty file, or a folder, with the folders on its path', async () => {
    await createEntry(join(root, 'a', 'b.ts'), 'file');
    expect(readFileSync(join(root, 'a', 'b.ts'), 'utf8')).toBe('');
    await createEntry(join(root, 'c', 'd'), 'directory');
    expect(statSync(join(root, 'c', 'd')).isDirectory()).toBe(true);
  });

  it('fails for a file or folder that’s there, leaving it as it is', async () => {
    writeFileSync(join(root, 'kept.ts'), 'kept');
    await expect(createEntry(join(root, 'kept.ts'), 'file')).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(readFileSync(join(root, 'kept.ts'), 'utf8')).toBe('kept');
    await expect(createEntry(join(root, 'c'), 'directory')).rejects.toThrow(/EEXIST/);
  });
});

describe('createScratch', () => {
  const root = mkdtempSync(join(tmpdir(), 'cerebro-scratch-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('makes scratch, then scratch_ and the lowest number free, whatever the extension, as IntelliJ', async () => {
    const folder = join(root, 'scratches');
    expect(await createScratch(folder, 'ts')).toBe(`${folder}/scratch.ts`);
    expect(readFileSync(join(folder, 'scratch.ts'), 'utf8')).toBe('');
    expect(await createScratch(folder, 'py')).toBe(`${folder}/scratch_1.py`);
    // A gap is filled; a folder, or a name that isn't one of its, doesn't count.
    writeFileSync(join(folder, 'Scratch_3.md'), '');
    writeFileSync(join(folder, 'scratch_x.md'), '');
    writeFileSync(join(folder, 'scratch_4'), '');
    mkdirSync(join(folder, 'scratch_2'));
    expect(await createScratch(folder, 'txt')).toBe(`${folder}/scratch_2.txt`);
    expect(await createScratch(folder, 'txt')).toBe(`${folder}/scratch_5.txt`);
  });
});

describe('renameEntry', () => {
  const root = mkdtempSync(join(tmpdir(), 'cerebro-rename-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('renames a file or folder, never over one that’s there', async () => {
    writeFileSync(join(root, 'a.ts'), 'a');
    writeFileSync(join(root, 'kept.ts'), 'kept');
    await renameEntry(join(root, 'a.ts'), join(root, 'b.ts'));
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe('a');
    await expect(renameEntry(join(root, 'b.ts'), join(root, 'kept.ts'))).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(readFileSync(join(root, 'kept.ts'), 'utf8')).toBe('kept');
    mkdirSync(join(root, 'lib'));
    await renameEntry(join(root, 'lib'), join(root, 'src'));
    expect(statSync(join(root, 'src')).isDirectory()).toBe(true);
  });

  it('moves one into a folder, making it, and over a file only when asked', async () => {
    writeFileSync(join(root, 'm.ts'), 'm');
    await renameEntry(join(root, 'm.ts'), join(root, 'to/deep/m.ts'));
    expect(readFileSync(join(root, 'to/deep/m.ts'), 'utf8')).toBe('m');
    writeFileSync(join(root, 'n.ts'), 'n');
    await renameEntry(join(root, 'n.ts'), join(root, 'to/deep/m.ts'), true);
    expect(readFileSync(join(root, 'to/deep/m.ts'), 'utf8')).toBe('n');
  });
});

describe('copyEntry', () => {
  const root = mkdtempSync(join(tmpdir(), 'cerebro-copy-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copies a file, making the folders on its way, never over one unless asked', async () => {
    writeFileSync(join(root, 'a.ts'), 'a');
    writeFileSync(join(root, 'kept.ts'), 'kept');
    await copyEntry(join(root, 'a.ts'), join(root, 'new/deep/b.ts'));
    expect(readFileSync(join(root, 'new/deep/b.ts'), 'utf8')).toBe('a');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('a');
    await expect(copyEntry(join(root, 'a.ts'), join(root, 'kept.ts'))).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(readFileSync(join(root, 'kept.ts'), 'utf8')).toBe('kept');
    await copyEntry(join(root, 'a.ts'), join(root, 'kept.ts'), true);
    expect(readFileSync(join(root, 'kept.ts'), 'utf8')).toBe('a');
  });

  it('copies a folder with what’s in it; over one, its files joining it; never into itself', async () => {
    mkdirSync(join(root, 'lib/x'), { recursive: true });
    writeFileSync(join(root, 'lib/x/c.ts'), 'c');
    await copyEntry(join(root, 'lib'), join(root, 'src'));
    expect(readFileSync(join(root, 'src/x/c.ts'), 'utf8')).toBe('c');
    writeFileSync(join(root, 'src/x/c.ts'), 'changed');
    writeFileSync(join(root, 'src/own.ts'), 'own');
    await expect(copyEntry(join(root, 'lib'), join(root, 'src'))).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await copyEntry(join(root, 'lib'), join(root, 'src'), true);
    expect(readFileSync(join(root, 'src/x/c.ts'), 'utf8')).toBe('c');
    expect(readFileSync(join(root, 'src/own.ts'), 'utf8')).toBe('own');
    // As the page names them: with `/`.
    const lib = `${toSlashes(root)}/lib`;
    await expect(copyEntry(lib, `${lib}/lib`)).rejects.toThrow(
      'Cannot place directory into itself.',
    );
    await expect(copyEntry(lib, `${lib}/x/lib`)).rejects.toThrow(
      'Cannot place directory into its subdirectory.',
    );
  });
});

describe('empty', () => {
  const mapped = () =>
    Object.assign(new Error('UNKNOWN: unknown error, ftruncate'), { code: 'UNKNOWN' });

  it('waits on Windows while another process has the file mapped', async () => {
    const truncate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(mapped())
      .mockRejectedValueOnce(mapped())
      .mockResolvedValue(undefined);
    await empty({ truncate }, 'win32');
    expect(truncate).toHaveBeenCalledTimes(3);
    expect(truncate).toHaveBeenCalledWith(0);
  });

  it('gives up after its wait, and at once elsewhere or for another error', async () => {
    const always = vi.fn<() => Promise<void>>().mockRejectedValue(mapped());
    const started = performance.now();
    await expect(empty({ truncate: always }, 'win32', 50)).rejects.toThrow('UNKNOWN');
    expect(performance.now() - started).toBeGreaterThanOrEqual(50);
    expect(MAPPED_WAIT).toBe(2000);
    for (const [platform, error] of [
      ['linux', mapped()],
      ['win32', Object.assign(new Error('EBADF'), { code: 'EBADF' })],
    ] as const) {
      const truncate = vi.fn<() => Promise<void>>().mockRejectedValue(error);
      await expect(empty({ truncate }, platform)).rejects.toBe(error);
      expect(truncate).toHaveBeenCalledTimes(1);
    }
  });
});
