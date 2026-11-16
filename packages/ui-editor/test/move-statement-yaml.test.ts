import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { languageFor, moveStatement } from '../src/index.js';

/**
 * The text after Move Statement Up or Down in a YAML file, the caret (or a selection's ends) written
 * `|`; as it was where nothing moves.
 */
function moved(marked: string, up: boolean, expected?: string) {
  const at = [...marked.matchAll(/\|/g)].map((m, i) => m.index - i);
  const state = EditorState.create({
    doc: marked.replaceAll('|', ''),
    selection: EditorSelection.range(at[0] as number, at[1] ?? (at[0] as number)),
    extensions: [languageFor('a.yaml') ?? []],
  });
  const spec = moveStatement(state, up);
  if (!spec) return marked;
  const next = state.update(spec).state;
  const text = next.doc.toString();
  const { from, to } = next.selection.main;
  if (expected !== undefined && !expected.includes('|')) return text;
  return from === to
    ? `${text.slice(0, from)}|${text.slice(from)}`
    : `${text.slice(0, from)}|${text.slice(from, to)}|${text.slice(to)}`;
}

// IntelliJ's own tests (`YAMLStatementMoverTest`), each moved the way it moves it: `<caret>` and
// `<selection>` written `|`.
describe('Move Statement in YAML, as IntelliJ’s tests have it', () => {
  it('TopKeyValueUp', () => {
    expect(
      moved(
        'top1:\n  child1: hi\ntop2|:\n  child2: bye',
        true,
        'top2|:\n  child2: bye\ntop1:\n  child1: hi\n',
      ),
    ).toBe('top2|:\n  child2: bye\ntop1:\n  child1: hi\n');
  });

  it('TopKeyValueDown', () => {
    expect(
      moved(
        'top1|:\n  child1: hi\ntop2:\n  child2: bye',
        false,
        'top2:\n  child2: bye\ntop1|:\n  child1: hi\n',
      ),
    ).toBe('top2:\n  child2: bye\ntop1|:\n  child1: hi\n');
  });

  it('NonTopKeyValueDown', () => {
    expect(
      moved(
        'megatop:\n  subtop1|:\n    child1: hi\n  subtop2:\n    child2: bye\n  subtop3:\n    child3: hello',
        false,
        'megatop:\n  subtop2:\n    child2: bye\n  subtop1|:\n    child1: hi\n  subtop3:\n    child3: hello',
      ),
    ).toBe(
      'megatop:\n  subtop2:\n    child2: bye\n  subtop1|:\n    child1: hi\n  subtop3:\n    child3: hello',
    );
  });

  it('NonTopKeyValueUp', () => {
    expect(
      moved(
        'megatop:\n  subtop1:\n    child1: hi\n  subtop2|:\n    child2: bye\n  subtop3:\n    child3: hello',
        true,
        'megatop:\n  subtop2|:\n    child2: bye\n  subtop1:\n    child1: hi\n  subtop3:\n    child3: hello',
      ),
    ).toBe(
      'megatop:\n  subtop2|:\n    child2: bye\n  subtop1:\n    child1: hi\n  subtop3:\n    child3: hello',
    );
  });

  it('NonTopKeyValueDownWithSelection', () => {
    expect(
      moved(
        'megatop:\n  |subtop1:\n    child1: hi\n  subtop2:\n    child2: bye|\n  subtop3:\n    child3: hello',
        false,
        'megatop:\n  subtop3:\n    child3: hello\n  |subtop1:\n    child1: hi\n  subtop2:\n    child2: bye|\n',
      ),
    ).toBe(
      'megatop:\n  subtop3:\n    child3: hello\n  |subtop1:\n    child1: hi\n  subtop2:\n    child2: bye|\n',
    );
  });

  it('NonTopKeyValueUpWithSelection', () => {
    expect(
      moved(
        'megatop:\n  subtop1:\n    child1: hi\n  |subtop2:\n    child2: bye\n  subtop3:\n    child3: hello|',
        true,
        'megatop:\n  |subtop2:\n    child2: bye\n  subtop3:\n    child3: hello|\n  subtop1:\n    child1: hi\n',
      ),
    ).toBe(
      'megatop:\n  |subtop2:\n    child2: bye\n  subtop3:\n    child3: hello|\n  subtop1:\n    child1: hi\n',
    );
  });

  it('TopItemDown', () => {
    expect(
      moved(
        '|- subkey1:\n    value 1\n  subkey2:\n    value 2\n- item 2\n- item 3',
        false,
        '- item 2\n|- subkey1:\n    value 1\n  subkey2:\n    value 2\n- item 3',
      ),
    ).toBe('- item 2\n|- subkey1:\n    value 1\n  subkey2:\n    value 2\n- item 3');
  });

  it('TopItemUp', () => {
    expect(
      moved(
        '- subkey1:\n    value 1\n  subkey2:\n    value 2\n- item 2|\n- item 3',
        true,
        '- item 2|\n- subkey1:\n    value 1\n  subkey2:\n    value 2\n- item 3',
      ),
    ).toBe('- item 2|\n- subkey1:\n    value 1\n  subkey2:\n    value 2\n- item 3');
  });

  it('NonTopItemDown', () => {
    expect(
      moved(
        'top-array:\n  |- subkey1:\n      value 1\n    subkey2:\n      value 2\n  - subkey3:\n      value 1\n    subkey4:\n      value 2\n  - item 3',
        false,
        'top-array:\n  - subkey3:\n      value 1\n    subkey4:\n      value 2\n  |- subkey1:\n      value 1\n    subkey2:\n      value 2\n  - item 3',
      ),
    ).toBe(
      'top-array:\n  - subkey3:\n      value 1\n    subkey4:\n      value 2\n  |- subkey1:\n      value 1\n    subkey2:\n      value 2\n  - item 3',
    );
  });

  it('NonTopItemUp', () => {
    expect(
      moved(
        'top-array:\n  - subkey1:\n      value 1\n    subkey2:\n      value 2\n  |- subkey3:\n      value 1\n    subkey4:\n      value 2\n  - item 3',
        true,
        'top-array:\n  |- subkey3:\n      value 1\n    subkey4:\n      value 2\n  - subkey1:\n      value 1\n    subkey2:\n      value 2\n  - item 3',
      ),
    ).toBe(
      'top-array:\n  |- subkey3:\n      value 1\n    subkey4:\n      value 2\n  - subkey1:\n      value 1\n    subkey2:\n      value 2\n  - item 3',
    );
  });

  it('NonTopItemDownWithSelectionParts', () => {
    expect(
      moved(
        'top-array:\n  - subkey1:\n      value 1\n    |subkey2:\n      value 2\n  - subkey3:\n      value 3|\n    subkey4:\n      value 4\n  - subkey5:\n      value 5\n    subkey6:\n      value 6\n  - item 4',
        false,
        'top-array:\n  - subkey5:\n      value 5\n    subkey6:\n      value 6\n  - subkey1:\n      value 1\n    |subkey2:\n      value 2\n  - subkey3:\n      value 3|\n    subkey4:\n      value 4\n  - item 4',
      ),
    ).toBe(
      'top-array:\n  - subkey5:\n      value 5\n    subkey6:\n      value 6\n  - subkey1:\n      value 1\n    |subkey2:\n      value 2\n  - subkey3:\n      value 3|\n    subkey4:\n      value 4\n  - item 4',
    );
  });

  it('MoveLastDown', () => {
    expect(moved('top1: hi\ntop2|: bye\n', false, 'top1: hi\ntop2|: bye\n')).toBe(
      'top1: hi\ntop2|: bye\n',
    );
  });
});

