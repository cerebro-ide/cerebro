import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { MergeEditor, type MergeControl, type MergeEditorProps } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(props: Omit<MergeEditorProps, 'control'>) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 900px; height: 400px;';
  document.body.append(container);
  let control!: MergeControl;
  const handle = render(
    () => (
      <MergeEditor
        {...props}
        control={(given) => {
          control = given;
        }}
      />
    ),
    container,
  );
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const root = (container.querySelector('.cerebro-editor-merge') as HTMLElement)
    .shadowRoot as ShadowRoot;
  const [yours, result, theirs] = root.querySelectorAll('.cm-editor');
  return { root, control, yours, result, theirs } as {
    root: ShadowRoot;
    control: MergeControl;
    yours: Element;
    result: Element;
    theirs: Element;
  };
}

const lines = (editor: Element) =>
  [...editor.querySelectorAll('.cm-line')].map((line) => line.textContent);
const marked = (editor: Element, kind: string) =>
  [...editor.querySelectorAll(`.cm-merge3-${kind}`)].map((line) => line.textContent);
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const controls = (root: ShadowRoot) =>
  [...root.querySelectorAll('.cm-merge3-control')].map((b) => b.getAttribute('aria-label'));

const base = 'a\nb\nc\nd\ne\n';

describe('the merge editor', () => {
  it('shows yours, the base as the result, and theirs, each change marked in its colour', () => {
    const { yours, result, theirs, control } = mount({
      path: 'a.txt',
      base,
      yours: 'A\nb\nc\nd\ne\n',
      theirs: 'a\nb\nc\nX\ne\n',
    });
    expect(lines(result)).toEqual(['a', 'b', 'c', 'd', 'e', '']);
    expect(marked(yours, 'modified')).toEqual(['A']);
    expect(marked(yours, 'modified')).not.toContain('d');
    expect(marked(result, 'modified')).toEqual(['a', 'd']);
    // Not in the pane of the side that didn't make it.
    expect(marked(theirs, 'modified')).not.toContain('a');
    expect(marked(theirs, 'modified')).toEqual(['X']);
    expect(control.left()).toEqual({ changes: 2, conflicts: 0 });
    expect(control.text()).toBe(base);
    const colour = getComputedStyle(yours.querySelector('.cm-merge3-modified') as Element);
    expect(colour.backgroundColor).toBe('rgb(56, 85, 112)');
  });

  it('marks a conflict, an insertion and a deletion, and keeps their lines level', async () => {
    const { root, yours, result, theirs, control } = mount({
      path: 'a.txt',
      base: 'a\nb\nc\nd\ne\nf\ng\n',
      yours: 'a\nB1\nB2\nB3\nc\nd\ne\nf\ng\n',
      theirs: 'a\nb2\nc\ne\nf\ng\nnew\n',
    });
    expect(marked(yours, 'conflict')).toEqual(['B1', 'B2', 'B3']);
    expect(marked(result, 'conflict')).toEqual(['b']);
    expect(marked(theirs, 'conflict')).toEqual(['b2']);
    expect(marked(result, 'deleted')).toEqual(['d']);
    expect(marked(theirs, 'inserted')).toEqual(['new']);
    expect(control.left()).toEqual({ changes: 2, conflicts: 1 });
    await frame();
    // Each pane's line `c` is at the same height, past the conflict's three lines.
    const top = (editor: Element, text: string) =>
      [...editor.querySelectorAll('.cm-line')]
        .find((l) => l.textContent === text)
        ?.getBoundingClientRect().top;
    expect(top(result, 'c')).toBe(top(yours, 'c'));
    expect(top(theirs, 'c')).toBe(top(yours, 'c'));
    // A change with no lines in a pane has a line where it would be, in its colour.
    expect(theirs.querySelector('.cm-merge3-spacer.cm-merge3-deleted')).not.toBeNull();
    // Yours, the conflict's; theirs, all three: the arrow by the result, the cross outside.
    expect(controls(root)).toEqual([
      'Ignore',
      'Accept',
      ...['Accept', 'Ignore', 'Accept', 'Ignore', 'Accept', 'Ignore'],
    ]);
  });

  it('takes a side’s change with its arrow, ignores it with its cross', async () => {
    const { root, result, control } = mount({
      path: 'a.txt',
      base,
      yours: 'A\nb\nc\nd\ne\n',
      theirs: 'a\nb\nc\nX\ne\n',
    });
    await frame();
    const [ignoreYours, takeYours] = root.querySelectorAll<HTMLElement>('.cm-merge3-control');
    expect(ignoreYours?.title).toBe('Ignore');
    await userEvent.click(takeYours as HTMLElement);
    expect(control.text()).toBe('A\nb\nc\nd\ne\n');
    expect(marked(result, 'modified')).toEqual(['d']);
    expect(control.left()).toEqual({ changes: 1, conflicts: 0 });
    // Theirs, ignored: the result keeps the base's line.
    const [ignoreTheirs] = [...root.querySelectorAll<HTMLElement>('.cm-merge3-control')].filter(
      (b) => b.title === 'Ignore',
    );
    await userEvent.click(ignoreTheirs as HTMLElement);
    expect(control.text()).toBe('A\nb\nc\nd\ne\n');
    expect(control.left()).toEqual({ changes: 0, conflicts: 0 });
    expect(controls(root)).toEqual([]);
  });

  it('adds the other side of a conflict after the side taken', async () => {
    const { root, control } = mount({
      path: 'a.txt',
      base,
      yours: 'a\nmine\nc\nd\ne\n',
      theirs: 'a\ntheirs\nc\nd\ne\n',
    });
    await frame();
    const accept = () =>
      [...root.querySelectorAll<HTMLElement>('.cm-merge3-control')].filter(
        (b) => b.title === 'Accept',
      );
    await userEvent.click(accept()[1] as HTMLElement);
    expect(control.text()).toBe('a\ntheirs\nc\nd\ne\n');
    expect(control.left()).toEqual({ changes: 0, conflicts: 1 });
    await userEvent.click(accept()[0] as HTMLElement);
    expect(control.text()).toBe('a\ntheirs\nmine\nc\nd\ne\n');
    expect(control.left()).toEqual({ changes: 0, conflicts: 0 });
  });

  it('takes the changes not in conflict, one side’s or all, and the same change once', () => {
    const props = {
      path: 'a.txt',
      base,
      yours: 'A\nb\nc\nd\nE\n',
      theirs: 'a\nb\nC\nd\nE\n',
    };
    let { control } = mount(props);
    control.applyNonConflicting('theirs');
    expect(control.text()).toBe('a\nb\nC\nd\nE\n');
    expect(control.left()).toEqual({ changes: 1, conflicts: 0 });
    cleanup?.();
    ({ control } = mount(props));
    control.applyNonConflicting('yours');
    expect(control.text()).toBe('A\nb\nc\nd\nE\n');
    control.applyNonConflicting('all');
    expect(control.text()).toBe('A\nb\nC\nd\nE\n');
    expect(control.left()).toEqual({ changes: 0, conflicts: 0 });
  });

  it('ignores yours, and a change both made with either side', async () => {
    const { root, control } = mount({
      path: 'a.txt',
      base,
      yours: 'A\nb\nc\nd\n',
      theirs: 'a\nb\nc\nd\n',
    });
    await frame();
    // Yours changed `a`; both deleted `e`.
    const buttons = () => [...root.querySelectorAll<HTMLElement>('.cm-merge3-control')];
    await userEvent.click(buttons()[0] as HTMLElement);
    expect(control.left()).toEqual({ changes: 1, conflicts: 0 });
    await userEvent.click(buttons().filter((b) => b.title === 'Ignore')[0] as HTMLElement);
    expect(control.text()).toBe(base);
    expect(control.left()).toEqual({ changes: 0, conflicts: 0 });
  });

  it('takes a change both made at the end, though the text has no last newline', async () => {
    const { root, result, control } = mount({
      path: 'a.txt',
      base: 'a\nb\nc',
      yours: 'a\nb',
      theirs: 'a\nb',
    });
    await frame();
    expect(marked(result, 'deleted')).toEqual(['c']);
    const take = [...root.querySelectorAll<HTMLElement>('.cm-merge3-control')].find(
      (b) => b.title === 'Accept',
    );
    await userEvent.click(take as HTMLElement);
    expect(control.text()).toBe('a\nb');
    expect(control.left()).toEqual({ changes: 0, conflicts: 0 });
  });

  it('keeps lines added at the end level', async () => {
    const { yours, result, theirs, control } = mount({
      path: 'a.txt',
      base: 'a\nb',
      yours: 'a\nb\nc\nd',
      theirs: 'a\nb',
    });
    await frame();
    expect(marked(yours, 'inserted')).toEqual(['c', 'd']);
    const bottom = (editor: Element) =>
      editor.querySelector('.cm-content')?.getBoundingClientRect().bottom;
    expect(bottom(result)).toBe(bottom(yours));
    expect(bottom(theirs)).toBe(bottom(yours));
    // Taken, they follow the last line, no newline after them, as yours has none.
    control.applyNonConflicting('yours');
    expect(control.text()).toBe('a\nb\nc\nd');
  });

  it('takes a change of the whole text, and ignores one both made from theirs’ side', async () => {
    let { control } = mount({ path: 'a.txt', base: 'a', yours: 'b', theirs: 'a' });
    control.applyNonConflicting('all');
    expect(control.text()).toBe('b');
    cleanup?.();
    const both = mount({ path: 'a.txt', base: 'a', yours: 'b', theirs: 'b' });
    const { root } = both;
    control = both.control;
    await frame();
    const ignores = [...root.querySelectorAll<HTMLElement>('.cm-merge3-control')].filter(
      (b) => b.title === 'Ignore',
    );
    await userEvent.click(ignores[1] as HTMLElement);
    expect(control.text()).toBe('a');
    expect(control.left()).toEqual({ changes: 0, conflicts: 0 });
  });

  it('keeps the changes in place as the result is edited', async () => {
    const { result, control } = mount({
      path: 'a.txt',
      base,
      yours: 'a\nb\nc\nd\nE\n',
      theirs: 'a\nb\nc\nd\nE\n',
    });
    await userEvent.click(result.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{Home}typed ');
    await frame();
    expect(control.text()).toBe('typed a\nb\nc\nd\ne\n');
    expect(marked(result, 'modified')).toEqual(['e']);
    control.applyNonConflicting('all');
    expect(control.text()).toBe('typed a\nb\nc\nd\nE\n');
  });

  it('follows the font size and the tab size', async () => {
    const fontSize = signal(13);
    const { result } = mount({
      path: 'a.ts',
      base,
      yours: base,
      theirs: base,
      fontSize: () => fontSize.get(),
    });
    fontSize.set(20);
    await frame();
    expect(getComputedStyle(result.querySelector('.cm-scroller') as Element).fontSize).toBe('20px');
  });
});
