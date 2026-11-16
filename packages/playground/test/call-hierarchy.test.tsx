import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  HierarchyView,
  readHierarchySettings,
  setupCallHierarchy,
  showHierarchy,
  type Call,
} from '../src/call-hierarchy.js';
import { workspace } from '../src/environments.js';

const call = (name: string, kind: string | undefined, calls: number, detail?: string): Call => ({
  name,
  ...(kind === undefined ? {} : { kind }),
  ...(detail === undefined ? {} : { detail }),
  path: `/r/${name}.ts`,
  at: { line: 1, column: 9 },
  calls: Array.from({ length: calls }, (_, i) => ({ line: 5 + i, column: 2 })),
  item: name,
});

const opened: { path: string; line: number; column: number }[] = [];
/** Whether each opening put the focus in the editor. */
const focused: boolean[] = [];
const services: MenuServices = {
  commands: new CommandRegistry(),
  menus: new MenuRegistry(),
  keymap: new Keymap('other'),
};
setupCallHierarchy(services);
const { commands } = services;
let dispose: (() => void) | undefined;

beforeAll(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
});

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  opened.length = 0;
  focused.length = 0;
});

function mount(): void {
  const handle = render(
    () => (
      <HierarchyView
        services={services}
        open={(at, focus) => {
          opened.push(at);
          focused.push(focus);
        }}
      />
    ),
    document.body,
  );
  dispose = () => {
    handle.dispose();
  };
}

const rows = () =>
  [...document.querySelectorAll('.cerebro-tree-row')].map((row) => row.textContent);
const row = (key: string) => document.querySelector(`[data-key="${key}"]`) as HTMLElement;

