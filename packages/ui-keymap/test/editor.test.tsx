import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-dialog/styles.css';
import '../src/styles.css';
import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { KeymapDraft, KeymapEditor, keymapRows, type KeymapEditorProps } from '../src/index.js';

let dispose: (() => void) | undefined;

afterEach(() => {
  for (const dialog of document.querySelectorAll('.cerebro-dialog')) {
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  dispose?.();
  document.body.replaceChildren();
});

function setup(): KeymapEditorProps {
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const keymap = new Keymap('other');
  for (const [id, label, dialog] of [
    ['file.open', '&Open', true],
    ['file.save', '&Save All', false],
    ['file.recent', 'Clear Recent', false],
    ['edit.undo', '&Undo', false],
    ['tab.pin', 'Pin Tab', false],
    ['a.hidden', 'Activate', false],
  ] as const) {
    commands.register({ id, label, dialog, run: () => undefined });
  }
  menus.contribute({ menu: 'main', item: { submenu: 'main/file', label: '&File' } });
  menus.contribute({ menu: 'main', item: { submenu: 'main/edit', label: '&Edit' } });
  menus.contribute({ menu: 'main', item: { submenu: 'main/empty', label: 'Empty' } });
  menus.contribute({ menu: 'main/file', item: { command: 'file.open' } });
  menus.contribute({ menu: 'main/file', item: { heading: 'Recent' }, group: 'b' });
  menus.contribute({ menu: 'main/file', item: { submenu: 'main/file/recent', label: 'Recent' } });
  menus.contribute({ menu: 'main/file/recent', item: { command: 'file.recent' } });
  menus.contribute({ menu: 'main/file', item: { command: 'file.save' }, group: 'b' });
  // Unknown, and shown once only.
  menus.contribute({ menu: 'main/file', item: { command: 'file.missing' } });
  menus.contribute({ menu: 'main/edit', item: { command: 'edit.undo' } });
  menus.contribute({ menu: 'main/edit', item: { command: 'file.open' } });
  keymap.bindDefault('ctrl+o', 'file.open');
  keymap.bindDefault('ctrl+s', 'file.save');
  keymap.bindDefault('ctrl+z', 'edit.undo');
  keymap.bindDefault('ctrl+k ctrl+p', 'tab.pin');
  // A plugin's command, not registered now: named by its id.
  keymap.bindDefault('F7', 'plugin.gone');
  const draft = new KeymapDraft([], (u) => keymap.bindingsWith(u, undefined), 'other');
  return { draft, commands, menus, platform: 'other' };
}

const rowsText = (props: KeymapEditorProps, query?: string) =>
  keymapRows(props, query).map((r) =>
    'group' in r ? `${String(r.depth)} [${r.group}]` : `${String(r.depth)} ${r.label}`,
  );

function mount(props = setup()) {
  const handle = render(() => <KeymapEditor {...props} />, document.body);
  dispose = () => {
    handle.dispose();
  };
  return props;
}

const q = (selector: string) => document.querySelector(selector) as HTMLElement;
const row = (id: string) => q(`[data-command="${id}"]`);
const keys = (id: string) => q(`[data-command="${id}"] .cerebro-keymap__keys`).textContent;
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;
const actions = () =>
  [...document.querySelectorAll('.cerebro-keymap__action')].map((b) => b.textContent);
const dialogTitle = () =>
  [...document.querySelectorAll('.cerebro-dialog__title span')].map((t) => t.textContent);

describe('keymapRows', () => {
  it('lists the commands under the main menu’s menus, then Other', () => {
    expect(rowsText(setup())).toEqual([
      '0 [Main Menu]',
      '1 [File]',
      '2 Open…',
      '2 [Recent]',
      '3 Clear Recent',
      '2 Save All',
      '1 [Edit]',
      '2 Undo',
      '0 [Other]',
      '1 Activate',
      '1 Pin Tab',
    ]);
  });

  it('keeps the commands whose name or shortcut matches', () => {
    const props = setup();
    expect(rowsText(props, 'UNDO')).toEqual(['0 [Main Menu]', '1 [Edit]', '2 Undo']);
    expect(rowsText(props, 'ctrl+k')).toEqual(['0 [Other]', '1 Pin Tab']);
    expect(rowsText(props, 'nothing')).toEqual([]);
  });
});

describe('KeymapEditor', () => {
  it('shows each command’s shortcuts, filtered by the search', async () => {
    mount();
    expect(keys('file.open')).toBe('Ctrl+O');
    expect(keys('tab.pin')).toBe('Ctrl+K, Ctrl+P');
    expect(q('.cerebro-keymap__hint').textContent).toContain('Select an action');
    await userEvent.type(q('.cerebro-keymap__search'), 'zzz');
    expect(q('.cerebro-keymap__empty').textContent).toBe('Nothing to show');
  });

  it('removes a shortcut and resets, marking the command changed', async () => {
    const { draft } = mount();
    await userEvent.click(row('file.save'));
    expect(row('file.save').getAttribute('aria-selected')).toBe('true');
    expect(actions()).toEqual(['Add Keyboard Shortcut…', 'Remove Ctrl+S', 'Reset Shortcuts']);
    expect(button('Reset Shortcuts').disabled).toBe(true);
    await userEvent.click(button('Remove Ctrl+S'));
    expect(keys('file.save')).toBe('');
    expect(row('file.save').classList.contains('cerebro-keymap__row--modified')).toBe(true);
    expect(draft.user).toEqual([{ key: 'Ctrl+S', command: 'file.save', remove: true }]);
    await userEvent.click(button('Reset Shortcuts'));
    expect(keys('file.save')).toBe('Ctrl+S');
    expect(row('file.save').classList.contains('cerebro-keymap__row--modified')).toBe(false);
  });

  it('moves the selection with the arrows, and Enter adds a shortcut', async () => {
    mount();
    const list = q('.cerebro-keymap__list');
    list.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(row('file.open').getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(row('file.save').getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{a}');
    await userEvent.keyboard('{Enter}');
    expect(dialogTitle()).toEqual(['Keyboard Shortcut']);
    await userEvent.keyboard('{Control>}{Alt>}s{/Alt}{/Control}');
    expect((q('[aria-label="First stroke"]') as HTMLInputElement).value).toBe('Ctrl+Alt+S');
    // Enter, with a stroke, is OK's.
    await userEvent.keyboard('{Enter}');
    expect(keys('file.save')).toBe('Ctrl+Alt+S, Ctrl+S');
  });

  it('adds a shortcut of two strokes, by double click', async () => {
    mount();
    await userEvent.dblClick(row('edit.undo'));
    expect(dialogTitle()).toEqual(['Keyboard Shortcut']);
    const ok = button('OK');
    expect(ok.disabled).toBe(true);
    // Tab moves on; a modifier alone isn't a stroke.
    await userEvent.keyboard('{Shift}');
    expect((q('[aria-label="First stroke"]') as HTMLInputElement).value).toBe('');
    await userEvent.keyboard('{Control>}m{/Control}');
    expect((q('[aria-label="Second stroke"]') as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(q('.cerebro-shortcut__enable input'));
    expect(document.activeElement).toBe(q('[aria-label="Second stroke"]'));
    await userEvent.keyboard('{Enter}');
    expect((q('[aria-label="Second stroke"]') as HTMLInputElement).value).toBe('Enter');
    // Unchecked and checked again, it keeps its stroke.
    await userEvent.click(q('.cerebro-shortcut__enable input'));
    await userEvent.click(q('.cerebro-shortcut__enable input'));
    await userEvent.click(ok);
    expect(keys('edit.undo')).toBe('Ctrl+M, Enter, Ctrl+Z');
  });

  it('lists conflicts, and asks whether to remove them: Remove, Keep or Cancel', async () => {
    mount();
    const add = async (id: string, chord: string) => {
      await userEvent.click(row(id));
      await userEvent.click(button('Add Keyboard Shortcut…'));
      await userEvent.keyboard(chord);
    };
    await add('file.open', '{Control>}k{/Control}');
    expect(q('.cerebro-shortcut__conflicts').textContent).toBe('Already assigned to:Pin Tab');
    await userEvent.click(button('OK'));
    expect(dialogTitle()).toEqual(['Warning']);
    await userEvent.click(button('Cancel'));
    expect(keys('file.open')).toBe('Ctrl+O');
    await add('file.open', '{Control>}k{/Control}');
    await userEvent.click(button('OK'));
    await userEvent.click(button('Keep'));
    expect(keys('file.open')).toBe('Ctrl+K, Ctrl+O');
    expect(keys('tab.pin')).toBe('Ctrl+K, Ctrl+P');
    await add('file.recent', '{F7}');
    expect(q('.cerebro-shortcut__conflicts').textContent).toBe('Already assigned to:plugin.gone');
    await userEvent.keyboard('{Escape}');
    await add('file.recent', '{Control>}s{/Control}');
    await userEvent.click(button('OK'));
    await userEvent.click(button('Remove'));
    expect(keys('file.recent')).toBe('Ctrl+S');
    expect(keys('file.save')).toBe('');
  });

  it('cancels the dialog with Escape, which a stroke with modifiers records', async () => {
    mount();
    await userEvent.dblClick(row('file.save'));
    await userEvent.keyboard('{Shift>}{Escape}{/Shift}');
    expect((q('[aria-label="First stroke"]') as HTMLInputElement).value).toBe('Shift+Esc');
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement?.tagName).toBe('INPUT');
    await userEvent.keyboard('{Escape}');
    expect(dialogTitle()).toEqual([]);
    expect(keys('file.save')).toBe('Ctrl+S');
  });
});
