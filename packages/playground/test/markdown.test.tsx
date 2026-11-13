import { CommandRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  chooseLayout,
  isMarkdown,
  isMarkdownTab,
  layoutOf,
  MarkdownEditor,
  markdownActions,
  readKept,
  setupMarkdown,
} from '../src/markdown.js';

const KEY = 'cerebro.markdown.editor';
const commands = new CommandRegistry();
let active: string | undefined;
beforeAll(() => {
  setupMarkdown(commands, () => active);
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function mount(node: () => Node): HTMLElement {
  const container = document.body.appendChild(document.createElement('div'));
  container.className = 'test-markdown';
  const handle = render(node, container);
  cleanups.push(() => {
    handle.dispose();
    container.remove();
  });
  return container;
}

describe('what a Markdown file’s editor keeps', () => {
  it('is IntelliJ’s defaults, without anything kept or with something else', () => {
    localStorage.removeItem(KEY);
    expect(readKept()).toEqual({ layout: 'split', vertical: false, share: 0.5 });
    localStorage.setItem(KEY, JSON.stringify({ layout: 'sideways', vertical: 'yes', share: 3 }));
    expect(readKept()).toEqual({ layout: 'split', vertical: false, share: 0.5 });
    localStorage.setItem(KEY, '{');
    expect(readKept()).toEqual({ layout: 'split', vertical: false, share: 0.5 });
    localStorage.setItem(KEY, JSON.stringify({ layout: 'preview', vertical: true, share: 0.3 }));
    expect(readKept()).toEqual({ layout: 'preview', vertical: true, share: 0.3 });
    localStorage.removeItem(KEY);
  });
});

describe('a Markdown file', () => {
  it('is a .md file’s own tab, not its diff’s', () => {
    expect(isMarkdown('/r/README.MD')).toBe(true);
    expect(isMarkdown('/r/a.ts')).toBe(false);
    expect(isMarkdownTab('/r/README.md')).toBe(true);
    expect(isMarkdownTab('diff:/r:/r/README.md')).toBe(false);
  });
});

describe('the layouts', () => {
  it('are a tab’s own once chosen, the last chosen for others; the split turned round when chosen again', () => {
    chooseLayout('/r/a.md', 'preview');
    expect(layoutOf('/r/a.md')).toBe('preview');
    expect(layoutOf('/r/new.md')).toBe('preview');
    chooseLayout('/r/b.md', 'editor');
    expect(layoutOf('/r/a.md')).toBe('preview');
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toMatchObject({ layout: 'editor' });
    chooseLayout('/r/a.md', 'split');
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toMatchObject({ vertical: false });
    chooseLayout('/r/a.md', 'split');
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toMatchObject({ vertical: true });
    chooseLayout('/r/a.md', 'split');
    // Not kept where storage fails: it goes on all the same.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    chooseLayout('/r/a.md', 'editor');
    expect(layoutOf('/r/a.md')).toBe('editor');
  });

  it('are commands for a Markdown tab, or the active one, checked as it shows', () => {
    const context = { group: 'g', tab: '/r/c.md' };
    commands.execute('markdown.layout.preview', context);
    expect(commands.isChecked('markdown.layout.preview', context)).toBe(true);
    expect(commands.isChecked('markdown.layout.editor', context)).toBe(false);
    expect(commands.isEnabled('markdown.layout.editor', { group: 'g', tab: '/r/a.ts' })).toBe(
      false,
    );
    active = undefined;
    expect(commands.isEnabled('markdown.layout.editor')).toBe(false);
    expect(commands.isChecked('markdown.layout.editor')).toBe(false);
    expect(commands.execute('markdown.layout.editor')).toBe(false);
    active = '/r/c.md';
    commands.execute('markdown.layout.editor');
    expect(layoutOf('/r/c.md')).toBe('editor');
  });

  it('show the text, the preview, or both, as chosen from the tab’s buttons', async () => {
    chooseLayout('/r/d.md', 'split');
    const editor = document.createElement('textarea');
    editor.className = 'test-editor';
    const container = mount(() => (
      <>
        <div class="test-actions">{markdownActions(commands, { group: 'g', tab: '/r/d.md' })}</div>
        <MarkdownEditor path="/r/d.md" editor={editor} text={() => '# Hi'} line={() => 0} />
      </>
    ));
    container.style.cssText = 'position: fixed; inset: 0; width: 800px; height: 400px;';
    const q = (selector: string) => container.querySelector<HTMLElement>(selector);
    const shown = () => ({
      text: !(q('.playground-markdown__text') as HTMLElement).hidden,
      preview: q('.cerebro-markdown-preview') !== null,
    });
    /** Drags the splitter by so much down, and across. */
    const drag = (down: number, across: number) => {
      const splitter = q('.cerebro-splitter') as HTMLElement;
      const at = splitter.getBoundingClientRect();
      const from = { clientX: at.left, clientY: at.top, bubbles: true };
      const to = { clientX: at.left + across, clientY: at.top + down, bubbles: true };
      splitter.dispatchEvent(new PointerEvent('pointerdown', { ...from, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointermove', to));
      window.dispatchEvent(new PointerEvent('pointerup', to));
    };
    const button = (layout: string) =>
      q(`button[data-command="markdown.layout.${layout}"]`) as HTMLElement;
    expect(shown()).toEqual({ text: true, preview: true });
    expect(button('split').getAttribute('aria-pressed')).toBe('true');
    // Side by side, halves.
    const text = q('.playground-markdown__text') as HTMLElement;
    expect(text.getBoundingClientRect().width).toBeCloseTo(400, 0);
    // Dragged, the share is kept.
    drag(0, -200);
    expect(text.getBoundingClientRect().width).toBeCloseTo(200, 0);
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toMatchObject({ share: 0.25 });
    await userEvent.click(button('preview'));
    expect(shown()).toEqual({ text: false, preview: true });
    await userEvent.click(button('editor'));
    expect(shown()).toEqual({ text: true, preview: false });
    expect(text.getBoundingClientRect().width).toBe(800);
    // Both, then both again: one above the other, its icon so too.
    await userEvent.click(button('split'));
    const sideBySide = button('split').innerHTML;
    await userEvent.click(button('split'));
    expect(q('.playground-markdown--vertical')).not.toBeNull();
    expect(button('split').innerHTML).not.toBe(sideBySide);
    expect(text.getBoundingClientRect().height).toBeCloseTo(100, 0);
    expect(q('.cerebro-splitter--horizontal')).not.toBeNull();
    // Dragged down, by its height.
    drag(100, 0);
    expect(text.getBoundingClientRect().height).toBeCloseTo(200, 0);
    chooseLayout('/r/d.md', 'split');
  });
});
