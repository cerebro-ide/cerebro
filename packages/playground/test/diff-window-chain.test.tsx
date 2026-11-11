import { beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { DiffSpec } from '../src/bridge.js';

// A diff window opened from a list of files (diff-window.test has one opened alone): it goes through
// them, as IntelliJ's diff window goes through the files it was opened with. Made once, as it's
// imported: each test goes on from where the last left it.

const requests: unknown[] = [];
const jumps: unknown[] = [];
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
        return Promise.resolve({ original: `${params.file}\n`, text: `${params.file} changed\n` });
      },
    },
    diff: {
      jump: (at: unknown) => {
        jumps.push(at);
        return Promise.resolve();
      },
    },
  } as unknown as NonNullable<Window['cerebro']>;
  location.hash = `#diff=${encodeURIComponent(JSON.stringify(SPEC))}`;
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/diff-window.js');
});

const root = () => document.querySelector('.cerebro-editor-diff')?.shadowRoot;
const shown = () => root()?.querySelector('.cm-diff-a .cm-content')?.textContent;
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
});
