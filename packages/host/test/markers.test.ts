import { describe, expect, it } from 'vitest';
import { baseNames, markersOf, type DocumentSymbol, type Place } from '../src/markers.js';

const CLASS = 5;
const INTERFACE = 11;
const METHOD = 6;

const symbol = (
  name: string,
  kind: number,
  line: number,
  character: number,
  children: DocumentSymbol[] = [],
): DocumentSymbol => ({ name, kind, selectionRange: { start: { line, character } }, children });

const place = (path: string, line: number, column: number): Place => ({ path, line, column });

/** A fake server over files' text and symbols, its definitions keyed by `path:line:column`. */
function fake(
  files: Record<string, { text?: string; symbols?: DocumentSymbol[] }>,
  definitions: Record<string, Place[]> = {},
  implementations: Record<string, Place[]> = {},
) {
  const key = (at: Place) => `${at.path}:${String(at.line)}:${String(at.column)}`;
  return {
    symbols: (path: string) => {
      const symbols = files[path]?.symbols;
      return symbols ? Promise.resolve(symbols) : Promise.reject(new Error('no file'));
    },
    definitions: (at: Place) => {
      const found = definitions[key(at)];
      return found ? Promise.resolve(found) : Promise.reject(new Error('none'));
    },
    implementations: (at: Place) => {
      const found = implementations[key(at)];
      return found ? Promise.resolve(found) : Promise.reject(new Error('none'));
    },
    text: (path: string) => Promise.resolve(files[path]?.text),
  };
}

describe('the names in a type’s header', () => {
  it('reads them up to its body, past generics and parentheses, keywords left out', () => {
    const text = 'class A<T extends X> extends B<T> implements C, D {\n';
    expect(baseNames(text, place('a', 0, 6), 'A').map((p) => p.column)).toEqual([
      8, 18, 29, 31, 45, 48,
    ]);
    // Python's, over lines, up to the colon outside the parentheses.
    const py = 'class A(\n    B[int],\n    metaclass=M,\n):\n    pass\n';
    expect(baseNames(py, place('a', 0, 6), 'A')).toEqual([
      place('a', 1, 4),
      place('a', 1, 6),
      place('a', 2, 4),
      place('a', 2, 14),
    ]);
  });

  it('leaves numbers out', () => {
    expect(baseNames('class A(B[1x]):', place('a', 0, 6), 'A')).toEqual([place('a', 0, 8)]);
  });

  it('stops at the end of the text, or once it has read long enough', () => {
    expect(baseNames('class A extends B', place('a', 0, 6), 'A')).toEqual([place('a', 0, 16)]);
    const long = `class A extends ${'B'.repeat(2_000)} implements C {`;
    expect(baseNames(long, place('a', 0, 6), 'A')).toEqual([place('a', 0, 16)]);
  });
});

