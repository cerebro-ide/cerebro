import { CommandRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects } from '../src/environments.js';
import {
  chooseLayout,
  imageLoader,
  imagePath,
  isMarkdown,
  isMarkdownTab,
  layoutOf,
  localPath,
  MarkdownEditor,
  markdownActions,
  readKept,
  setupMarkdown,
} from '../src/markdown.js';
import { FakeHost, project } from './fakes.js';

const KEY = 'cerebro.markdown.editor';
const commands = new CommandRegistry();
let active: string | undefined;
const host = new FakeHost({
  'fs.readBytes': ({ path }: { path: string }) => ({ data: btoa(path) }),
});
beforeAll(() => {
  setupMarkdown(commands, () => active);
  useProjects([project('/r', host), project('/s', undefined)]);
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
        <MarkdownEditor
          path="/r/d.md"
          editor={editor}
          text={() => '# Hi'}
          line={() => 0}
          open={() => undefined}
        />
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

describe('a Markdown file’s images', () => {
  it('are files beside it, by a relative path; not on the web, from the root, or not images', () => {
    expect(imagePath('/r/docs/a.md', 'img/cat.png')).toBe('/r/docs/img/cat.png');
    expect(imagePath('/r/docs/a.md', './cat.PNG?raw=1#top')).toBe('/r/docs/cat.PNG');
    expect(imagePath('/r/docs/a.md', '../my%20logo.svg')).toBe('/r/my logo.svg');
    expect(imagePath('/r/docs/a.md', 'https://x.y/cat.png')).toBeUndefined();
    expect(imagePath('/r/docs/a.md', '/cat.png')).toBeUndefined();
    expect(imagePath('/r/docs/a.md', 'notes.txt')).toBeUndefined();
  });

  it('load as data URLs, each read once; a data image as it is; none that can’t be read', async () => {
    const read = vi.fn((path: string) =>
      path.endsWith('bad.png') ? Promise.reject(new Error('gone')) : Promise.resolve('QQ=='),
    );
    const load = imageLoader('/r/a.md', read);
    expect(await load('cat.png')).toBe('data:image/png;base64,QQ==');
    expect(await load('./cat.png')).toBe('data:image/png;base64,QQ==');
    expect(read).toHaveBeenCalledTimes(1);
    expect(await load('logo.svg')).toBe('data:image/svg+xml;base64,QQ==');
    expect(await load('data:image/gif;base64,R0')).toBe('data:image/gif;base64,R0');
    expect(await load('https://x.y/a.png')).toBeUndefined();
    expect(await load('bad.png')).toBeUndefined();
  });

  it('show in the preview, read through the file’s host; not where there’s none', async () => {
    chooseLayout('/r/e.md', 'split');
    chooseLayout('/s/e.md', 'split');
    const container = mount(() => (
      <>
        <MarkdownEditor
          path="/r/e.md"
          editor={document.createElement('div')}
          text={() => '![dot](dot.png)'}
          line={() => 0}
          open={() => undefined}
        />
        <MarkdownEditor
          path="/s/e.md"
          editor={document.createElement('div')}
          text={() => '![dot](dot.png)'}
          line={() => 0}
          open={() => undefined}
        />
      </>
    ));
    const [here, elsewhere] = [...container.querySelectorAll('.cerebro-markdown-preview')].map(
      (preview) =>
        (preview.shadowRoot as ShadowRoot).querySelector('.cerebro-markdown') as HTMLElement,
    );
    await expect
      .poll(() => here?.querySelector('img')?.getAttribute('src'))
      .toBe(`data:image/png;base64,${btoa('/r/dot.png')}`);
    expect(elsewhere?.querySelector('img')).toBeNull();
    expect(elsewhere?.textContent).toBe('dot');
  });
});

describe('a Markdown file’s links', () => {
  it('name files beside it by a relative path; not on the web, from the root, or its own anchors', () => {
    expect(localPath('/r/docs/a.md', 'b.md#part')).toBe('/r/docs/b.md');
    expect(localPath('/r/docs/a.md', '../src/my%20main.ts?x')).toBe('/r/src/my main.ts');
    expect(localPath('/r/docs/a.md', 'mailto:a@b.c')).toBeUndefined();
    expect(localPath('/r/docs/a.md', '/b.md')).toBeUndefined();
    expect(localPath('/r/docs/a.md', '#part')).toBeUndefined();
  });

  it('open the file a link names when it’s pressed in the preview; not one on the web', () => {
    chooseLayout('/r/docs/f.md', 'preview');
    const open = vi.fn();
    const container = mount(() => (
      <MarkdownEditor
        path="/r/docs/f.md"
        editor={document.createElement('div')}
        text={() => '[b](../b.md#top) [web](https://x.y)'}
        line={() => 0}
        open={open}
      />
    ));
    const root = (container.querySelector('.cerebro-markdown-preview') as HTMLElement)
      .shadowRoot as ShadowRoot;
    for (const link of root.querySelectorAll<HTMLElement>('.cerebro-doc__link')) link.click();
    expect(open.mock.calls).toEqual([[{ id: '/r/b.md', title: 'b.md' }]]);
  });
});
