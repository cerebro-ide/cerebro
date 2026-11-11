import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { diffSource } from '@cerebro-ide/ui-editor';
import type { DiffSpec } from '../src/bridge.js';
import { globalSettings } from '../src/settings.js';

// A diff window opened from a list of files (diff-window.test has one opened alone): it goes through
// them, as IntelliJ's diff window goes through the files it was opened with. Made once, as it's
// imported: each test goes on from where the last left it.

const requests: unknown[] = [];
const jumps: unknown[] = [];
const tabs: unknown[] = [];
let told: (path: string, text: string | null) => void = () => undefined;
const SPEC: DiffSpec = {
  project: '/r',
  env: '/r/w',
  path: 'b.ts',
  chain: ['src/a.ts', 'b.ts', 'src/c/d.ts'],
};

beforeAll(async () => {
  window.cerebro = {
    app: true,
    platform: 'linux',
    window: { setColours: () => undefined },
    host: {
      request: (_project: string, _method: string, params: { file: string }) => {
        requests.push(params.file);
        // Two changes, lines 0 and 10, far enough apart to be two.
        const middle = Array.from({ length: 9 }, (_, i) => String(i + 1)).join('\n');
        return Promise.resolve({
          original: `${params.file}\n${middle}\nend\n`,
          text: `${params.file} changed\n${middle}\nend changed\n`,
        });
      },
    },
    diff: {
      jump: (at: unknown) => {
        jumps.push(at);
        return Promise.resolve();
      },
      toTab: (spec: unknown) => {
        tabs.push(spec);
        return Promise.resolve();
      },
      // Its files' documents can't be read: their diffs are git's, not edited.
      document: (file: string) => {
        queueMicrotask(() => {
          told(file, null);
        });
        return Promise.resolve();
      },
      onDocument: (listener: typeof told) => {
        told = listener;
        return () => undefined;
      },
      onMove: () => () => undefined,
    },
  } as unknown as NonNullable<Window['cerebro']>;
  location.hash = `#diff=${encodeURIComponent(JSON.stringify(SPEC))}`;
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/diff-window.js');
});

// The choice made in its Settings, kept where other test files' pages would read it.
afterAll(() => {
  localStorage.removeItem('cerebro.diff');
});

const root = () => document.querySelector('.cerebro-editor-diff')?.shadowRoot;
/** The file shown: the left's first line. */
const shown = () => root()?.querySelector('.cm-diff-a .cm-line')?.textContent;
/** Where the diff's caret is, on the right (zero-based). */
const caret = () => diffSource(root()?.host as Element)?.line;
const hint = () => document.querySelector('.playground-diff__hint');
const button = (command: string) =>
  document.querySelector(`[data-command="${command}"]`) as HTMLButtonElement;
const count = () => document.querySelector('.playground-diff-window__count') as HTMLButtonElement;
/** The toolbar's buttons, in order, after Next Difference and before the viewers. */
const toolbar = () =>
  [...document.querySelectorAll('.playground-diff__toolbar > button')].map(
    (b) => b.getAttribute('data-command') ?? b.textContent,
  );

