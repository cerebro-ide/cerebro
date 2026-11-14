import { describe, expect, it } from 'vitest';
import { movedPath, renameError } from '../src/rename-file.js';

describe('a renamed file’s or folder’s paths', () => {
  it('move with it, its own and those inside it, not those beside it', () => {
    expect(movedPath('/r/a.ts', '/r/a.ts', '/r/b.ts')).toBe('/r/b.ts');
    expect(movedPath('/r/lib/x/c.ts', '/r/lib', '/r/src')).toBe('/r/src/x/c.ts');
    expect(movedPath('/r/library/c.ts', '/r/lib', '/r/src')).toBeUndefined();
  });
});

describe('a new name', () => {
  const entries = [{ path: '/r/a.ts', name: 'a.ts', kind: 'file' as const }];

  it('is one name not taken beside it', () => {
    expect(renameError('b.ts', entries)).toBeUndefined();
    expect(renameError('a.ts', entries)).toBe('File a.ts already exists');
    for (const name of ['a/b', 'a\\b', '.', '..']) {
      expect(renameError(name, entries)).toBe(`'${name}' is an invalid file name`);
    }
  });
});
