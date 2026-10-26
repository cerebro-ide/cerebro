import { describe, expect, it } from 'vitest';
import { TreeModel, type TreeSource } from '../src/index.js';

interface Item {
  path: string;
  children?: Item[];
}

/** A folder tree from nested names: `{ src: { a: null } }` gives src/ with the file src/a. */
function tree(spec: Record<string, unknown>, parent = ''): Item[] {
  return Object.entries(spec).map(([name, children]) => {
    const path = parent ? `${parent}/${name}` : name;
    return children === null
      ? { path }
      : { path, children: tree(children as Record<string, unknown>, path) };
  });
}

const FILES = tree({
  src: { ui: { 'tree.tsx': null, 'menu.tsx': null }, 'main.ts': null },
  docs: { 'plan.md': null },
  'README.md': null,
});

function source(roots: Item[], options: { async?: boolean; fail?: string } = {}): TreeSource<Item> {
  return {
    children: (node) => {
      if (node && node.path === options.fail) throw new Error(`can't read ${node.path}`);
      const children = node ? (node.children ?? []) : roots;
      return options.async ? Promise.resolve(children) : children;
    },
    key: (node) => node.path,
    isLeaf: (node) => node.children === undefined,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const shown = (model: TreeModel<Item>) =>
  model.rows.map((r) => `${'  '.repeat(r.depth)}${r.key.split('/').at(-1) ?? ''}`);
const find = (path: string, items = FILES): Item => {
  for (const item of items) {
    if (item.path === path) return item;
    if (item.children && path.startsWith(`${item.path}/`)) return find(path, item.children);
  }
  throw new Error(path);
};

describe('TreeModel', () => {
  it('shows the roots, and a folder’s children once it’s expanded', async () => {
    const model = new TreeModel(source(FILES));
    await settle();
    expect(shown(model)).toEqual(['src', 'docs', 'README.md']);
    model.expand(find('src'));
    await settle();
    model.expand(find('src/ui'));
    await settle();
    expect(shown(model)).toEqual([
      'src',
      '  ui',
      '    tree.tsx',
      '    menu.tsx',
      '  main.ts',
      'docs',
      'README.md',
    ]);
    model.collapse(find('src'));
    expect(shown(model)).toEqual(['src', 'docs', 'README.md']);
    // Expanding again shows what was loaded and open inside.
    model.toggle(find('src'));
    expect(shown(model)).toHaveLength(7);
    model.expand(find('README.md'));
    expect(shown(model)).toHaveLength(7);
  });

  it('loads children lazily, once, marking a folder that’s loading', async () => {
    let calls = 0;
    const base = source(FILES, { async: true });
    const model = new TreeModel<Item>({
      ...base,
      children: (node) => {
        calls++;
        return base.children(node);
      },
    });
    await settle();
    model.expand(find('docs'));
    expect(model.rows.find((r) => r.key === 'docs')?.loading).toBe(true);
    await settle();
    expect(model.rows.find((r) => r.key === 'docs')?.loading).toBe(false);
    model.collapse(find('docs'));
    model.expand(find('docs'));
    await model.load(find('docs'));
    expect(calls).toBe(2);
    await model.load(find('docs'), true);
    expect(calls).toBe(3);
  });

  it('keeps why a folder couldn’t be read, and tries again on reload', async () => {
    const model = new TreeModel(source(FILES, { fail: 'docs' }));
    await settle();
    model.expand(find('docs'));
    await settle();
    expect(model.errors.get('docs')).toBe("can't read docs");
    expect(shown(model)).toEqual(['src', 'docs', 'README.md']);
    const odd = new TreeModel<Item>({
      ...source(FILES),
      children: () => Promise.reject(new Error('gone')),
    });
    await settle();
    expect(odd.errors.size).toBe(1);
    const stringly = new TreeModel<Item>({
      ...source(FILES),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a careless source
      children: () => Promise.reject('plain'),
    });
    await settle();
    expect([...stringly.errors.values()]).toEqual(['plain']);
  });

  it('moves the selection up and down, stopping at the ends', async () => {
    const model = new TreeModel(source(FILES));
    await settle();
    model.move(1);
    expect(model.selected).toBe('src');
    model.move(5);
    expect(model.selected).toBe('README.md');
    model.move(-1);
    expect(model.selected).toBe('docs');
    model.edge(false);
    expect(model.selected).toBe('src');
    model.edge(true);
    expect(model.selected).toBe('README.md');
    const empty = new TreeModel(source([]));
    await settle();
    empty.move(1);
    empty.edge(true);
    expect(empty.selected).toBeUndefined();
  });

  it('steps in and out with Right and Left', async () => {
    const model = new TreeModel(source(FILES));
    await settle();
    model.select('src');
    model.right();
    await settle();
    expect(model.rows[0]?.expanded).toBe(true);
    model.right();
    expect(model.selected).toBe('src/ui');
    model.right();
    await settle();
    model.right();
    expect(model.selected).toBe('src/ui/tree.tsx');
    // A file: nothing to open.
    model.right();
    expect(model.selected).toBe('src/ui/tree.tsx');
    model.left();
    expect(model.selected).toBe('src/ui');
    model.left();
    expect(shown(model)).not.toContain('    tree.tsx');
    model.left();
    expect(model.selected).toBe('src');
    model.left();
    model.left();
    expect(model.selected).toBe('src');
    model.select(undefined);
    model.left();
    model.right();
    expect(model.selected).toBeUndefined();
  });

  it('moves a selection inside a collapsed folder to the folder', async () => {
    const model = new TreeModel(source(FILES));
    await settle();
    model.expand(find('src'));
    await settle();
    model.select('src/main.ts');
    model.collapse(find('src'));
    expect(model.selected).toBe('src');
    model.select('docs');
    model.expand(find('src'));
    model.collapse(find('src'));
    expect(model.selected).toBe('docs');
    // Collapsing what isn't showing changes nothing else.
    model.collapse(find('src/ui'));
    expect(model.selected).toBe('docs');
  });
});

describe('TreeModel, all at once', () => {
  it('refreshes the roots and every folder loaded before, keeping them expanded', async () => {
    let roots = tree({ src: { 'a.ts': null, lib: { 'b.ts': null } }, docs: { 'plan.md': null } });
    const model = new TreeModel<Item>({
      ...source([]),
      children: (node) => (node ? (node.children ?? []) : roots),
    });
    await settle();
    model.expand(roots[0] as Item);
    await settle();
    model.expand((roots[0] as Item).children?.[1] as Item);
    await settle();
    expect(shown(model)).toEqual(['src', '  a.ts', '  lib', '    b.ts', 'docs']);
    // A file added under lib, a folder never opened (docs) and one gone (src/lib's sibling).
    roots = tree({ src: { lib: { 'b.ts': null, 'c.ts': null } }, docs: { 'plan.md': null } });
    await model.refresh();
    expect(shown(model)).toEqual(['src', '  lib', '    b.ts', '    c.ts', 'docs']);
    expect(model.loaded.has('docs')).toBe(false);
  });

  it('refreshes a tree whose roots can’t be read', async () => {
    const model = new TreeModel<Item>({
      ...source([]),
      children: () => {
        throw new Error('gone');
      },
    });
    await settle();
    await model.refresh();
    expect(model.rows).toEqual([]);
    expect([...model.errors.values()]).toEqual(['gone']);
  });

  it('expands everything, loading as it goes, and collapses everything', async () => {
    const model = new TreeModel(source(FILES, { async: true }));
    await settle();
    await model.expandAll();
    expect(shown(model)).toEqual([
      'src',
      '  ui',
      '    tree.tsx',
      '    menu.tsx',
      '  main.ts',
      'docs',
      '  plan.md',
      'README.md',
    ]);
    model.select('src/ui/menu.tsx');
    model.collapseAll();
    expect(shown(model)).toEqual(['src', 'docs', 'README.md']);
    expect(model.selected).toBe('src');
    // Nothing selected, or a root: the selection stays.
    model.select(undefined);
    model.collapseAll();
    expect(model.selected).toBeUndefined();
    model.select('README.md');
    model.collapseAll();
    expect(model.selected).toBe('README.md');
  });
});

describe('TreeModel, randomly', () => {
  it('keeps the selection on a row that shows, under expanded folders', async () => {
    const all: Item[] = [];
    const walk = (items: Item[]) => {
      for (const item of items) {
        all.push(item);
        if (item.children) walk(item.children);
      }
    };
    walk(FILES);
    for (let seed = 1; seed <= 50; seed++) {
      let state = seed;
      const next = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
      const model = new TreeModel(source(FILES));
      await settle();
      for (let step = 0; step < 60; step++) {
        const item = all[Math.floor(next() * all.length)] as Item;
        const ops = [
          () => {
            model.toggle(item);
          },
          () => {
            model.move(Math.floor(next() * 7) - 3);
          },
          () => {
            model.right();
          },
          () => {
            model.left();
          },
          () => {
            model.edge(next() < 0.5);
          },
        ];
        (ops[Math.floor(next() * ops.length)] as () => void)();
        const rows = model.rows;
        if (model.selected !== undefined && !rows.some((r) => r.key === model.selected)) {
          throw new Error(`seed ${String(seed)}: selection ${model.selected} is hidden`);
        }
        for (const row of rows) {
          const parent = row.key.slice(0, row.key.lastIndexOf('/'));
          if (row.depth > 0 && !model.expanded.has(parent)) {
            throw new Error(`seed ${String(seed)}: ${row.key} shows under a closed folder`);
          }
        }
      }
    }
  });
});
