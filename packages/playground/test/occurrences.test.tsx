import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { TreeModel } from '@cerebro-ide/ui-tree';
import { afterEach, describe, expect, it } from 'vitest';
import {
  provideOccurrences,
  setupOccurrences,
  treeOccurrences,
  type OccurrenceNavigator,
} from '../src/occurrences.js';

interface Item {
  key: string;
  children?: Item[];
}

/** A file with two lines found, a collapsed one with one, and another with one. */
const ROOTS: Item[] = [
  { key: 'a', children: [{ key: 'a1' }, { key: 'a2' }] },
  { key: 'b', children: [{ key: 'b1' }] },
  { key: 'c', children: [{ key: 'c1' }] },
];

const settle = () => new Promise((resolve) => setTimeout(resolve));

async function lines() {
  const model = new TreeModel<Item>({
    children: (item) => (item ? (item.children ?? []) : ROOTS),
    key: (item) => item.key,
    isLeaf: (item) => item.children === undefined,
  });
  for (const root of ROOTS) {
    model.expand(root);
    await model.load(root);
  }
  model.collapse(ROOTS[1] as Item);
  const opened: string[] = [];
  const navigator = treeOccurrences(
    model,
    (item) => item.children === undefined,
    (item) => opened.push(item.key),
  );
  return { model, navigator, opened };
}

describe('a tree’s occurrences', () => {
  it('are its nodes taken, collapsed or not, after the one selected, or from the start', async () => {
    const { model, navigator, opened } = await lines();
    expect(navigator.has(false)).toBe(false);
    expect(navigator.has(true)).toBe(true);
    navigator.go(true);
    await settle();
    expect(opened).toEqual(['a1']);
    expect(model.selected).toBe('a1');
    navigator.go(true);
    // Into a collapsed parent, expanded to show it.
    navigator.go(true);
    await settle();
    expect(opened).toEqual(['a1', 'a2', 'b1']);
    expect(model.selected).toBe('b1');
    expect(model.expanded.has('b')).toBe(true);
    navigator.go(true);
    await settle();
    // Nothing after the end.
    expect(navigator.has(true)).toBe(false);
    navigator.go(true);
    expect(opened).toEqual(['a1', 'a2', 'b1', 'c1']);
    // Back, over the nodes not taken.
    navigator.go(false);
    await settle();
    expect(opened.at(-1)).toBe('b1');
    model.select('a');
    expect(navigator.has(false)).toBe(false);
  });
});

describe('Next and Previous Occurrence', () => {
  const services: MenuServices = {
    commands: new CommandRegistry(),
    menus: new MenuRegistry(),
    keymap: new Keymap('other'),
  };
  setupOccurrences(services);
  const { commands } = services;
  const went: string[] = [];
  const navigator = (name: string, has = true): OccurrenceNavigator => ({
    has: () => has,
    go: (forward) => went.push(`${name} ${forward ? 'next' : 'previous'}`),
  });
  /** A tool window, with something in it that takes the keyboard. */
  const window = (id: string) => {
    const section = document.createElement('section');
    section.className = 'cerebro-tool-window';
    section.dataset.id = id;
    const button = document.createElement('button');
    section.append(button);
    document.body.append(section);
    return button;
  };
  const editor = () => {
    const input = document.createElement('textarea');
    document.body.append(input);
    return input;
  };
  const removals: (() => void)[] = [];

  afterEach(() => {
    for (const remove of removals.splice(0)) remove();
    document.body.replaceChildren();
    went.length = 0;
  });

  it('are in the Navigate menu, Previous first', () => {
    expect(services.menus.entries('main/navigate').map((e) => 'command' in e && e.command)).toEqual(
      ['navigate.previousOccurrence', 'navigate.nextOccurrence'],
    );
    expect(commands.get('navigate.nextOccurrence')?.label).toBe('Ne&xt Occurrence');
  });

  it('go through the focused tool window’s results, else the latest active one’s that has any', () => {
    expect(commands.isEnabled('navigate.nextOccurrence')).toBe(false);
    const find = window('find');
    const hierarchy = window('hierarchy');
    const project = window('project');
    removals.push(provideOccurrences('find', navigator('find')));
    removals.push(provideOccurrences('hierarchy', navigator('hierarchy')));
    find.focus();
    hierarchy.focus();
    commands.execute('navigate.nextOccurrence');
    find.focus();
    commands.execute('navigate.previousOccurrence');
    // From the editor, or a window with none: the window active last.
    editor().focus();
    commands.execute('navigate.nextOccurrence');
    project.focus();
    commands.execute('navigate.nextOccurrence');
    expect(went).toEqual(['hierarchy next', 'find previous', 'find next', 'find next']);
    // The latest active gone: the one before it.
    for (const remove of removals.splice(0, 1)) remove();
    commands.execute('navigate.nextOccurrence');
    expect(went.at(-1)).toBe('hierarchy next');
  });

  it('are disabled with nothing to go to, and keep a window’s newer results', () => {
    window('find').focus();
    const remove = provideOccurrences('find', navigator('find', false));
    expect(commands.isEnabled('navigate.nextOccurrence')).toBe(false);
    // A new search's results, then the old ones' cleaned up: the new ones stay.
    removals.push(provideOccurrences('find', navigator('newer')));
    remove();
    commands.execute('navigate.nextOccurrence');
    expect(went).toEqual(['newer next']);
  });
});
