import { describe, expect, it } from 'vitest';
import { deleteQuestion } from '../src/delete-file.js';
import type { FileNode } from '../src/project.js';

const file = (name: string): FileNode => ({ path: `/r/${name}`, name, kind: 'file' });
const folder = (name: string): FileNode => ({ path: `/r/${name}`, name, kind: 'directory' });

describe('Delete’s question for several', () => {
  it('counts them by kind, one of a kind singular, as IntelliJ’s DeleteUtil', () => {
    expect(deleteQuestion([file('a.ts'), folder('x'), folder('y')])).toEqual([
      'Delete 1 file and 2 directories?',
      'All files and subdirectories in the selected directory(s) will be deleted.',
      'You might not be able to fully undo this operation!',
    ]);
    expect(deleteQuestion([folder('x'), folder('y')])[0]).toBe('Delete 2 directories?');
    expect(deleteQuestion([file('a.ts'), file('b.ts'), file('c.ts')])).toEqual(['Delete 3 files?']);
  });
});
