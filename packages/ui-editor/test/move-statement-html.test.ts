import { indentUnit } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { languageFor, moveStatement } from '../src/index.js';

/** A text with IntelliJ's test markers: `<caret>`, or `<selection>` and `</selection>`. */
function parse(marked: string): EditorState {
  const caret = marked.indexOf('<caret>');
  const text = marked.replace('<caret>', '');
  const start = text.indexOf('<selection>');
  const doc = text.replace('<selection>', '').replace('</selection>', '');
  const end = start === -1 ? -1 : text.indexOf('</selection>') - '<selection>'.length;
  return EditorState.create({
    doc,
    selection:
      start === -1
        ? EditorSelection.cursor(caret === -1 ? 0 : caret)
        : EditorSelection.range(start, end),
    // IntelliJ's HTML indent.
    extensions: [languageFor('a.html') ?? [], indentUnit.of('    ')],
  });
}

/** The state written as `expected` writes it: the caret or selection where it marks one. */
function written(state: EditorState, expected: string): string {
  const text = state.doc.toString();
  const { from, to } = state.selection.main;
  if (expected.includes('<selection>')) {
    return `${text.slice(0, from)}<selection>${text.slice(from, to)}</selection>${text.slice(to)}`;
  }
  if (expected.includes('<caret>')) return `${text.slice(0, from)}<caret>${text.slice(from)}`;
  return text;
}

/** Each text after one more Move Statement Up (or Down), from `marked`, written as `expected`. */
function moves(marked: string, up: boolean, expected: readonly string[]): string[] {
  let state = parse(marked);
  return expected.map((each) => {
    const spec = moveStatement(state, up);
    if (spec) state = state.update(spec).state;
    return written(state, each);
  });
}

