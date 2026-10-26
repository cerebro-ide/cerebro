// The key flows with real keyboard and mouse input (Playwright's, through Vitest), so the browser's
// own behaviour takes part: focus, Enter and Space pressing buttons, typing into fields.

import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
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
