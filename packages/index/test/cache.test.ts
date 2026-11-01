import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BlobIndex, indexVersion, loadIndex, saveIndex } from '../src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'cerebro-index-cache-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the index on disk', () => {
  it('saves the parsed blobs and loads them back as they were', async () => {
    const index = await BlobIndex.create();
    index.add('a1', () => 'export class Shape {}\nconst s = new Shape();\n', 'typescript');
    index.add('b2', () => 'def walk():\n    pass\n', 'python');
    const file = join(dir, 'nested', 'repo.json');
    const version = indexVersion();
    await saveIndex(index, file, version);
    // Written whole: nothing left beside it.
    expect(readdirSync(join(dir, 'nested'))).toEqual(['repo.json']);
    const loaded = await BlobIndex.create();
    // One it has already is kept, not replaced.
    loaded.add('b2', () => 'def run():\n    pass\n', 'python');
    expect(await loadIndex(loaded, file, version)).toBe(1);
    expect(loaded.blobs.get('a1')).toEqual(index.blobs.get('a1'));
    expect(loaded.blobs.get('b2')?.definitions[0]?.name).toBe('run');
  });

  it('ignores a cache from another parser, an unreadable one, and none', async () => {
    const index = await BlobIndex.create();
    index.add('a1', () => 'export const one = 1;\n', 'typescript');
    const file = join(dir, 'other.json');
    await saveIndex(index, file, 'another');
    const loaded = await BlobIndex.create();
    expect(await loadIndex(loaded, file, indexVersion())).toBe(0);
    writeFileSync(file, '{ not json');
    expect(await loadIndex(loaded, file, indexVersion())).toBe(0);
    expect(await loadIndex(loaded, join(dir, 'missing.json'), indexVersion())).toBe(0);
    expect(loaded.blobs.size).toBe(0);
  });

  it('names the parser: the same each time', () => {
    expect(indexVersion()).toMatch(/^[0-9a-f]{64}$/);
    expect(indexVersion()).toBe(indexVersion());
  });
});
