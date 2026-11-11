// A diff's Appearance, as IntelliJ's diff settings gear has it (`SetEditorSettingsActionGroup`):
// Show Whitespaces, Show Line Numbers, Show Indent Guides and Soft-Wrap, in its colours
// (WHITESPACES and INDENT_GUIDE, IslandSchemeDark.xml; the light theme's from its schemes).

import { type Extension } from '@codemirror/state';
import {
  BlockType,
  EditorView,
  highlightWhitespace,
  layer,
  RectangleMarker,
} from '@codemirror/view';
import { variable } from './editor.js';

export interface Appearance {
  /** Read reactively. Default: shown, as IntelliJ's. */
  lineNumbers?: () => boolean;
  /** Spaces as dots and tabs as arrows, read reactively. Default: not, as IntelliJ's. */
  whitespace?: () => boolean;
  /** A line at each level of indentation, read reactively. Default: not, as IntelliJ's diff. */
  indentGuides?: () => boolean;
  /** Long lines wrapped at the editor's edge, read reactively. Default: not, as IntelliJ's. */
  softWrap?: () => boolean;
}

/** How far `text` is indented, in columns, tabs taking the tab size. */
function indentOf(text: string, tabSize: number): number {
  let column = 0;
  for (const char of text) {
    if (char === ' ') column++;
    else if (char === '\t') column += tabSize - (column % tabSize);
    else break;
  }
  return column;
}

/**
 * Lines' indentation for their guides, asked line by line down the page: a blank line's is the
 * lesser of the lines around it, so the guides run on through it, as IntelliJ's do through a
 * block. Each run of blank lines is looked past once.
 */
function guideIndents(view: EditorView): (number: number) => number {
  const { doc, tabSize } = view.state;
  const blank = (n: number) => doc.line(n).text.trim() === '';
  /** The first line not blank from `n` on, by `step`, and its indent: 0 past the text's ends. */
  const nearest = (n: number, step: 1 | -1) => {
    while (n >= 1 && n <= doc.lines && blank(n)) n += step;
    return { line: n, indent: n >= 1 && n <= doc.lines ? indentOf(doc.line(n).text, tabSize) : 0 };
  };
  let above: number | undefined;
  let below: { line: number; indent: number } | undefined;
  return (number) => {
    if (!blank(number)) {
      above = indentOf(doc.line(number).text, tabSize);
      return above;
    }
    above ??= nearest(number, -1).indent;
    if (!below || below.line < number) below = nearest(number, 1);
    return Math.min(above, below.indent);
  };
}

/**
 * IntelliJ's indent guides: a thin line at each indentation step a line is indented past, from the
 * line's start, every tab size apart (IntelliJ takes the language's indent: that the tab size
 * matches it is a claim). Drawn as a layer over the text, so a change's colour doesn't hide them
 * (they're in the indentation alone), and only on a line's first row: wrapped, its next rows start
 * at the edge.
 */
export const indentGuides: Extension = [
  layer({
    above: true,
    class: 'cm-indentGuides',
    update: (update) => update.docChanged || update.viewportChanged || update.geometryChanged,
    markers(view) {
      const line = view.contentDOM.querySelector('.cm-line');
      if (!line) return [];
      const step = view.state.tabSize;
      const width = view.defaultCharacterWidth;
      const scroller = view.scrollDOM.getBoundingClientRect();
      // Where the text starts, against the layer's base (CodeMirror's `getBase`).
      const left =
        line.getBoundingClientRect().left +
        parseFloat(getComputedStyle(line).paddingLeft) -
        scroller.left +
        view.scrollDOM.scrollLeft;
      const top = view.documentTop - scroller.top + view.scrollDOM.scrollTop;
      const indentOfLine = guideIndents(view);
      const markers: RectangleMarker[] = [];
      for (const block of view.viewportLineBlocks) {
        // A fold's band, or a widget: no text to guide.
        if (block.type !== BlockType.Text) continue;
        const number = view.state.doc.lineAt(block.from).number;
        const indent = indentOfLine(number);
        for (let column = 0; column < indent; column += step) {
          markers.push(
            new RectangleMarker(
              'cm-indentGuide',
              left + column * width,
              top + block.top,
              1,
              Math.min(block.height, view.defaultLineHeight),
            ),
          );
        }
      }
      return markers;
    },
  }),
  EditorView.theme({
    '.cm-indentGuides .cm-indentGuide': { backgroundColor: variable('indent-guide') },
  }),
];

/** Whitespace in IntelliJ's colour: CodeMirror's dots and arrows are a grey of their own. */
const whitespace: Extension = [
  highlightWhitespace(),
  EditorView.theme({
    '.cm-highlightSpace': {
      background: `radial-gradient(circle at 50% 55%, ${variable('whitespace')} 20%, transparent 0) no-repeat`,
      backgroundSize: '.4em',
      backgroundPosition: 'calc(min(50%, 0px)) center',
    },
    // The arrow as a mask over the colour: a picture's colours can't be the theme's.
    '.cm-highlightTab': {
      backgroundImage: 'none',
      backgroundColor: variable('whitespace'),
      maskImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="20"><path stroke="%23000" stroke-width="1" fill="none" d="M1 10H196L190 5M190 15L196 10M197 4L197 16"/></svg>')`,
      maskSize: 'auto 100%',
      maskPosition: 'right 90%',
      maskRepeat: 'no-repeat',
    },
  }),
];

/** The extensions `appearance` asks for; `numbers` are the editor's line numbers. */
export const appearance = (props: Appearance, numbers: Extension): Extension => [
  (props.lineNumbers?.() ?? true) ? numbers : [],
  props.whitespace?.() ? whitespace : [],
  props.indentGuides?.() ? indentGuides : [],
  props.softWrap?.() ? EditorView.lineWrapping : [],
];