describe('gutter markers', () => {
  it('goes up through the bases to the nearest with the member, once each', async () => {
    // C extends B, which extends A and A2, which both have run; A extends B (a cycle, as a broken
    // project may have).
    const files = {
      c: {
        text: 'class C extends B {\n  run() {}\n  walk() {}\n  own() {}\n}\n',
        symbols: [
          symbol('C', CLASS, 0, 6, [
            symbol('run', METHOD, 1, 2),
            symbol('walk', METHOD, 2, 2),
            symbol('own', METHOD, 3, 2),
          ]),
        ],
      },
      b: {
        text: 'class B extends A, A2 {\n  walk() {}\n}\n',
        symbols: [symbol('B', CLASS, 0, 6, [symbol('walk', METHOD, 1, 2)])],
      },
      a: {
        text: 'interface A extends B {\n  run(): void;\n  walk(): void;\n}\n',
        symbols: [
          symbol('A', INTERFACE, 0, 10, [
            symbol('run', METHOD, 1, 2),
            symbol('walk', METHOD, 2, 2),
          ]),
        ],
      },
      a2: {
        text: 'interface A2 {\n  run(): void;\n}\n',
        symbols: [symbol('A2', INTERFACE, 0, 10, [symbol('run', METHOD, 1, 2)])],
      },
    };
    const markers = await markersOf(
      'c',
      fake(files, {
        'c:0:16': [place('b', 0, 6)],
        'b:0:16': [place('a', 0, 10)],
        'b:0:19': [place('a2', 0, 10)],
        'a:0:20': [place('b', 0, 6)],
      }),
    );
    expect(markers).toEqual([
      { line: 1, kind: 'implements', name: 'run', targets: [place('a', 1, 2), place('a2', 1, 2)] },
      { line: 2, kind: 'overrides', name: 'walk', targets: [place('b', 1, 2)] },
    ]);
  });

  it('marks what implements a member, itself left out, and nested types’ members', async () => {
    const files = {
      a: {
        text: 'namespace N {\n  class A {\n    abstract run(): void;\n    @abstractmethod\n    walk() {}\n  }\n}\n',
        symbols: [
          symbol('N', 2, 0, 10, [
            symbol('A', CLASS, 1, 8, [
              symbol('run', METHOD, 2, 13),
              symbol('walk', METHOD, 4, 4),
              symbol('field', 8, 5, 4),
              symbol('constructor', 9, 5, 4),
            ]),
          ]),
        ],
      },
    };
    const markers = await markersOf(
      'a',
      fake(
        files,
        {},
        {
          'a:1:8': [place('a', 1, 8)],
          'a:2:13': [place('a', 2, 13), place('b', 0, 0)],
          'a:4:4': [place('b', 1, 0)],
          'a:5:4': [place('b', 2, 0)],
        },
      ),
    );
    expect(markers).toEqual([
      { line: 2, kind: 'implemented', name: 'run', targets: [place('b', 0, 0)] },
      { line: 4, kind: 'implemented', name: 'walk', targets: [place('b', 1, 0)] },
      { line: 5, kind: 'overridden', name: 'field', targets: [place('b', 2, 0)] },
    ]);
  });

  it('marks none where a file or its text can’t be read', async () => {
    // A base in a file whose symbols can't be had, and one whose text can't.
    const files = {
      a: {
        symbols: [symbol('A', CLASS, 0, 6, [symbol('run', METHOD, 1, 2)])],
      },
      b: {
        text: 'class B extends C, D {}\n',
        symbols: [symbol('B', CLASS, 0, 6, [symbol('run', METHOD, 1, 2)])],
      },
    };
    // Its own text gone too: not abstract, as far as can be told.
    expect(await markersOf('a', fake(files, {}, { 'a:1:2': [place('z', 0, 0)] }))).toEqual([
      { line: 1, kind: 'overridden', name: 'run', targets: [place('z', 0, 0)] },
    ]);
    const c = {
      text: 'class C extends B, X {\n  run() {}\n}\n',
      symbols: [symbol('C', CLASS, 0, 6, [symbol('run', METHOD, 1, 2)])],
    };
    expect(
      await markersOf(
        'c',
        fake(
          { ...files, c },
          {
            'c:0:16': [place('b', 0, 6)],
            'c:0:19': [place('x', 0, 6)],
            'b:0:16': [place('e', 0, 0)],
          },
        ),
      ),
    ).toEqual([{ line: 1, kind: 'overrides', name: 'run', targets: [place('b', 1, 2)] }]);
    // The base's text gone: not abstract, as far as can be told.
    const gone = { symbols: [symbol('G', CLASS, 0, 6, [symbol('run', METHOD, 1, 2)])] };
    expect(await markersOf('c', fake({ c, g: gone }, { 'c:0:16': [place('g', 0, 6)] }))).toEqual([
      { line: 1, kind: 'overrides', name: 'run', targets: [place('g', 1, 2)] },
    ]);
  });

  it('marks a type on the first line, with no members, and a member past its text’s end', async () => {
    const files = {
      a: {
        text: 'class A {}\n',
        symbols: [
          { name: 'A', kind: CLASS, selectionRange: { start: { line: 0, character: 6 } } },
          symbol('B', CLASS, 1, 6, [symbol('run', METHOD, 9, 2)]),
        ],
      },
    };
    const markers = await markersOf(
      'a',
      fake(files, {}, { 'a:0:6': [place('b', 0, 6)], 'a:9:2': [place('b', 1, 2)] }),
    );
    expect(markers).toEqual([
      { line: 0, kind: 'overridden', name: 'A', targets: [place('b', 0, 6)] },
      { line: 9, kind: 'overridden', name: 'run', targets: [place('b', 1, 2)] },
    ]);
  });
});
