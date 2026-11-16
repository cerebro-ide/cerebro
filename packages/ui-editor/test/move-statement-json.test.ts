import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { languageFor, moveStatement } from '../src/index.js';

/**
 * The text after Move Statement Up or Down in a JSON file, the caret (or a selection's ends) written
 * `|` where `expected` marks it; undefined where nothing moves.
 */
function moved(marked: string, up: boolean, expected?: string) {
  const at = [...marked.matchAll(/\|/g)].map((m, i) => m.index - i);
  const state = EditorState.create({
    doc: marked.replaceAll('|', ''),
    selection: EditorSelection.range(at[0] as number, at[1] ?? (at[0] as number)),
    extensions: [languageFor('a.json') ?? []],
  });
  const spec = moveStatement(state, up);
  if (!spec) return undefined;
  const next = state.update(spec).state;
  const text = next.doc.toString();
  const { from, to } = next.selection.main;
  if (expected !== undefined && !expected.includes('|')) return text;
  return from === to
    ? `${text.slice(0, from)}|${text.slice(from)}`
    : `${text.slice(0, from)}|${text.slice(from, to)}|${text.slice(to)}`;
}

// IntelliJ's own tests' files (`json/backend/tests/testData/mover`, `JsonLineMoverTest`), each
// moved the way its test moves it: `<caret>` and `<selection>` written `|`. Where the file after
// marks no caret, the text alone is compared.
describe('Move Statement in JSON, as IntelliJ’s tests have it', () => {
  it('ArraySelectionMovedDown down', () => {
    expect(
      moved(
        '[\n  1, |[2],\n  [\n    true,\n    false\n  ]|,\n  null\n]',
        false,
        '[\n  null,\n  1, [2],\n  [\n    true,\n    false\n  ]\n]',
      ),
    ).toBe('[\n  null,\n  1, [2],\n  [\n    true,\n    false\n  ]\n]');
  });

  it('FromUpperIntoScope down', () => {
    expect(
      moved(
        '{\n  "b": 12,\n  "yet-a|nother-key1": "yet-another-value",\n  "foo": {\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value"\n  },\n  "yet-another-key5": "yet-another-value"\n}',
        false,
        '{\n  "b": 12,\n  "foo": {\n    "yet-a|nother-key1": "yet-another-value",\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value"\n  },\n  "yet-another-key5": "yet-another-value"\n}',
      ),
    ).toBe(
      '{\n  "b": 12,\n  "foo": {\n    "yet-a|nother-key1": "yet-another-value",\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value"\n  },\n  "yet-another-key5": "yet-another-value"\n}',
    );
  });

  it('InsideArray up', () => {
    expect(
      moved(
        '[\n  null,\n  1, [2],\n  [\n    true,\n    true,\n    true,\n    true,\n    false\n  ],\n  tr|ue,\n  false\n]\n',
        true,
        '[\n  null,\n  1, [2],\n  [\n    true,\n    true,\n    true,\n    true,\n    false,\n    tr|ue\n  ],\n  false\n]\n',
      ),
    ).toBe(
      '[\n  null,\n  1, [2],\n  [\n    true,\n    true,\n    true,\n    true,\n    false,\n    tr|ue\n  ],\n  false\n]\n',
    );
  });

  it('IntoScope up', () => {
    expect(
      moved(
        '{\n  "foo": {\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value"\n  },\n  "yet-a|nother-key1": "yet-another-value",\n  "yet-another-key5": "yet-another-value"\n}',
        true,
        '{\n  "foo": {\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value",\n    "yet-a|nother-key1": "yet-another-value"\n  },\n  "yet-another-key5": "yet-another-value"\n}',
      ),
    ).toBe(
      '{\n  "foo": {\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value",\n    "yet-a|nother-key1": "yet-another-value"\n  },\n  "yet-another-key5": "yet-another-value"\n}',
    );
  });

  it('LastArrayElementMovedUp up', () => {
    expect(moved('[\n  1,\n  2|\n]', true, '[\n  2,\n  1\n]')).toBe('[\n  2,\n  1\n]');
  });

  it('LastObjectPropertyMovedUp up', () => {
    expect(
      moved('{\n  "foo": true,\n  "bar": fal|se\n}', true, '{\n  "bar": false,\n  "foo": true\n}'),
    ).toBe('{\n  "bar": false,\n  "foo": true\n}');
  });

  it('ObjectSelectionMovedDown down', () => {
    expect(
      moved(
        '{\n  "foo": false,\n  "bar": |42,\n  "baz": [\n    1,\n    2,\n    3\n  ]|,\n  "quux": null\n}',
        false,
        '{\n  "foo": false,\n  "quux": null,\n  "bar": 42,\n  "baz": [\n    1,\n    2,\n    3\n  ]\n}',
      ),
    ).toBe(
      '{\n  "foo": false,\n  "quux": null,\n  "bar": 42,\n  "baz": [\n    1,\n    2,\n    3\n  ]\n}',
    );
  });

  it('OutOfScopeHasProp down', () => {
    expect(
      moved(
        '{\n  "foo": {\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value",\n    "ano|ther-key": "another-value"\n  },\n  "yet-another-key1": "yet-another-value"\n}',
        false,
        '{\n  "foo": {\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value"\n  },\n  "ano|ther-key": "another-value",\n  "yet-another-key1": "yet-another-value"\n}',
      ),
    ).toBe(
      '{\n  "foo": {\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value"\n  },\n  "ano|ther-key": "another-value",\n  "yet-another-key1": "yet-another-value"\n}',
    );
  });

  it('OutOfScopeNoFollowing down', () => {
    expect(
      moved(
        '{\n    "foo": {\n        "yet-another-key2": "yet-another-value",\n        "yet-another-key3": "yet-another-value",\n        "ano|ther-key": "another-value"\n    }\n}',
        false,
        '{\n    "foo": {\n        "yet-another-key2": "yet-another-value",\n        "yet-another-key3": "yet-another-value"\n    },\n  "ano|ther-key": "another-value"\n}',
      ),
    ).toBe(
      '{\n    "foo": {\n        "yet-another-key2": "yet-another-value",\n        "yet-another-key3": "yet-another-value"\n    },\n  "ano|ther-key": "another-value"\n}',
    );
  });

  it('OutsideArray down', () => {
    expect(
      moved(
        '[\n  null,\n  1, [2],\n  [\n    true,\n    true,\n    true,\n    true,\n    false,\n    t|rue\n  ]\n]',
        false,
        '[\n  null,\n  1, [2],\n  [\n    true,\n    true,\n    true,\n    true,\n    false\n  ],\n  t|rue\n]',
      ),
    ).toBe(
      '[\n  null,\n  1, [2],\n  [\n    true,\n    true,\n    true,\n    true,\n    false\n  ],\n  t|rue\n]',
    );
  });

  it('StatementSetMovedSameLevelDown down', () => {
    expect(
      moved(
        '{\n  "foo": {\n    |"yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value",|\n    "another-key": "another-value"\n  },\n  "yet-another-key1": "yet-another-value"\n}',
        false,
        '{\n  "foo": {\n    "another-key": "another-value",\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value"\n  },\n  "yet-another-key1": "yet-another-value"\n}',
      ),
    ).toBe(
      '{\n  "foo": {\n    "another-key": "another-value",\n    "yet-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value"\n  },\n  "yet-another-key1": "yet-another-value"\n}',
    );
  });

  it('StatementSetMovedSameLevelUp up', () => {
    expect(
      moved(
        '{\n  "foo": {\n    "yet-another-key2": "yet-another-value",\n    |"yet-another-key3": "yet-another-value",\n    "another-key": "another-value"|\n  },\n  "yet-another-key1": "yet-another-value"\n}',
        true,
        '{\n  "foo": {\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value",\n    "yet-another-key2": "yet-another-value"\n  },\n  "yet-another-key1": "yet-another-value"\n}',
      ),
    ).toBe(
      '{\n  "foo": {\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value",\n    "yet-another-key2": "yet-another-value"\n  },\n  "yet-another-key1": "yet-another-value"\n}',
    );
  });

  it('UpToUpper up', () => {
    expect(
      moved(
        '{\n  "b": 12,\n  "yet-another-key1": "yet-another-value",\n  "foo": {\n    "ye|t-another-key2": "yet-another-value",\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value"\n  },\n  "yet-another-key5": "yet-another-value"\n}',
        true,
        '{\n  "b": 12,\n  "yet-another-key1": "yet-another-value",\n  "ye|t-another-key2": "yet-another-value",\n  "foo": {\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value"\n  },\n  "yet-another-key5": "yet-another-value"\n}',
      ),
    ).toBe(
      '{\n  "b": 12,\n  "yet-another-key1": "yet-another-value",\n  "ye|t-another-key2": "yet-another-value",\n  "foo": {\n    "yet-another-key3": "yet-another-value",\n    "another-key": "another-value"\n  },\n  "yet-another-key5": "yet-another-value"\n}',
    );
  });

  it('Web_10585 up', () => {
    expect(
      moved(
        '{\n  "x": {\n    "name": "foo",\n    "cycles": |37\n  }\n}',
        true,
        '{\n  "x": {\n    "cycles": |37,\n    "name": "foo"\n  }\n}',
      ),
    ).toBe('{\n  "x": {\n    "cycles": |37,\n    "name": "foo"\n  }\n}');
  });

  it('Web_10585 down', () => {
    expect(
      moved(
        '{\n  "x": {\n    "name": "foo",\n    "cycles": |37\n  }\n}',
        false,
        '{\n  "x": {\n    "name": "foo"\n  },\n  "cycles": |37\n}',
      ),
    ).toBe('{\n  "x": {\n    "name": "foo"\n  },\n  "cycles": |37\n}');
  });
});

