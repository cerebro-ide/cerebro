import { describe, expect, it } from 'vitest';
import { nameError } from '../src/new-file.js';

describe('a new file’s name', () => {
  const entries = [
    { path: '/r/a.ts', name: 'a.ts', kind: 'file' as const },
    { path: '/r/src', name: 'src', kind: 'directory' as const },
  ];

  it('is taken when its first part is there, or goes through a file', () => {
    expect(nameError('a.ts', entries)).toBe("A file with the name 'a.ts' already exists");
    expect(nameError('src', entries)).toBe("A directory with the name 'src' already exists");
    expect(nameError('a.ts/b.ts', entries)).toBe("A file with the name 'a.ts' already exists");
  });

  it('is free when it isn’t there, or goes into a folder that is', () => {
    expect(nameError('b.ts', entries)).toBeUndefined();
    expect(nameError('src/b.ts', entries)).toBeUndefined();
  });

  it('is invalid with an empty part, or one that’s . or ..', () => {
    for (const name of ['a//b', 'a/', '../a', './a']) {
      expect(nameError(name, entries)).toBe(`'${name}' is an invalid file name`);
    }
  });
});