describe('the Hierarchy tool window', () => {
  it('says there’s none before one is shown', () => {
    mount();
    expect(document.querySelector('.playground-project__empty')?.textContent).toBe('No hierarchy');
  });

  it('shows the callers of the one asked about, theirs as each is expanded', async () => {
    const asked: unknown[] = [];
    showHierarchy({
      worktree: '/r',
      root: call('area', 'function', 0),
      callers: (of) => {
        asked.push(of.item);
        return Promise.resolve(
          of.item === 'area'
            ? [call('twice', 'method', 2, 'Shape'), call('main', undefined, 1)]
            : of.item === 'twice'
              ? [call('top', 'constructor', 1)]
              : null,
        );
      },
      callees: () => Promise.resolve(null),
    });
    mount();
    expect(document.querySelector('.playground-occurrences__title')?.textContent).toBe(
      'Callers of area()',
    );
    // The one asked about, open: its callers, one calling twice, under it. Each with its kind's
    // icon, a letter (none for one of no kind).
    await expect.poll(rows).toEqual(['farea()', 'mtwice()(2 usages)Shape', 'main']);
    expect(asked).toEqual(['area']);
    await userEvent.dblClick(row('0/0'));
    expect(opened).toEqual([{ path: '/r/twice.ts', line: 5, column: 2 }]);
    // Expanded, its own callers; none for one the server has none for.
    await userEvent.click(row('0/0'));
    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(rows).toEqual(['farea()', 'mtwice()(2 usages)Shape', 'mtop()', 'main']);
    await userEvent.click(row('0/1'));
    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(() => asked).toEqual(['area', 'twice', 'main']);
    // The one asked about opens at its name.
    await userEvent.click(row('0'));
    await userEvent.keyboard('{Enter}');
    expect(opened.at(-1)).toEqual({ path: '/r/area.ts', line: 1, column: 9 });
  });

  describe('its toolbar', () => {
    /** `area`, which `twice` and `main10` and `main9` call, and which calls `helper` twice. */
    const show = (asked: unknown[] = []) => {
      showHierarchy({
        worktree: '/r',
        root: call('area', 'function', 0),
        callers: (of) => {
          asked.push(['callers', of.item]);
          return Promise.resolve(
            of.item === 'area'
              ? [
                  call('twice', 'method', 1),
                  call('main10', undefined, 1),
                  call('main9', undefined, 1),
                ]
              : [],
          );
        },
        callees: (of) => {
          asked.push(['callees', of.item]);
          return Promise.resolve(
            of.item === 'area'
              ? [call('helper', 'function', 2), call('nowhere', 'function', 0)]
              : [],
          );
        },
      });
    };
    const buttons = () =>
      [...document.querySelectorAll('[role="toolbar"][aria-label="Hierarchy"] button')].map((b) => [
        b.getAttribute('aria-label'),
        b.getAttribute('aria-pressed'),
      ]);
    const title = () => document.querySelector('.playground-occurrences__title')?.textContent;

    it('has IntelliJ’s actions in its order, its callers to start with', async () => {
      show();
      mount();
      await expect.poll(rows).toHaveLength(4);
      expect(buttons()).toEqual([
        ['Caller Methods Hierarchy', 'true'],
        ['Callee Methods Hierarchy', 'false'],
        ['Alphabetically', 'false'],
        ['Refresh', null],
        ['Navigate with Single Click', 'false'],
        ['Collapse All', null],
      ]);
    });

    it('shows what it calls, a callee opening where the one above calls it', async () => {
      const asked: unknown[] = [];
      show(asked);
      mount();
      await expect.poll(rows).toHaveLength(4);
      commands.execute('hierarchy.callees');
      await expect.poll(title).toBe('Callees of area()');
      await expect.poll(rows).toEqual(['farea()', 'fhelper()(2 usages)', 'fnowhere()']);
      expect(asked).toContainEqual(['callees', 'area']);
      expect(buttons()[1]).toEqual(['Callee Methods Hierarchy', 'true']);
      // Where `area` calls it: in area.ts, not helper.ts.
      await userEvent.dblClick(row('0/0'));
      expect(opened).toEqual([{ path: '/r/area.ts', line: 5, column: 2 }]);
      // No place given: at its name, in its own file.
      await userEvent.dblClick(row('0/1'));
      expect(opened.at(-1)).toEqual({ path: '/r/nowhere.ts', line: 1, column: 9 });
      commands.execute('hierarchy.callers');
      await expect.poll(title).toBe('Callers of area()');
    });

    it('sorts by name, numbers by their value; kept', async () => {
      show();
      mount();
      await expect.poll(rows).toEqual(['farea()', 'mtwice()', 'main10', 'main9']);
      commands.execute('hierarchy.sortAlphabetically');
      await expect.poll(rows).toEqual(['farea()', 'main9', 'main10', 'mtwice()']);
      expect(readHierarchySettings().alphabetical).toBe(true);
      commands.execute('hierarchy.sortAlphabetically');
      await expect.poll(rows).toEqual(['farea()', 'mtwice()', 'main10', 'main9']);
      expect(readHierarchySettings().alphabetical).toBe(false);
    });

    it('opens what’s selected with Navigate with Single Click, the focus left in the tree', async () => {
      show();
      mount();
      await expect.poll(rows).toHaveLength(4);
      await userEvent.click(row('0/0'));
      expect(opened).toEqual([]);
      commands.execute('hierarchy.autoscrollToSource');
      expect(readHierarchySettings().toSource).toBe(true);
      await userEvent.click(row('0/1'));
      await expect.poll(() => opened).toEqual([{ path: '/r/main10.ts', line: 5, column: 2 }]);
      expect(focused).toEqual([false]);
      commands.execute('hierarchy.autoscrollToSource');
    });

    it('reads it again, and collapses all', async () => {
      const asked: unknown[] = [];
      show(asked);
      mount();
      await expect.poll(rows).toHaveLength(4);
      commands.execute('hierarchy.refresh');
      await expect
        .poll(() => asked.filter((a) => JSON.stringify(a) === '["callers","area"]').length)
        .toBe(2);
      commands.execute('hierarchy.collapseAll');
      await expect.poll(rows).toEqual(['farea()']);
      dispose?.();
      dispose = undefined;
      expect(commands.isEnabled('hierarchy.refresh')).toBe(false);
    });
  });
});

describe('readHierarchySettings', () => {
  it('starts with IntelliJ’s defaults, both off, when nothing readable is kept', () => {
    localStorage.setItem('cerebro.hierarchy', '{');
    expect(readHierarchySettings()).toEqual({ alphabetical: false, toSource: false });
    localStorage.removeItem('cerebro.hierarchy');
  });
});
