import '@cerebro-ide/theme/themes.css';
import { EditorState, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { indentGuides } from '../src/appearance.js';

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** An editor of `doc` with indent guides, tabs 4 wide, and what else is given. */
async function guides(doc: string, ...extensions: Extension[]) {
  view = new EditorView({
    doc,
    parent: document.body,
    extensions: [EditorState.tabSize.of(4), indentGuides, ...extensions],
  });
  await frame();
  await frame();
  return [...view.dom.querySelectorAll<HTMLElement>('.cm-indentGuides .cm-indentGuide')];
}

describe('indent guides', () => {
  it('draws a line at each step a line is indented past, through blank lines, in the theme’s colour', async () => {
    const found = await guides('function f() {\n    if (a) {\n        b();\n\n    }\n}\n\tc();\n');
    // 0, 1 (if), 2 (b), 1 (blank: the lesser around it), 1 (}), 0, 1 (a tab), 0 (blank at the end).
    expect(found).toHaveLength(6);
    const lefts = found.map((guide) => parseFloat(guide.style.left));
    const width = (view as EditorView).defaultCharacterWidth;
    // The if's, then b()'s two: at the text's start, and a tab's width on.
    expect((lefts[1] as number) - (lefts[0] as number)).toBeCloseTo(0);
    expect((lefts[1] as number) + 4 * width).toBeCloseTo(lefts[2] as number);
    // Where the text starts: the first line's first character.
    const start = (view as EditorView).coordsAtPos(0) as { left: number };
    const base = (view as EditorView).scrollDOM.getBoundingClientRect().left;
    expect((lefts[0] as number) + base).toBeCloseTo(start.left, 0);
    expect(getComputedStyle(found[0] as HTMLElement).backgroundColor).toBe('rgb(50, 52, 56)');
    expect(found[0]?.style.width).toBe('1px');
  });

  it('takes a blank line’s from the lines around it, or none past the text’s ends', async () => {
    // Blank first: nothing above. Blank last: nothing below.
    expect(await guides('\n    a\n\n\n    b\n')).toHaveLength(4);
  });

  it('draws none over a fold’s band, or with no lines shown', async () => {
    class Band extends WidgetType {
      toDOM() {
        return document.createElement('div');
      }
    }
    const fold = (from: number, to: number) =>
      StateField.define({
        create: () =>
          Decoration.set(Decoration.replace({ widget: new Band(), block: true }).range(from, to)),
        update: (value) => value,
        provide: (field) => EditorView.decorations.from(field),
      });
    const doc = '    a\n    b\n    c';
    // The first two lines folded: only the third's guide.
    expect(await guides(doc, fold(0, 11))).toHaveLength(1);
    view?.destroy();
    expect(await guides(doc, fold(0, doc.length))).toHaveLength(0);
  });
});