describe('Move Statement in JSON', () => {
  it('goes no further than the file’s own braces, or its first line', () => {
    expect(moved('{\n  "a": |1\n}', true)).toBeUndefined();
    expect(moved('{\n  "a": |1\n}', false)).toBeUndefined();
    expect(moved('|[1]', true)).toBeUndefined();
    expect(moved('|[1]', false)).toBeUndefined();
  });

  it('moves blank lines as lines, and passes one as a line', () => {
    expect(moved('{\n  "a": 1,\n|\n  "b": 2\n}', true)).toBe('{\n|\n  "a": 1,\n  "b": 2\n}');
    expect(moved('[\n  1\n]\n  |', true)).toBe('[\n  1\n  |\n]');
    expect(moved('{\n  "a": |1,\n\n  "b": 2\n}', false)).toBe('{\n\n  "a": |1,\n  "b": 2\n}');
  });

  it('moves a comment’s line as a line, its commas left as they are', () => {
    expect(moved('{\n  "a": 1,\n  // |c\n  "b": 2\n}', true)).toBe(
      '{\n  // |c\n  "a": 1,\n  "b": 2\n}',
    );
  });

  it('moves lines that aren’t whole elements as lines', () => {
    // From a key's line into the next one's value, over several lines.
    expect(moved('{\n  "a": [1,\n  |2], "b": 3\n}', true)).toBe('{\n  |2], "b": 3\n  "a": [1,\n}');
  });

  it('takes off a comma spaces follow, only the comma, and puts the moved lines’ indent right', () => {
    expect(moved('[\n  1,\n      |2,   \n  3\n]', false)).toBe('[\n  1,\n  3,\n  |2   \n]');
  });
});
