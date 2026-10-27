import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { TreeModel, TreeView, type TreeSource } from '../src/index.js';

interface Item {
  path: string;
  folder: boolean;
}

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

/** A source: `count` files under `big/`, a small folder, and a file; or children that never come. */
function source(count: number, options: { slow?: boolean } = {}): TreeSource<Item> {
  return {
    children: (node) => {
      if (options.slow && node) return new Promise(() => undefined);
      if (!node) {
        return [
          { path: 'big', folder: true },
          { path: 'small', folder: true },
          { path: 'top.md', folder: false },
        ];
      }
      if (node.path === 'small') return [{ path: 'small/a.ts', folder: false }];
      return Array.from({ length: count }, (_, i) => ({
        path: `big/file-${String(i).padStart(5, '0')}.ts`,
        folder: false,
      }));
    },
    key: (node) => node.path,
    isLeaf: (node) => !node.folder,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function mount(
  count = 10_000,
  options: { slow?: boolean; menu?: (event: MouseEvent, node: Item) => void } = {},
) {
  const model = new TreeModel(source(count, options));
  const opened = vi.fn();
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 400px; height: 480px;';
  document.body.append(container);
  const handle = render(
    () => (
      <TreeView
        model={model}
        label="Project"
        row={(node) => <span class="test-name">{node.path.split('/').at(-1)}</span>}
        onOpen={opened}
        rowClass={(node) => (node.folder ? 'test-folder' : undefined)}
        {...(options.menu ? { onContextMenu: options.menu } : {})}
      />
    ),
    container,
  );
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  await settle();
  const tree = container.querySelector('.cerebro-tree') as HTMLElement;
  const rows = () => [...container.querySelectorAll<HTMLElement>('.cerebro-tree-row')];
  const row = (key: string) => container.querySelector(`[data-key="${key}"]`) as HTMLElement;
  const key = (k: string) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    tree.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { model, opened, tree, rows, row, key };
}

describe('TreeView', () => {
  it('spans every row across the widest one, so the selection reaches the end', async () => {
    const long = `${'a-very-long-folder-name-'.repeat(4)}end`;
    let roots: Item[] = [
      { path: long, folder: true },
      { path: 'short.ts', folder: false },
    ];
    const model = new TreeModel<Item>({
      children: (node) => (node ? [] : roots),
      key: (node) => node.path,
      isLeaf: (node) => !node.folder,
    });
    const container = document.createElement('div');
    container.style.cssText = 'position: fixed; left: 0; top: 0; width: 200px; height: 200px;';
    document.body.append(container);
    const handle = render(
      () => <TreeView model={model} label="Project" row={(node) => <span>{node.path}</span>} />,
      container,
    );
    cleanup = () => {
      handle.dispose();
      container.remove();
    };
    await settle();
    const tree = container.querySelector('.cerebro-tree') as HTMLElement;
    const short = container.querySelector('[data-key="short.ts"]') as HTMLElement;
    const longRow = container.querySelector(`[data-key="${long}"]`) as HTMLElement;
    expect(tree.scrollWidth).toBeGreaterThan(tree.clientWidth);
    // The rows are inset 12px either side, as WebStorm's.
    expect(short.getBoundingClientRect().width).toBe(tree.scrollWidth - 24);
    expect(longRow.scrollWidth).toBe(longRow.clientWidth);
    // Gone, they're back to the tree's width.
    roots = [{ path: 'short.ts', folder: false }];
    await model.refresh();
    await settle();
    expect(tree.scrollWidth).toBe(tree.clientWidth);
    const again = container.querySelector('[data-key="short.ts"]') as HTMLElement;
    expect(again.getBoundingClientRect().width).toBe(tree.clientWidth - 24);
  });

  it('keeps that width while scrolling down past the long row', async () => {
    const long = `${'a-very-long-folder-name-'.repeat(4)}end`;
    const files = Array.from({ length: 100 }, (_, i) => ({
      path: `f${String(i)}.ts`,
      folder: false,
    }));
    const model = new TreeModel<Item>({
      children: (node) => (node ? [] : [{ path: long, folder: true }, ...files]),
      key: (node) => node.path,
      isLeaf: (node) => !node.folder,
    });
    const container = document.createElement('div');
    container.style.cssText = 'position: fixed; left: 0; top: 0; width: 200px; height: 200px;';
    document.body.append(container);
    const handle = render(
      () => <TreeView model={model} label="Project" row={(node) => <span>{node.path}</span>} />,
      container,
    );
    cleanup = () => {
      handle.dispose();
      container.remove();
    };
    await settle();
    const tree = container.querySelector('.cerebro-tree') as HTMLElement;
    const wide = tree.scrollWidth;
    expect(wide).toBeGreaterThan(tree.clientWidth);
    // Far enough down that the long row isn't drawn.
    tree.scrollTop = 24 * 60;
    tree.dispatchEvent(new Event('scroll'));
    await settle();
    expect(container.querySelector(`[data-key="${long}"]`)).toBeNull();
    expect(tree.scrollWidth).toBe(wide);
    const row = container.querySelector('[data-key="f60.ts"]') as HTMLElement;
    expect(row.getBoundingClientRect().width).toBe(wide - 24);
  });

  it('draws only the rows in view, in a spacer as tall as all of them', async () => {
    const { model, tree, rows } = await mount();
    model.expand({ path: 'big', folder: true });
    await settle();
    expect(model.rows).toHaveLength(10_003);
    const spacer = tree.querySelector('.cerebro-tree__spacer') as HTMLElement;
    expect(spacer.style.height).toBe(`${String(10_003 * 24)}px`);
    // 480 px shows 20 rows; 8 more drawn below.
    expect(rows()).toHaveLength(28);
    tree.scrollTop = 24 * 5000;
    tree.dispatchEvent(new Event('scroll'));
    await settle();
    const keys = rows().map((r) => r.dataset['key']);
    expect(keys).toHaveLength(36);
    expect(keys[0]).toBe('big/file-04991.ts');
    expect(rows()[0]?.style.top).toBe(`${String(4992 * 24)}px`);
  });

  it('indents by depth, and marks folders open or closed', async () => {
    const { model, row } = await mount(2);
    model.expand({ path: 'big', folder: true });
    await settle();
    expect(row('big').getAttribute('aria-expanded')).toBe('true');
    expect(row('small').getAttribute('aria-expanded')).toBe('false');
    expect(row('top.md').hasAttribute('aria-expanded')).toBe(false);
    expect(row('big/file-00000.ts').style.paddingLeft).toBe('19px');
    expect(row('big/file-00000.ts').getAttribute('aria-level')).toBe('2');
    expect(row('big/file-00000.ts').textContent).toBe('file-00000.ts');
  });

  it('selects on focus and moves with the keys, scrolling to the selection', async () => {
    const { model, tree, key } = await mount(100);
    tree.focus();
    expect(model.selected).toBe('big');
    expect(key('ArrowRight')).toBe(true);
    await settle();
    key('ArrowDown');
    expect(model.selected).toBe('big/file-00000.ts');
    key('PageDown');
    // A screen less one row: 20 rows show in 480 px.
    expect(model.selected).toBe('big/file-00019.ts');
    key('End');
    expect(model.selected).toBe('top.md');
    expect(tree.scrollTop).toBeGreaterThan(0);
    key('Home');
    expect(model.selected).toBe('big');
    expect(tree.scrollTop).toBe(0);
    key('ArrowDown');
    key('PageUp');
    expect(model.selected).toBe('big');
    key('ArrowLeft');
    expect(model.rows).toHaveLength(3);
    key('ArrowUp');
    expect(key('x')).toBe(false);
    // Focusing again keeps the selection there is.
    model.select('top.md');
    tree.blur();
    tree.focus();
    expect(model.selected).toBe('top.md');
  });

  it('opens a file and toggles a folder with Enter or a double click', async () => {
    const { model, opened, row, key } = await mount(2);
    model.select('top.md');
    key('Enter');
    expect(opened).toHaveBeenCalledWith({ path: 'top.md', folder: false });
    model.select('small');
    key('Enter');
    await settle();
    expect(model.expanded.has('small')).toBe(true);
    row('small/a.ts').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(opened).toHaveBeenLastCalledWith({ path: 'small/a.ts', folder: false });
    row('small').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(model.expanded.has('small')).toBe(false);
    model.select(undefined);
    key('Enter');
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it('selects on click, and toggles a folder from its arrow', async () => {
    const { model, row } = await mount(2);
    row('top.md').click();
    expect(model.selected).toBe('top.md');
    (row('small').querySelector('.cerebro-tree-row__arrow') as HTMLElement).click();
    await settle();
    expect(model.selected).toBe('small');
    expect(model.expanded.has('small')).toBe(true);
    (row('top.md').querySelector('.cerebro-tree-row__arrow') as HTMLElement).click();
    expect(model.selected).toBe('top.md');
  });

  it('says a folder is loading', async () => {
    const { model, row } = await mount(2, { slow: true });
    model.expand({ path: 'small', folder: true });
    await settle();
    expect(row('small').querySelector('.cerebro-tree-row__note')?.textContent).toBe('Loading…');
  });

  it('classes rows by their node, and selects a row asking for its context menu', async () => {
    const menu = vi.fn((event: MouseEvent) => {
      event.preventDefault();
    });
    const { row, model } = await mount(10, { menu });
    expect(row('big').classList).toContain('test-folder');
    expect(row('top.md').classList).not.toContain('test-folder');
    row('top.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(model.selected).toBe('top.md');
    expect(menu).toHaveBeenCalledWith(expect.any(MouseEvent), { path: 'top.md', folder: false });
  });

  it('leaves a context menu alone without a handler', async () => {
    const { row, model } = await mount(10);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    row('top.md').dispatchEvent(event);
    expect(model.selected).toBeUndefined();
    expect(event.defaultPrevented).toBe(false);
  });

  it('scrolls to a selection made from outside, and not when the rows change', async () => {
    const { model, tree } = await mount();
    model.expand({ path: 'big', folder: true });
    await settle();
    model.select('big/file-05000.ts');
    await settle();
    expect(tree.scrollTop).toBeGreaterThan(5000 * 24 - 480);
    tree.scrollTop = 0;
    tree.dispatchEvent(new Event('scroll'));
    model.expand({ path: 'small', folder: true });
    await settle();
    expect(tree.scrollTop).toBe(0);
  });

  it('works with the real keyboard and mouse', async () => {
    const { model, opened, row } = await mount(3);
    await userEvent.click(row('big'));
    expect(model.selected).toBe('big');
    await userEvent.keyboard('{ArrowRight}');
    await settle();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(opened).toHaveBeenCalledWith({ path: 'big/file-00001.ts', folder: false });
    await userEvent.dblClick(row('top.md'));
    expect(opened).toHaveBeenLastCalledWith({ path: 'top.md', folder: false });
  });
});
