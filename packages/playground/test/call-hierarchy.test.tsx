import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { HierarchyView, showHierarchy, type Call } from '../src/call-hierarchy.js';
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
let dispose: (() => void) | undefined;

beforeAll(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
});

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  opened.length = 0;
});

function mount(): void {
  const handle = render(() => <HierarchyView open={(at) => void opened.push(at)} />, document.body);
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
});
