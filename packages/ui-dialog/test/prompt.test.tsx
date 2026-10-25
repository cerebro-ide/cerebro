import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { afterEach, describe, expect, it } from 'vitest';
import { prompt } from '../src/index.js';

afterEach(() => {
  // Cancels whatever a test left open.
  for (const dialog of document.querySelectorAll('.cerebro-dialog')) {
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
});

const input = () => document.querySelector('.cerebro-dialog-field__input') as HTMLInputElement;
const ok = () => document.querySelector('.cerebro-dialog__button--primary') as HTMLButtonElement;
const error = () => document.querySelector('.cerebro-dialog-field__error')?.textContent;

function type(text: string) {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('prompt', () => {
  it('asks for a line of text, giving it trimmed', async () => {
    const result = prompt({ title: 'New Branch', label: 'Name:', ok: 'Create', platform: 'other' });
    expect(document.querySelector('.cerebro-dialog__title')?.textContent).toBe('New Branch');
    expect(document.querySelector('.cerebro-dialog-field__label')?.textContent).toBe('Name:');
    expect(ok().textContent).toBe('Create');
    expect(document.activeElement).toBe(input());
    expect(ok().disabled).toBe(true);
    type('  feat/x  ');
    expect(ok().disabled).toBe(false);
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(await result).toBe('feat/x');
  });

  it('starts with a value, selected', async () => {
    const result = prompt({ title: 'Rename', label: 'Name:', value: 'main.ts' });
    await tick();
    expect(input().value).toBe('main.ts');
    expect([input().selectionStart, input().selectionEnd]).toEqual([0, 7]);
    expect(ok().textContent).toBe('OK');
    ok().click();
    expect(await result).toBe('main.ts');
  });

  it('says why the text can’t be accepted, while it can’t', async () => {
    const result = prompt({
      title: 'New Branch',
      label: 'Name:',
      validate: (text) => (text === 'main' ? 'Branch main exists' : undefined),
    });
    type('main');
    expect(error()).toBe('Branch main exists');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().classList.contains('cerebro-dialog-field__input--invalid')).toBe(true);
    expect(ok().disabled).toBe(true);
    type('main2');
    expect(error()).toBe('');
    expect(ok().disabled).toBe(false);
    (document.querySelector('.cerebro-dialog') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(await result).toBeUndefined();
  });
});