describe('a diff window with a list of files', () => {
  it('shows the file it was opened for, and where it is in the list, in IntelliJ’s order', async () => {
    await expect.poll(shown).toBe('b.ts');
    expect(document.title).toBe('b.ts');
    expect(toolbar().slice(0, 6)).toEqual([
      'diff.previousDifference',
      'diff.nextDifference',
      'changes.jumpToSource',
      'diff.previousFile',
      '2/3',
      'diff.nextFile',
    ]);
    expect(button('diff.previousFile').disabled).toBe(false);
    expect(button('diff.nextFile').disabled).toBe(false);
    // The count in the app's text, as wide as it is.
    const font = getComputedStyle(document.documentElement).getPropertyValue('--cerebro-font');
    expect(getComputedStyle(count()).fontFamily).toBe(font.trim().replaceAll("'", '"'));
    expect(count().getBoundingClientRect().width).toBeGreaterThan(
      button('diff.nextFile').getBoundingClientRect().width,
    );
  });

  it('compares the next file, to the last', async () => {
    await userEvent.click(button('diff.nextFile'));
    await expect.poll(shown).toBe('src/c/d.ts');
    expect(document.title).toBe('d.ts');
    expect(document.querySelector('.playground-diff-window__title')?.textContent).toBe('d.ts');
    expect(count().textContent).toBe('3/3');
    expect(button('diff.nextFile').disabled).toBe(true);
    expect(requests).toEqual(['b.ts', 'src/c/d.ts']);
  });

  it('compares the previous file on its key, and jumps to the one shown', async () => {
    const lines = root()?.querySelectorAll('.cm-diff-b .cm-line') as NodeListOf<HTMLElement>;
    await userEvent.click(lines[0] as HTMLElement);
    await userEvent.keyboard('{Home}{F4}');
    expect(jumps).toEqual([{ env: '/r/w', path: 'src/c/d.ts', line: 0, column: 0 }]);
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}');
    await expect.poll(shown).toBe('b.ts');
    expect(count().textContent).toBe('2/3');
  });

  it('goes to the file chosen from its count, the one shown first, by name and folder', async () => {
    await userEvent.hover(count());
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent, { timeout: 3000 })
      .toBe('Go to Changed File');
    await userEvent.click(count());
    const items = () => [...document.querySelectorAll('.cerebro-popup-item')];
    await expect.poll(() => items().length).toBe(3);
    expect(items().map((item) => item.textContent)).toEqual(['a.tssrc', 'b.ts', 'd.tssrc/c']);
    expect(items()[1]?.getAttribute('aria-selected')).toBe('true');
    await userEvent.click(items()[0] as Element);
    await expect.poll(shown).toBe('src/a.ts');
    expect(count().textContent).toBe('1/3');
    expect(button('diff.previousFile').disabled).toBe(true);
    // Closed without a choice: it stays.
    await userEvent.click(count());
    await expect.poll(() => items().length).toBe(3);
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => items().length).toBe(0);
    expect(count().textContent).toBe('1/3');
  });

  it('goes on to the next file past the last difference, pressed again, at its first', async () => {
    // At src/a.ts, which has the keyboard, at its first change.
    await expect.poll(caret).toBe(0);
    await userEvent.keyboard('{F7}');
    expect(caret()).toBe(10);
    expect(hint()).toBeNull();
    // The last: the first press says to press again, and stays.
    await userEvent.keyboard('{F7}');
    expect(hint()?.textContent).toBe('Press again to go to the next file');
    expect(hint()?.classList).toContain('playground-diff__hint--next');
    expect(shown()).toBe('src/a.ts');
    await userEvent.keyboard('{F7}');
    await expect.poll(shown).toBe('b.ts');
    expect(hint()).toBeNull();
    await expect.poll(caret).toBe(0);
  });

  it('comes back to the previous file’s last difference, the hint gone with any key', async () => {
    await userEvent.keyboard('{Shift>}{F7}{/Shift}');
    expect(hint()?.textContent).toBe('Press again to go to the previous file');
    expect(hint()?.classList).toContain('playground-diff__hint--previous');
    // Hidden by another key; still ready to go on.
    await userEvent.keyboard('{Control}');
    expect(hint()).toBeNull();
    await userEvent.keyboard('{Shift>}{F7}{/Shift}');
    await expect.poll(shown).toBe('src/a.ts');
    await expect.poll(caret).toBe(10);
    expect(count().textContent).toBe('1/3');
    // Gone to a difference, and back at the end: two presses again.
    await userEvent.keyboard('{Shift>}{F7}{/Shift}');
    expect(caret()).toBe(0);
    expect(button('diff.previousDifference').disabled).toBe(true);
    await userEvent.keyboard('{F7}{F7}');
    expect(hint()?.textContent).toBe('Press again to go to the next file');
    // Shown another way: what the press made ready is forgotten.
    await userEvent.click(button('diff.nextFile'));
    await expect.poll(shown).toBe('b.ts');
    expect(hint()).toBeNull();
    await expect.poll(caret).toBe(0);
    await userEvent.keyboard('{F7}{F7}');
    expect(hint()?.textContent).toBe('Press again to go to the next file');
    expect(shown()).toBe('b.ts');
  });

  it('stays at the last change if turned off in Settings → Tools → Diff & Merge, as IntelliJ’s', async () => {
    // At b.ts's last change, as the test before left it.
    expect(button('diff.nextDifference').disabled).toBe(false);
    globalSettings.layers.global.set('diff.goToNextFile', false);
    await expect.poll(() => button('diff.nextDifference').disabled).toBe(true);
    // Compare Next File still goes on.
    expect(button('diff.nextFile').disabled).toBe(false);
    globalSettings.layers.global.reset('diff.goToNextFile');
    await expect.poll(() => button('diff.nextDifference').disabled).toBe(false);
  });

  it('moves the file shown to a tab of its opener, from its Settings, as IntelliJ’s', async () => {
    await userEvent.click(button('diff.nextFile'));
    await expect.poll(shown).toBe('src/c/d.ts');
    await userEvent.click(document.querySelector('[data-menu="diff/settings"]') as Element);
    const item = [...document.querySelectorAll('.cerebro-menu [role^="menuitem"]')].find((i) =>
      i.textContent.includes('Show Diff in Editor Tab'),
    ) as Element;
    await userEvent.click(item);
    // The file shown, not the list: a tab shows one file.
    expect(tabs).toEqual([{ project: '/r', env: '/r/w', path: 'src/c/d.ts' }]);
  });
});