describe('Move Statement in YAML, beyond IntelliJ’s tests', () => {
  it('passes a comment on the moved lines’ last line, and moves past a comment’s line', () => {
    expect(moved('a|: 1 # one\nb: 2\n', false)).toBe('b: 2\na|: 1 # one\n');
    expect(moved('a|: 1\n# lone\nb: 2\n', false)).toBe('# lone\na|: 1\nb: 2\n');
    expect(moved('a|: 1 # one\n# two\nb: 2\n', false)).toBe('# two\na|: 1 # one\nb: 2\n');
    // A comment's own line moves past the pair beside it.
    expect(moved('a: 1\n# lo|ne\nb: 2\n', false)).toBe('a: 1\nb: 2\n# lo|ne\n');
  });

  it('takes a sequence item without a value with its `-`', () => {
    expect(moved('-|\n- b\n', false)).toBe('- b\n-|\n');
  });

  it('moves the lines as IntelliJ’s LineMover where there’s no element beside them', () => {
    // The last in its mapping: past the next line, indented again.
    expect(moved('a:\n  x|: 1\nb: 2\n', false)).toBe('a:\nb: 2\n  x|: 1\n');
    // A scalar alone on its line; a flow collection, in no block one; a comment outside one.
    expect(moved('a: >\n  x\n  y|\n', true)).toBe('a: >\n  y|\n  x\n');
    expect(moved('[1, 2]\n[|3]\n', true)).toBe('[|3]\n[1, 2]\n');
    expect(moved('# top\n# u|p\n', true)).toBe('# u|p\n# top\n');
    // A blank line, and one with nothing after it; nothing past the first line.
    expect(moved('a: 1\n|', true)).toBe('|\na: 1\n');
    expect(moved('|\na: 1\n', false)).toBe('a: 1\n|\n');
    expect(moved('a|: 1\nb: 2\n', true)).toBe('a|: 1\nb: 2\n');
  });
});
