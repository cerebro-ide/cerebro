import { beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { DiffSpec } from '../src/bridge.js';

// A diff window's page, as the app opens it: its hash names the diff, read through the opener's
// hosts. It's made once, as it's imported: each test goes on from where the last left it.

const requests: unknown[][] = [];
const jumps: unknown[] = [];
/** What the host reads, as the file is now. */
let texts = { original: 'one\ntwo\n', text: 'one\nthree\n' };
const tabs: unknown[] = [];
/** Whether each move to a tab asked the opener's other diff windows to move too. */
const alls: unknown[] = [];
/** What the app calls when another diff window moved. */
let moved: (() => void) | undefined;
const SPEC: DiffSpec = {
  project: '/r',
  env: '/r/w',
  path: 'src/a.ts',
  range: { from: '0123456789ab', to: 'abcdef012345' },
};

beforeAll(async () => {
  window.cerebro = {
    app: true,
    platform: 'linux',
    window: { setColours: () => undefined },
    host: {
      request: (project: string, method: string, params: unknown) => {
        requests.push([project, method, params]);
        return Promise.resolve(texts);
      },
    },
    diff: {
      jump: (at: unknown) => {
        jumps.push(at);
        return Promise.resolve();
      },
      toTab: (spec: unknown, all: unknown) => {
        tabs.push(spec);
        alls.push(all);
        return Promise.resolve();
      },
      onMove: (listener: () => void) => {
        moved = listener;
        return () => undefined;
      },
      // Between commits: no document to be told of.
      onDocument: () => () => undefined,
    },
  } as unknown as NonNullable<Window['cerebro']>;
  location.hash = `#diff=${encodeURIComponent(JSON.stringify(SPEC))}`;
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/diff-window.js');
});

const root = () => document.querySelector('.cerebro-editor-diff')?.shadowRoot;
const sides = () =>
  [...(root()?.querySelectorAll('.cm-content') ?? [])].map((side) => side.textContent);

describe('a diff window', () => {
  it('shows the diff its hash names, read through its opener’s project, titled after it', async () => {
    expect(document.title).toBe('a.ts (01234567..abcdef01)');
    expect(document.documentElement.classList).toContain('cerebro-platform-linux');
    expect(document.querySelector('.playground-diff-window__title')?.textContent).toBe(
      document.title,
    );
    await expect.poll(sides).toEqual(['onetwo', 'onethree']);
    expect(requests).toEqual([
      ['/r', 'git.diff', { path: '/r/w', file: 'src/a.ts', ...SPEC.range }],
    ]);
    // The diff's toolbar, as in a tab, with Jump to Source; one file alone, none of a list's.
    expect(document.querySelector('[data-command="diff.nextDifference"]')).not.toBeNull();
    expect(document.querySelector('[data-command="changes.jumpToSource"]')).not.toBeNull();
    expect(document.querySelector('[data-command="diff.nextFile"]')).toBeNull();
    expect(document.querySelector('.playground-diff-window__count')).toBeNull();
  });

  it('jumps to the source in its opener, where the caret is (zero-based), on its key', async () => {
    // Its button on, once the diff shows.
    const button = document.querySelector(
      '[data-command="changes.jumpToSource"]',
    ) as HTMLButtonElement;
    await expect.poll(() => button.disabled).toBe(false);
    // With the keyboard elsewhere in the window: the diff's caret, at its first change.
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('{F4}');
    expect(jumps).toEqual([{ env: '/r/w', path: 'src/a.ts', line: 1, column: 0 }]);
    jumps.length = 0;
    const lines = root()?.querySelectorAll('.cm-diff-b .cm-line') as NodeListOf<HTMLElement>;
    await userEvent.click(lines[0] as HTMLElement);
    await userEvent.keyboard('{Home}{F4}');
    expect(jumps).toEqual([{ env: '/r/w', path: 'src/a.ts', line: 0, column: 0 }]);
  });
});

describe('with the focus back', () => {
  it('reads the diff again, shown again only if it’s changed', async () => {
    const shown = root()?.querySelector('.cm-diff-b .cm-content');
    const before = requests.length;
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => requests.length).toBe(before + 1);
    // The same texts: the same editor, the caret where it was.
    expect(root()?.querySelector('.cm-diff-b .cm-content')).toBe(shown);
    texts = { original: 'one\ntwo\n', text: 'one\nfour\n' };
    window.dispatchEvent(new Event('focus'));
    await expect.poll(sides).toEqual(['onetwo', 'onefour']);
  });
});

describe('its title', () => {
  it('is the file’s name, and the commits it’s between', async () => {
    const { titleOf } = await import('../src/diff-window.js');
    expect(titleOf({ project: '/r', env: '/r', path: 'a/b.ts' })).toBe('b.ts');
    // Against a branch or a tag, as it is: its name.
    const spec = { project: '/r', env: '/r', path: 'a/b.ts' };
    expect(titleOf({ ...spec, range: { from: 'refs/remotes/origin/main' } })).toBe(
      'b.ts (origin/main)',
    );
  });

  it('moves to a tab of its opener, between the same commits, from its Settings', async () => {
    await userEvent.click(document.querySelector('[data-menu="diff/settings"]') as Element);
    const item = [...document.querySelectorAll('.cerebro-menu [role^="menuitem"]')].find((i) =>
      i.textContent.includes('Show Diff in Editor Tab'),
    ) as Element;
    await userEvent.click(item);
    expect(tabs).toEqual([SPEC]);
    // Every other diff window of the opener moves too, as IntelliJ's.
    expect(alls).toEqual([true]);
    localStorage.removeItem('cerebro.diff');
  });

  it('moves to a tab when told, another diff window having moved, the others not told again', () => {
    moved?.();
    expect(tabs).toEqual([SPEC, SPEC]);
    expect(alls).toEqual([true, false]);
  });

  it('closes on Escape, as IntelliJ’s, unless something in it took the key', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    try {
      const content = root()?.querySelectorAll<HTMLElement>('.cm-content')[1] as HTMLElement;
      await userEvent.click(content);
      // Taken by what has the focus (a popup's field, say): the window stays.
      const take = (event: KeyboardEvent) => {
        event.preventDefault();
      };
      content.addEventListener('keydown', take);
      await userEvent.keyboard('{Escape}');
      expect(close).not.toHaveBeenCalled();
      content.removeEventListener('keydown', take);
      await userEvent.keyboard('{Escape}');
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
    }
  });
});
