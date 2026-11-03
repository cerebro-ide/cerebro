import { beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { OpenIn, RecentProject } from '../src/bridge.js';

const calls: unknown[][] = [];
let picked: string | null = null;
const RECENT: RecentProject[] = [
  { path: '/p/alpha', name: 'alpha', opened: 3, exists: true },
  { path: '/p/beta', name: 'beta', opened: 2, exists: false },
  { path: '/work/gamma', name: 'gamma', opened: 1, exists: true },
];

beforeAll(async () => {
  window.cerebro = {
    platform: 'linux',
    window: { setColours: () => undefined },
    project: {
      recent: () => Promise.resolve(RECENT),
      pick: () => Promise.resolve(picked),
      open: (path: string, where: OpenIn) => {
        calls.push(['open', path, where]);
        return Promise.resolve();
      },
      forget: (path: string) => {
        calls.push(['forget', path]);
        return Promise.resolve();
      },
    },
  } as unknown as NonNullable<Window['cerebro']>;
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/welcome.js');
});

const search = () => document.querySelector('.playground-welcome__search') as HTMLInputElement;
const names = () =>
  [...document.querySelectorAll('.playground-welcome__name')].map((n) => n.textContent);
const item = (path: string) =>
  document.querySelector(`.playground-welcome__project[data-path="${path}"]`) as HTMLElement;
const highlighted = () =>
  document.querySelector('.playground-welcome__project--highlighted')?.getAttribute('data-path');

// The window is made once, as it's imported: each test goes on from where the last left it.
describe('the Welcome window', () => {
  it('lists the recent projects, one that’s gone said so, in the app’s look', () => {
    expect(document.title).toBe('Welcome to Cerebro');
    expect(document.documentElement.classList).toContain('cerebro-platform-linux');
    expect(names()).toEqual(['alpha', 'beta', 'gamma']);
    expect(item('/p/beta').textContent).toContain('/p/beta (not found)');
    expect(item('/p/beta').getAttribute('aria-disabled')).toBe('true');
    expect(highlighted()).toBe('/p/alpha');
  });

  it('opens a project clicked, or a folder picked, in a new window; not one that’s gone', async () => {
    await userEvent.click(item('/p/alpha'));
    // Marked disabled, which Playwright won't click unless forced; a person can.
    await userEvent.click(item('/p/beta'), { force: true });
    const open = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Open',
    ) as HTMLElement;
    await userEvent.click(open);
    picked = '/p/new';
    await userEvent.click(open);
    await expect
      .poll(() => calls)
      .toEqual([
        ['open', '/p/alpha', 'new'],
        ['open', '/p/new', 'new'],
      ]);
    calls.length = 0;
  });

  it('filters by name or folder as the user types, and opens by Up, Down and Enter', async () => {
    await userEvent.hover(item('/work/gamma'));
    expect(highlighted()).toBe('/work/gamma');
    await userEvent.click(search());
    await userEvent.type(search(), 'p/');
    expect(names()).toEqual(['alpha', 'beta']);
    expect(highlighted()).toBe('/p/alpha');
    await userEvent.keyboard('{ArrowDown}');
    expect(highlighted()).toBe('/p/beta');
    await userEvent.keyboard('{ArrowDown}');
    expect(highlighted()).toBe('/p/alpha');
    await userEvent.keyboard('{ArrowUp}');
    expect(highlighted()).toBe('/p/beta');
    // Gone, it doesn't open.
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowUp}{Enter}');
    await expect.poll(() => calls).toEqual([['open', '/p/alpha', 'new']]);
    calls.length = 0;
    // Other keys are the field's.
    await userEvent.keyboard('{End}');
    expect(highlighted()).toBe('/p/alpha');
    // Nothing shown, nothing to move to or open.
    await userEvent.type(search(), 'zzz');
    expect(names()).toEqual([]);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(calls).toEqual([]);
    await userEvent.clear(search());
  });

  it('removes a project from the list, without opening it; with none, says how to start', async () => {
    const remove = (path: string) =>
      item(path).querySelector('.playground-welcome__remove') as HTMLElement;
    await userEvent.hover(remove('/p/alpha'));
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe('Remove from Recent Projects');
    // In a project marked disabled, which Playwright won't click unless forced; a person can.
    await userEvent.click(remove('/p/beta'), { force: true });
    await expect.poll(names).toEqual(['alpha', 'gamma']);
    // It shows on the project highlighted.
    await userEvent.hover(item('/p/alpha'));
    await userEvent.click(remove('/p/alpha'));
    await userEvent.hover(item('/work/gamma'));
    await userEvent.click(remove('/work/gamma'));
    await expect
      .poll(() => document.querySelector('.playground-welcome__empty')?.textContent)
      .toBe('No recent projects. Open a folder to start working in it.');
    expect(calls).toEqual([
      ['forget', '/p/beta'],
      ['forget', '/p/alpha'],
      ['forget', '/work/gamma'],
    ]);
  });
});
