import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { detectIndent, indentText, indentUnitOf, languageFor } from '../src/index.js';

const settings = { tabs: false, size: 4 };

/** A file's indent, as detected; its language from `path`. */
function detected(lines: string[], path = 'a.txt') {
  const language = languageFor(path);
  const state = EditorState.create({
    doc: lines.join('\n'),
    extensions: language ? [language] : [],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return detectIndent(state, settings, 8);
}

describe('a file’s indent', () => {
  it('is what most lines add to the line they’re nested in', () => {
    expect(detected(['a', '  b', '    c', '  d', 'e'])).toEqual({ tabs: false, size: 2 });
    expect(detected(['a {', '    b', '}', 'c {', '    d', '}'])).toEqual({ tabs: false, size: 4 });
  });

  it('is tabs when more lines start with one, at the tab size', () => {
    expect(detected(['a', '\tb', '\t\tc', '  d'])).toEqual({ tabs: true, size: 8 });
  });

  it('is the settings’ size in spaces when no size is clear, or it’s over 8', () => {
    expect(detected(['a', '  b', '     c', '   d', 'e'])).toEqual({ tabs: false, size: 4 });
    expect(detected(['a', '          b', 'c', '          d'])).toEqual({ tabs: false, size: 4 });
    // The most used is none: then the next.
    expect(detected(['a', 'b', 'c', 'd', '  e'])).toEqual({ tabs: false, size: 2 });
  });

  it('isn’t told by too few lines, unindented lines, or as many tabs as spaces', () => {
    expect(detected(['a', '  b'])).toBeUndefined();
    expect(detected(['a', '', 'b', 'c'])).toBeUndefined();
    expect(detected(['a', '  b', '\tc', '  d', '\te', '  f'])).toBeUndefined();
    expect(detected(['', 'x'.repeat(1024 * 1024), ''])).toBeUndefined();
  });

  it('leaves out lines that start in a comment', () => {
    const code = ['/**', ' * A', ' */', 'function f() {', '    return 1;', '}'];
    expect(detected(code, 'a.ts')).toEqual({ tabs: false, size: 4 });
    // As text, the comment's lines count: no size is clear, then 1 is.
    expect(detected(code)).toEqual({ tabs: false, size: 4 });
    expect(detected([...code, '/*', ' x', ' y', ' z', '*/'], 'a.ts')).toEqual({
      tabs: false,
      size: 4,
    });
    expect(detected([...code, '/*', ' x', ' y', ' z', '*/'])).toEqual({ tabs: false, size: 1 });
  });

  it('shows as IntelliJ’s status bar shows it, and indents with its unit', () => {
    expect(indentText({ tabs: true, size: 4 })).toBe('Tab');
    expect(indentText({ tabs: false, size: 1 })).toBe('1 space');
    expect(indentText({ tabs: false, size: 2 })).toBe('2 spaces');
    expect(indentUnitOf({ tabs: true, size: 4 })).toBe('\t');
    expect(indentUnitOf({ tabs: false, size: 2 })).toBe('  ');
  });
});
