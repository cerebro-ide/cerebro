import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDialog, type DialogHandle, type DialogOptions } from '../src/index.js';

const open: DialogHandle<unknown>[] = [];

afterEach(() => {
  for (const dialog of open.splice(0)) dialog.close();
  document.body.replaceChildren();
});

function dialog<T>(options: Partial<DialogOptions<T>> = {}) {
  const handle = openDialog<T>({ title: 'Title', content: () => null, ...options });
  open.push(handle);
  return handle;
}

/** The newest dialog. */
const element = () =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-dialog')].at(-1) as HTMLElement;
const buttons = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].map(
    (b) => b.textContent,
  );
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;

function key(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function pointer(type: string, x: number, y: number, target: EventTarget = window, button = 0) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }),
  );
}

describe('openDialog', () => {
  it('opens centred, as a labelled modal dialog', () => {
    dialog({ title: 'Settings', width: 500 });
    const rect = element().getBoundingClientRect();
    expect(rect.width).toBe(500);
    expect(rect.left + rect.width / 2).toBeCloseTo(window.innerWidth / 2, 0);
    expect(rect.top + rect.height / 2).toBeCloseTo(window.innerHeight / 2, 0);
    expect(element().getAttribute('role')).toBe('dialog');
    expect(element().getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(element().getAttribute('aria-labelledby') as string);
    expect(title?.textContent).toBe('Settings');
  });

  it('accepts with OK, giving what it accepts, and gives the focus back', async () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const handle = dialog({ ok: { accept: () => 42 }, platform: 'other' });
    expect(buttons()).toEqual(['OK', 'Cancel']);
    expect(document.activeElement).toBe(button('OK'));
    button('OK').click();
    expect(await handle.result).toBe(42);
    expect(handle.open).toBe(false);
    expect(document.querySelector('.cerebro-dialog-layer')).toBeNull();
    expect(document.activeElement).toBe(before);
    handle.close(7);
    expect(await handle.result).toBe(42);
  });

  it('cancels with Cancel, the close button or Escape', async () => {
    for (const how of ['cancel', 'close', 'escape']) {
      const handle = dialog({ ok: { accept: () => 1 } });
      if (how === 'cancel') button('Cancel').click();
      else if (how === 'close')
        (element().querySelector('.cerebro-dialog__close') as HTMLElement).click();
      else expect(key(element(), 'Escape').defaultPrevented).toBe(true);
      expect(await handle.result).toBeUndefined();
    }
  });

  it('puts Cancel first on macOS, and names the buttons as asked', () => {
    dialog({
      ok: { label: 'Create', accept: () => 1 },
      cancelLabel: 'Never mind',
      platform: 'mac',
    });
    expect(buttons()).toEqual(['Never mind', 'Create']);
  });

  it('applies without closing, and on OK while there is something to apply', async () => {
    const pending = signal(false);
    const run = vi.fn(() => {
      pending.set(false);
    });
    const handle = dialog({
      ok: { accept: () => 'ok' },
      apply: { enabled: () => pending.get(), run },
      platform: 'other',
    });
    expect(buttons()).toEqual(['OK', 'Cancel', 'Apply']);
    expect(button('Apply').disabled).toBe(true);
    pending.set(true);
    button('Apply').click();
    expect(run).toHaveBeenCalledOnce();
    expect(handle.open).toBe(true);
    button('OK').click();
    expect(run).toHaveBeenCalledOnce();
    expect(await handle.result).toBe('ok');
    const again = dialog({ ok: { accept: () => 1 }, apply: { run }, platform: 'mac' });
    expect(buttons()).toEqual(['Cancel', 'Apply', 'OK']);
    button('OK').click();
    expect(run).toHaveBeenCalledTimes(2);
    expect(await again.result).toBe(1);
  });

  it('closes with a choice’s result, its button beside OK', async () => {
    const options = {
      ok: { label: 'This Window', accept: () => 'this' },
      choices: [{ label: 'New Window', accept: () => 'new' }],
    };
    const handle = dialog({ ...options, platform: 'other' });
    expect(buttons()).toEqual(['This Window', 'New Window', 'Cancel']);
    button('New Window').click();
    expect(await handle.result).toBe('new');
    dialog({ ...options, platform: 'mac' });
    expect(buttons()).toEqual(['Cancel', 'New Window', 'This Window']);
  });

  it('takes the button order from the browser by default', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get');
    for (const [name, order] of [
      ['MacIntel', ['Cancel', 'OK']],
      ['Win32', ['OK', 'Cancel']],
    ] as const) {
      platform.mockReturnValue(name);
      const handle = dialog({ ok: { accept: () => 1 } });
      expect(buttons()).toEqual(order);
      handle.close();
    }
    platform.mockRestore();
  });

  it('has only Close without OK, focusing itself without controls', async () => {
    const handle = dialog();
    expect(buttons()).toEqual(['Close']);
    expect(document.activeElement).toBe(element());
    key(element(), 'Enter');
    expect(handle.open).toBe(true);
    button('Close').click();
    expect(await handle.result).toBeUndefined();
  });

  it('focuses the content’s first control, and lets the content close it', async () => {
    const handle = dialog<string>({
      content: (d) => [
        <input class="first" />,
        <button
          type="button"
          class="done"
          on:click={() => {
            d.close('done');
          }}
        />,
      ],
    });
    expect(document.activeElement).toBe(element().querySelector('.first'));
    (element().querySelector('.done') as HTMLElement).click();
    expect(await handle.result).toBe('done');
  });

  it('accepts on Enter, unless on a button, in a multi-line field, or while disabled', async () => {
    const allowed = signal(false);
    const handle = dialog({
      ok: { enabled: () => allowed.get(), accept: () => 'yes' },
      content: () => [<input class="field" />, <textarea class="area" />],
    });
    const field = element().querySelector('.field') as HTMLElement;
    expect(button('OK').disabled).toBe(true);
    key(field, 'Enter');
    expect(handle.open).toBe(true);
    allowed.set(true);
    expect(button('OK').disabled).toBe(false);
    key(element().querySelector('.area') as HTMLElement, 'Enter');
    key(button('Cancel'), 'Enter');
    key(field, 'Enter', { isComposing: true });
    expect(handle.open).toBe(true);
    key(field, 'Enter');
    expect(await handle.result).toBe('yes');
  });

  it('keeps keys from the app behind it', () => {
    const app = vi.fn();
    window.addEventListener('keydown', app);
    dialog({ content: () => <input class="field" /> });
    key(element().querySelector('.field') as HTMLElement, 'k', { ctrlKey: true });
    window.removeEventListener('keydown', app);
    expect(app).not.toHaveBeenCalled();
  });

  it('cycles Tab and Shift+Tab through its controls', () => {
    dialog({
      ok: { accept: () => 1 },
      platform: 'other',
      content: () => [<input class="a" />, <input class="b" disabled />, <input class="c" />],
    });
    const a = element().querySelector('.a') as HTMLElement;
    const c = element().querySelector('.c') as HTMLElement;
    const tab = (shiftKey = false) => {
      key(document.activeElement as Element, 'Tab', { shiftKey });
      return document.activeElement;
    };
    expect(document.activeElement).toBe(a);
    expect(tab()).toBe(c);
    expect(tab()).toBe(button('OK'));
    expect(tab()).toBe(button('Cancel'));
    expect(tab()).toBe(a);
    expect(tab(true)).toBe(button('Cancel'));
    element().focus();
    expect(tab()).toBe(a);
  });

  it('keeps presses outside it from taking the focus', () => {
    dialog({ content: () => <input class="field" /> });
    const layer = document.querySelector('.cerebro-dialog-layer') as HTMLElement;
    const outside = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    layer.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    const inside = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    element().dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
  });

  it('drags by its title bar, keeping it in the window', () => {
    dialog({ width: 400 });
    const title = element().querySelector('.cerebro-dialog__title') as HTMLElement;
    const start = element().getBoundingClientRect();
    pointer('pointerdown', 100, 100, title);
    pointer('pointermove', 150, 130);
    expect(element().getBoundingClientRect().left).toBe(Math.round(start.left + 50));
    expect(element().getBoundingClientRect().top).toBe(Math.round(start.top + 30));
    pointer('pointermove', -5000, -5000);
    expect(element().getBoundingClientRect().left).toBe(40 - 400);
    expect(element().getBoundingClientRect().top).toBe(0);
    pointer('pointermove', 9000, 9000);
    expect(element().getBoundingClientRect().left).toBe(window.innerWidth - 40);
    expect(element().getBoundingClientRect().top).toBe(window.innerHeight - 40);
    pointer('pointerup', 9000, 9000);
    pointer('pointermove', 100, 100);
    expect(element().getBoundingClientRect().left).toBe(window.innerWidth - 40);
  });

  it('doesn’t drag from its close button, another mouse button, or after a cancel', () => {
    dialog();
    const title = element().querySelector('.cerebro-dialog__title') as HTMLElement;
    const close = element().querySelector('.cerebro-dialog__close') as HTMLElement;
    const start = element().getBoundingClientRect().left;
    pointer('pointerdown', 100, 100, close);
    pointer('pointermove', 200, 100);
    pointer('pointerdown', 100, 100, title, 2);
    pointer('pointermove', 200, 100);
    expect(element().getBoundingClientRect().left).toBe(start);
    pointer('pointerdown', 100, 100, title);
    pointer('pointercancel', 100, 100);
    pointer('pointermove', 200, 100);
    expect(element().getBoundingClientRect().left).toBe(start);
  });

  it('stays reachable when the window shrinks', () => {
    dialog();
    const title = element().querySelector('.cerebro-dialog__title') as HTMLElement;
    pointer('pointerdown', 0, 0, title);
    pointer('pointermove', 9000, 9000);
    pointer('pointerup', 9000, 9000);
    element().style.left = `${String(window.innerWidth + 100)}px`;
    window.dispatchEvent(new Event('resize'));
    expect(element().getBoundingClientRect().left).toBe(window.innerWidth - 40);
  });

  it('stacks: the newest is on top, and closing it returns to the one below', async () => {
    const first = dialog({ content: () => <input class="first" /> });
    const field = element().querySelector('.first') as HTMLElement;
    const second = dialog({ title: 'Second' });
    expect(document.querySelectorAll('.cerebro-dialog-layer')).toHaveLength(2);
    key(element(), 'Escape');
    expect(await second.result).toBeUndefined();
    expect(first.open).toBe(true);
    expect(document.activeElement).toBe(field);
  });
});
