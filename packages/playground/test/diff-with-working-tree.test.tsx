import { render } from '@cerebro-ide/jsx';
import type { Tab } from '@cerebro-ide/layout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { diffTab } from '../src/changes.js';
import {
  DiffWithWorkingTree,
  setupDiffWithWorkingTree,
  showDiffWithWorkingTree,
} from '../src/diff-with-working-tree.js';
import { FakeHost } from './fakes.js';

/** The files each ref differs in from the working tree, as `git.changes` is asked for them. */
const differing: Record<string, unknown> = {
  feature: [
    { path: 'a.ts', status: 'modified' },
    { path: 'b.ts', status: 'added' },
  ],
  same: [],
  gone: new Error("fatal: bad revision 'gone'"),
};
const host = new FakeHost({
  'git.changes': ({ from }: { from: string }) => {
    const answer = differing[from];
    if (answer instanceof Error) throw answer;
    return answer;
  },
});
const reveal = vi.fn();
setupDiffWithWorkingTree(reveal);
const opened: [Tab, readonly string[] | undefined][] = [];

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  opened.length = 0;
});

function mount() {
  const box = document.createElement('div');
  box.style.height = '400px';
  document.body.append(box);
  const handle = render(
    () => <DiffWithWorkingTree open={(tab, chain) => opened.push([tab, chain])} />,
    box,
  );
  dispose = () => {
    handle.dispose();
  };
}

const show = (ref: string) => {
  showDiffWithWorkingTree({ host, worktree: '/r', ref, current: 'main' });
};
const text = (selector: string) => document.querySelector(selector)?.textContent;

describe('Show Diff with Working Tree’s window', () => {
  it('says nothing is compared before anything is', () => {
    mount();
    expect(text('.playground-project__empty')).toBe('Nothing compared');
  });

  it('lists the files that differ, in IntelliJ’s words, each opening its diff', async () => {
    mount();
    show('feature');
    expect(reveal).toHaveBeenCalled();
    expect(text('.playground-compare__explanation')).toBe(
      'Difference between current working tree on main and files in feature:',
    );
    await expect
      .poll(() => [...document.querySelectorAll('.cerebro-tree-row')].map((r) => r.textContent))
      .toEqual([expect.stringContaining('a.ts'), expect.stringContaining('b.ts')]);
    expect(host.params('git.changes').at(-1)).toEqual({ path: '/r', from: 'feature' });
    await userEvent.dblClick(document.querySelector('.cerebro-tree-row') as HTMLElement);
    expect(opened).toEqual([[diffTab('a.ts', { from: 'feature' }), ['a.ts', 'b.ts']]]);
  });

  it('says when none differ, or why they can’t be read; each comparison in place of the last', async () => {
    mount();
    show('same');
    await expect
      .poll(() => text('.playground-working-tree-diff .playground-project__empty'))
      .toBe('No differences');
    show('gone');
    await expect
      .poll(() => text('.playground-working-tree-diff .playground-project__empty'))
      .toBe("fatal: bad revision 'gone'");
    expect(document.querySelectorAll('.playground-working-tree-diff')).toHaveLength(1);
    // The same again: read again.
    const asked = host.params('git.changes').length;
    show('gone');
    await expect.poll(() => host.params('git.changes').length).toBe(asked + 1);
  });
});
