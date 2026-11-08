// The key flows with real keyboard and mouse input (Playwright's, through Vitest), so the browser's
// own behaviour takes part: focus, Enter and Space pressing buttons, typing into fields.

import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { signal } from '@cerebro-ide/reactive';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDialog, prompt, type DialogHandle } from '../src/index.js';

const open: DialogHandle<unknown>[] = [];

afterEach(() => {
  for (const dialog of open.splice(0)) dialog.close();
});

function dialog<T>(options: Parameters<typeof openDialog<T>>[0]) {
  const handle = openDialog<T>(options);
  open.push(handle);
  return handle;
}

const focused = () => document.activeElement as HTMLElement;

describe('dialogs, with real input', () => {
  it('OK’s options, as IntelliJ’s option button: the first enabled, the others on its arrow', async () => {
    const fetchFirst = signal(true);
    const fetched = vi.fn();
    const confirm = vi.fn(() => Promise.resolve(true));
    const handle = dialog<string>({
      title: 'Push',
      content: () => <input class="field" />,
      platform: 'other',
      ok: {
        label: 'Push',
        enabled: () => !fetchFirst.get(),
        description: () => (fetchFirst.get() ? 'Fetch first' : undefined),
        accept: () => 'push',
        options: [
          {
            label: 'Force Push',
            enabled: () => !fetchFirst.get(),
            check: confirm,
            accept: () => 'force',
          },
          {
            label: 'Fetch',
            visible: () => fetchFirst.get(),
            enabled: () => fetchFirst.get(),
            run: fetched,
          },
        ],
      },
    });
    const main = document.querySelector('.cerebro-dialog__button--primary') as HTMLButtonElement;
    const arrow = document.querySelector('.cerebro-dialog__arrow') as HTMLButtonElement;
    const items = () =>
      [...document.querySelectorAll<HTMLElement>('.cerebro-dialog__option')].map((item) => [
        item.textContent,
        item.getAttribute('aria-disabled'),
      ]);
    // Push and Force Push wait for a fetch: the button fetches, and stays open.
    expect(main.textContent).toBe('Fetch');
    expect(main.title).toBe('');
    await userEvent.click(main);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(handle.open).toBe(true);
    await userEvent.click(arrow);
    expect(arrow.getAttribute('aria-expanded')).toBe('true');
    expect(items()).toEqual([
      ['Push', 'true'],
      ['Force Push', 'true'],
    ]);
    expect((document.querySelector('.cerebro-dialog__option') as HTMLElement).title).toBe(
      'Fetch first',
    );
    // A disabled one does nothing; the list stays. (Playwright's click waits for it to be enabled.)
    (document.querySelector('.cerebro-dialog__option') as HTMLElement).click();
    expect(handle.open).toBe(true);
    expect(items()).toHaveLength(2);
    // Escape closes the list, not the dialog.
    await userEvent.keyboard('{Escape}');
    expect(items()).toEqual([]);
    expect(focused()).toBe(arrow);
    expect(handle.open).toBe(true);
    // Fetched: Push is the button's, Force Push the arrow's, and Fetch is gone.
    fetchFirst.set(false);
    expect(main.textContent).toBe('Push');
    await userEvent.keyboard('{Enter}');
    expect(items()).toEqual([['Force Push', 'false']]);
    // Around the list, both ways.
    await userEvent.keyboard('{ArrowUp}{ArrowDown}{ArrowDown}');
    expect(document.querySelector('.cerebro-dialog__option--highlighted')?.textContent).toBe(
      'Force Push',
    );
    await userEvent.keyboard('{Enter}');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await handle.result).toBe('force');
  });

  it('closes OK’s list when it loses the focus, and chooses from it with the pointer', async () => {
    const handle = dialog<string>({
      title: 'T',
      content: () => <input class="field" />,
      ok: {
        accept: () => 'ok',
        options: [
          { label: 'Other', accept: () => 'other' },
          { label: 'Another', accept: () => 'another' },
        ],
      },
    });
    const arrow = document.querySelector('.cerebro-dialog__arrow') as HTMLButtonElement;
    await userEvent.click(arrow);
    expect(document.querySelector('.cerebro-dialog__options')).not.toBeNull();
    // Enter with nothing highlighted chooses nothing; other keys do nothing.
    await userEvent.keyboard('{Enter}a');
    expect(handle.open).toBe(true);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(document.querySelector('.cerebro-dialog__option--highlighted')?.textContent).toBe(
      'Other',
    );
    await userEvent.click(document.querySelector('.field') as HTMLElement);
    expect(document.querySelector('.cerebro-dialog__options')).toBeNull();
    // Pressed again, it closes; and again, it opens.
    await userEvent.click(arrow);
    await userEvent.keyboard('{Tab}');
    expect(document.querySelector('.cerebro-dialog__options')).toBeNull();
    await userEvent.click(arrow);
    await userEvent.click(document.querySelector('.cerebro-dialog__option') as HTMLElement);
    expect(await handle.result).toBe('other');
  });

  it('disables OK’s arrow when it has nothing to list', () => {
    dialog({
      title: 'T',
      content: () => null,
      ok: { accept: () => 1, options: [{ label: 'Hidden', visible: () => false, run: () => {} }] },
    });
    expect((document.querySelector('.cerebro-dialog__arrow') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('Tab moves through the controls, wrapping; Enter on Cancel cancels', async () => {
    let accepted = 0;
    const handle = dialog({
      title: 'T',
      content: () => <input class="field" />,
      ok: { accept: () => ++accepted },
      platform: 'other',
    });
    expect(focused().className).toBe('field');
    await userEvent.keyboard('{Tab}');
    expect(focused().textContent).toBe('OK');
    await userEvent.keyboard('{Tab}');
    expect(focused().textContent).toBe('Cancel');
    await userEvent.keyboard('{Tab}');
    expect(focused().className).toBe('field');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(focused().textContent).toBe('Cancel');
    await userEvent.keyboard('{Enter}');
    expect(await handle.result).toBeUndefined();
    expect(accepted).toBe(0);
  });

  it('Space on OK accepts once', async () => {
    let accepted = 0;
    const handle = dialog({ title: 'T', content: () => null, ok: { accept: () => ++accepted } });
    await userEvent.keyboard(' ');
    expect(await handle.result).toBe(1);
    expect(accepted).toBe(1);
  });

  it('Escape cancels', async () => {
    const handle = dialog({ title: 'T', content: () => <input />, ok: { accept: () => 1 } });
    await userEvent.keyboard('{Escape}');
    expect(await handle.result).toBeUndefined();
  });

  it('a press outside keeps the focus in the dialog', async () => {
    dialog({ title: 'T', content: () => <input class="field" />, ok: { accept: () => 1 } });
    await userEvent.click(document.querySelector('.cerebro-dialog-layer') as HTMLElement, {
      position: { x: 5, y: 5 },
    });
    expect(focused().className).toBe('field');
  });

  it('drags by its title bar', async () => {
    dialog({ title: 'T', content: () => null, width: 400 });
    const element = document.querySelector('.cerebro-dialog') as HTMLElement;
    const before = element.getBoundingClientRect();
    await userEvent.dragAndDrop(document.body, document.body, {
      sourcePosition: { x: before.left + 50, y: before.top + 10 },
      targetPosition: { x: before.left + 150, y: before.top + 70 },
    });
    const after = element.getBoundingClientRect();
    expect(after.left - before.left).toBeCloseTo(100, 0);
    expect(after.top - before.top).toBeCloseTo(60, 0);
  });
});

describe('prompt, with real input', () => {
  it('types, refuses what isn’t valid, and accepts with Enter', async () => {
    const result = prompt({
      title: 'New Branch',
      label: 'Name:',
      validate: (text) => (text === 'main' ? 'Branch main exists' : undefined),
    });
    await userEvent.keyboard('main');
    expect(document.querySelector('.cerebro-dialog-field__error')?.textContent).toBe(
      'Branch main exists',
    );
    await userEvent.keyboard('{Enter}');
    expect(document.querySelector('.cerebro-dialog')).not.toBeNull();
    await userEvent.keyboard('2{Enter}');
    expect(await result).toBe('main2');
  });

  it('replaces a starting value as you type, since it starts selected', async () => {
    const result = prompt({ title: 'Rename', label: 'Name:', value: 'old.ts' });
    await new Promise((resolve) => setTimeout(resolve));
    await userEvent.keyboard('new.ts{Enter}');
    expect(await result).toBe('new.ts');
  });
});