// IntelliJ's own tests (`XmlMoverTest`'s HTML ones, from `xml/tests/testData/mover`): each
// `_afterUp` (or `_afterDown`) file one move on, each `_afterUp2` one more; none, nothing moves.
describe('Move Statement in HTML, as IntelliJ’s tests have it', () => {
  it('1', () => {
    const source =
      '<html>\n<body>\n<hr>\n<a name="a">name a</a>\n<a name="b"><caret>name b</a>\n<a name="c">name c</a>\n<hr>\n</body>\n</html>';
    const up = [
      '<html>\n<body>\n<hr>\n<a name="b"><caret>name b</a>\n<a name="a">name a</a>\n<a name="c">name c</a>\n<hr>\n</body>\n</html>',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [
      '<html>\n<body>\n<hr>\n<a name="a">name a</a>\n<a name="c">name c</a>\n<a name="b"><caret>name b</a>\n<hr>\n</body>\n</html>',
    ];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlBlankLineAbove', () => {
    const source =
      '<div>\n</div>\n\n<ta<caret>ble>\n    <tr>\n        <td></td>\n    </tr>\n</table>';
    const up = [
      '<div>\n</div>\n<ta<caret>ble>\n    <tr>\n        <td></td>\n    </tr>\n</table>\n\n',
      '<div>\n    <ta<caret>ble>\n        <tr>\n            <td></td>\n        </tr>\n    </table>\n</div>\n\n',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [source];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlCaretAtEndTag', () => {
    const source =
      '<div>\n\n</div>\n<table>\n    <tr>\n        <td></td>\n    </tr>\n</ta<caret>ble>';
    const up = [
      '<div>\n\n    <table>\n        <tr>\n            <td></td>\n        </tr>\n    </ta<caret>ble>\n</div>\n',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [source];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlCaretAtStartTag', () => {
    const source =
      '<div>\n\n</div>\n<ta<caret>ble>\n    <tr>\n        <td></td>\n    </tr>\n</table>';
    const up = [
      '<div>\n\n    <ta<caret>ble>\n        <tr>\n            <td></td>\n        </tr>\n    </table>\n</div>\n',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [source];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlLastChild', () => {
    const source =
      '<div>\n    <div>\n        <ta<caret>ble>\n            <tr>\n                <td></td>\n            </tr>\n        </table>\n    </div>\n</div>';
    const up = [
      '<div>\n    <ta<caret>ble>\n        <tr>\n            <td></td>\n        </tr>\n    </table>\n    <div>\n    </div>\n</div>',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [
      '<div>\n    <div>\n    </div>\n    <ta<caret>ble>\n        <tr>\n            <td></td>\n        </tr>\n    </table>\n</div>',
    ];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlListItems', () => {
    const source =
      '<ul>\n    <li>one</li>\n    <l<caret>i>\n        two\n    </li>\n    <li>\n        three\n    </li>\n</ul>';
    const up = [
      '<ul>\n    <l<caret>i>\n        two\n    </li>\n    <li>one</li>\n    <li>\n        three\n    </li>\n</ul>',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [
      '<ul>\n    <li>one</li>\n    <li>\n        three\n    </li>\n    <l<caret>i>\n        two\n    </li>\n</ul>',
    ];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlScript', () => {
    const source =
      '<p>Hi there!</p>\n<script <caret>type="text/javascript">\n    var foo;\n</script>\n<p>Hi there!</p>';
    const up = [
      '<script type="text/javascript">\n    var foo;\n</script>\n<p>Hi there!</p>\n<p>Hi there!</p>',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [
      '<p>Hi there!</p>\n<p>Hi there!</p>\n<script type="text/javascript">\n    var foo;\n</script>\n',
    ];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlSiblingTags', () => {
    const source =
      '<div>\n    <div>\n    </div>\n    <d<caret>iv>\n    </div>\n    <div>\n    </div>\n</div>';
    const up = [
      '<div>\n    <div>\n        <d<caret>iv>\n        </div>\n    </div>\n    <div>\n    </div>\n</div>',
      '<div>\n    <d<caret>iv>\n    </div>\n    <div>\n    </div>\n    <div>\n    </div>\n</div>',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [
      '<div>\n    <div>\n    </div>\n    <div>\n        <d<caret>iv>\n        </div>\n    </div>\n</div>',
      '<div>\n    <div>\n    </div>\n    <div>\n    </div>\n    <d<caret>iv>\n    </div>\n</div>',
    ];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlSiblingTagsWithText', () => {
    const source =
      '<div>\n    <d<caret>iv>\n        one\n    </div>\n    <div>\n        another\n    </div>\n</div>';
    const up = [
      '<d<caret>iv>\n    one\n</div>\n<div>\n    <div>\n        another\n    </div>\n</div>',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [
      '<div>\n    <div>\n        <d<caret>iv>\n            one\n        </div>\n        another\n    </div>\n</div>',
      '<div>\n    <div>\n        another\n        <d<caret>iv>\n            one\n        </div>\n    </div>\n</div>',
      '<div>\n    <div>\n        another\n    </div>\n    <d<caret>iv>\n        one\n    </div>\n</div>',
    ];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlStyle', () => {
    const source = '<p>Hi there!</p>\n<styl<caret>e>\n    a {}\n</style>\n<p>Hi there!</p>\n';
    const up = ['<style>\n    a {}\n</style>\n<p>Hi there!</p>\n<p>Hi there!</p>\n'];
    expect(moves(source, true, up)).toEqual(up);
    const down = ['<p>Hi there!</p>\n<p>Hi there!</p>\n<style>\n    a {}\n</style>\n'];
    expect(moves(source, false, down)).toEqual(down);
  });

  it('htmlText', () => {
    const source =
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>Title</title>\n</head>\n<body>\n<h4>\n    text\n</h4>\n<div>\n    <selection>my text</selection>\n</div>\n</body>\n</html>';
    const up = [
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>Title</title>\n</head>\n<body>\n<h4>\n    text\n</h4>\n<selection>my text</selection>\n<div>\n</div>\n</body>\n</html>',
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>Title</title>\n</head>\n<body>\n<h4>\n    text\n    <selection>my text</selection>\n</h4>\n<div>\n</div>\n</body>\n</html>',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>Title</title>\n</head>\n<body>\n<h4>\n    text\n</h4>\n<div>\n</div>\n<selection>my text</selection>\n</body>\n</html>',
    ];
    expect(moves(source, false, down)).toEqual(down);
  });

  // Lezer's HTML (1.3.13) reads a tag's name without its digits (`nameChar`), so `<h2>` doesn't
  // close a `<p>` left open, as its own rules say it does (`closeOnOpen`): the heading is the
  // paragraph's, and indented in it (measured). Passes once Lezer reads `h2`.
  it.fails('htmlUnclosed', () => {
    const source =
      '<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n<h2>Ra<caret>ndom title</h2>\n<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n';
    const up = [
      '<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n<h2>Ra<caret>ndom title</h2>\n<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n',
    ];
    expect(moves(source, true, up)).toEqual(up);
    const down = [
      '<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n<h2>Ra<caret>ndom title</h2>\n<p>This line disappears when the line below is moved up with CTRL-SHIFT-up.\n',
    ];
    expect(moves(source, false, down)).toEqual(down);
  });
});

// Cerebro's own cases, for what IntelliJ's tests don't cover.
describe('Move Statement in HTML', () => {
  it("moves an attribute on its own line past the one beside it; not past the start tag's name or end", () => {
    expect(
      moves('<div\n    a="1"\n    b<caret>="2"\n    c="3">\n</div>', true, [
        '<div\n    b<caret>="2"\n    a="1"\n    c="3">\n</div>',
      ]),
    ).toEqual(['<div\n    b<caret>="2"\n    a="1"\n    c="3">\n</div>']);
    expect(
      moves('<div\n    a="1"\n    b<caret>="2"\n    c="3">\n</div>', false, [
        '<div\n    a="1"\n    b<caret>="2"\n    c="3">\n</div>',
      ]),
    ).toEqual(['<div\n    a="1"\n    b<caret>="2"\n    c="3">\n</div>']);
    expect(
      moves('<div\n    a="1"\n    b="2"\n    c<caret>="3">\n</div>', false, [
        '<div\n    a="1"\n    b="2"\n    c<caret>="3">\n</div>',
      ]),
    ).toEqual(['<div\n    a="1"\n    b="2"\n    c<caret>="3">\n</div>']);
    expect(
      moves('<div\n    a<caret>="1">\n</div>', true, ['<div\n    a<caret>="1">\n</div>']),
    ).toEqual(['<div\n    a<caret>="1">\n</div>']);
    expect(
      moves('  <div a="1"\n    b<caret>="2">\n  </div>', true, [
        '  <div a="1"\n    b<caret>="2">\n  </div>',
      ]),
    ).toEqual(['  <div a="1"\n    b<caret>="2">\n  </div>']);
  });

  it('moves an attribute over several lines whole, from any of them; one at the file’s end', () => {
    expect(
      moves('<div\n    a<caret>="1"\n    b="2"\n>\n</div>', false, [
        '<div\n    b="2"\n    a<caret>="1"\n>\n</div>',
      ]),
    ).toEqual(['<div\n    b="2"\n    a<caret>="1"\n>\n</div>']);
    expect(
      moves('<div\n    a="1"\n    b<caret>="2"', true, ['<div\n    b<caret>="2"\n    a="1"\n']),
    ).toEqual(['<div\n    b<caret>="2"\n    a="1"\n']);
    expect(
      moves('<div\n    a<caret>="1\n    2"\n    b="3"\n>\n</div>', false, [
        '<div\n    b="3"\n    a<caret>="1\n    2"\n>\n</div>',
      ]),
    ).toEqual(['<div\n    b="3"\n    a<caret>="1\n    2"\n>\n</div>']);
    expect(
      moves('<div\n    b="0"\n    a<caret>="1\n    2"\n>\n</div>', true, [
        '<div\n    a<caret>="1\n    2"\n    b="0"\n>\n</div>',
      ]),
    ).toEqual(['<div\n    a<caret>="1\n    2"\n    b="0"\n>\n</div>']);
    expect(
      moves('<div\n    b="0"\n    a="1\n    2<caret>"\n>\n</div>', true, [
        '<div\n    a="1\n    2<caret>"\n    b="0"\n>\n</div>',
      ]),
    ).toEqual(['<div\n    a="1\n    2<caret>"\n    b="0"\n>\n</div>']);
    expect(
      moves('<div\n    a="1\n    2<caret>"\n    b="3"\n>\n</div>', false, [
        '<div\n    b="3"\n    a="1\n    2<caret>"\n>\n</div>',
      ]),
    ).toEqual(['<div\n    b="3"\n    a="1\n    2<caret>"\n>\n</div>']);
    expect(
      moves('<div\n    a<caret>="1"\n    b="2"\n', false, ['<div\n    b="2"\n    a<caret>="1"\n']),
    ).toEqual(['<div\n    b="2"\n    a<caret>="1"\n']);
  });

  it("moves a comment, and text with references in it, as a tag's other children", () => {
    expect(
      moves('<div>\n    <!-- c<caret> -->\n    <p>x</p>\n</div>', false, [
        '<div>\n    <p>x</p>\n    <!-- c<caret> -->\n</div>',
      ]),
    ).toEqual(['<div>\n    <p>x</p>\n    <!-- c<caret> -->\n</div>']);
    expect(
      moves('<div>\n    one &amp; two<caret>\n    <p>x</p>\n</div>', false, [
        '<div>\n    <p>x</p>\n    one &amp; two<caret>\n</div>',
      ]),
    ).toEqual(['<div>\n    <p>x</p>\n    one &amp; two<caret>\n</div>']);
  });

  it("moves a script's code as lines, and what isn't a tag's child (a doctype) as lines", () => {
    // Among what's selected, too.
    expect(
      moves('<selection><p>a</p>\n<!DOCTYPE x>\n<p>b</p></selection>\n<hr>', false, [
        '<hr>\n<selection><p>a</p>\n<!DOCTYPE x>\n<p>b</p></selection>\n',
      ]),
    ).toEqual(['<hr>\n<selection><p>a</p>\n<!DOCTYPE x>\n<p>b</p></selection>\n']);
    expect(
      moves('<script>\n    a();\n    b<caret>();\n</script>', true, [
        '<script>\n    b<caret>();\n    a();\n</script>',
      ]),
    ).toEqual(['<script>\n    b<caret>();\n    a();\n</script>']);
    expect(
      moves('<!DOCTYPE html><caret>\n<html>\n</html>', false, [
        '<html>\n<!DOCTYPE html><caret>\n</html>',
      ]),
    ).toEqual(['<html>\n<!DOCTYPE html><caret>\n</html>']);
  });

  it("doesn't move the file's only root tag, nor what cuts a tag the move would split", () => {
    expect(
      moves('<!-- c -->\n<html<caret>>\n</html>', true, ['<!-- c -->\n<html<caret>>\n</html>']),
    ).toEqual(['<!-- c -->\n<html<caret>>\n</html>']);
    expect(
      moves('<div>\n    <p>a<caret></p>\n    text <b>\n    bold</b>\n</div>', false, [
        '<div>\n    <p>a<caret></p>\n    text <b>\n    bold</b>\n</div>',
      ]),
    ).toEqual(['<div>\n    <p>a<caret></p>\n    text <b>\n    bold</b>\n</div>']);
  });

  it("keeps to HTML's content models: no paragraph in a list, no block in a paragraph", () => {
    expect(
      moves('<p><caret>x</p>\n<ul>\n    <li>a</li>\n</ul>', false, [
        '<ul>\n    <li>a</li>\n</ul>\n<p><caret>x</p>\n',
      ]),
    ).toEqual(['<ul>\n    <li>a</li>\n</ul>\n<p><caret>x</p>\n']);
    expect(
      moves('<div<caret>></div>\n<p>\n    t\n</p>', false, [
        '<p>\n    t\n</p>\n<div<caret>></div>\n',
      ]),
    ).toEqual(['<p>\n    t\n</p>\n<div<caret>></div>\n']);
  });

  it('moves past a tag with no content: an empty one, a void one, one left open', () => {
    expect(moves('<a<caret>></a>\n<br/>', false, ['<br/>\n<a<caret>></a>\n'])).toEqual([
      '<br/>\n<a<caret>></a>\n',
    ]);
    expect(
      moves('<p>a</p><caret>\n<br>\n<p>b</p>', false, ['<br>\n<p>a</p><caret>\n<p>b</p>']),
    ).toEqual(['<br>\n<p>a</p><caret>\n<p>b</p>']);
    expect(
      moves('<ul>\n<li>a\n<li<caret>>b\n</ul>', true, ['<ul>\n    <li<caret>>b\n<li>a\n</ul>']),
    ).toEqual(['<ul>\n    <li<caret>>b\n<li>a\n</ul>']);
  });

  it("moves a selection's tags whole, past the tag beside them", () => {
    expect(
      moves('<selection><p>a</p>\n<p>b</p></selection>\n<hr>', false, [
        '<hr>\n<selection><p>a</p>\n<p>b</p></selection>\n',
      ]),
    ).toEqual(['<hr>\n<selection><p>a</p>\n<p>b</p></selection>\n']);
    expect(
      moves('<p>\n    a<selection>\n</p>\n<p>\n    b</selection>\n</p>\n<hr>', false, [
        '<hr>\n<p>\n    a<selection>\n</p>\n<p>\n    b</selection>\n</p>\n',
      ]),
    ).toEqual(['<hr>\n<p>\n    a<selection>\n</p>\n<p>\n    b</selection>\n</p>\n']);
  });

  it("moves blank lines as lines, and spaces at a line's end aren't the line's", () => {
    expect(moves('<p>a</p>\n<caret>\n<p>b</p>', false, ['<p>a</p>\n<p>b</p>\n<caret>\n'])).toEqual([
      '<p>a</p>\n<p>b</p>\n<caret>\n',
    ]);
    expect(moves('<p>a</p>\n<caret>', true, ['<caret>\n<p>a</p>\n'])).toEqual([
      '<caret>\n<p>a</p>\n',
    ]);
    expect(moves('  <caret>\n<p>a</p>', false, ['<p>a</p>\n<caret>\n'])).toEqual([
      '<p>a</p>\n<caret>\n',
    ]);
    expect(moves('<p>x</p>   \n<p<caret>>y</p>', true, ['<p<caret>>y</p>\n<p>x</p>   \n'])).toEqual(
      ['<p<caret>>y</p>\n<p>x</p>   \n'],
    );
  });

  it('leaves an empty file as it is', () => {
    expect(moves('', false, ['<caret>'])).toEqual(['<caret>']);
  });
});
