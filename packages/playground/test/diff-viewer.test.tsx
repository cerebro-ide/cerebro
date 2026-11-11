import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-editor/styles.css';
import '../src/playground.css';
import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { diffSource } from '@cerebro-ide/ui-editor';
import { DiffViewer, setupDiffViewer } from '../src/diff-viewer.js';

/** Set up afresh, as a new session reads the toggles kept. */
function load(keymap: Keymap | null) {
  const services: MenuServices = {
    commands: new CommandRegistry(),
    menus: new MenuRegistry(),
    ...(keymap ? { keymap } : {}),
  };
  setupDiffViewer(services);
  return { services };
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  localStorage.removeItem('cerebro.diff');
  vi.restoreAllMocks();
});

// 60 lines, three changed.
const original = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
const text = original.with(10, 'one').with(30, 'two').with(50, 'three');

/** With the keymap given, a plain one, or none (null). */
function mount(keymap: Keymap | null = new Keymap('other')) {
  const loaded = load(keymap);
  const { services } = loaded;
  const box = document.createElement('div');
  box.style.height = '400px';
  box.style.width = '800px';
  document.body.append(box);
  const handle = render(
    () => (
      <DiffViewer
        services={services}
        path="a.txt"
        original={original.join('\n')}
        text={text.join('\n')}
        fontSize={() => 13}
        tabSize={() => 4}
      />
    ),
    box,
  );
  dispose = () => {
    handle.dispose();
  };
  return loaded;
}

const button = (command: string) =>
  document.querySelector(`[data-command="${command}"]`) as HTMLButtonElement;
const shadow = () =>
  (document.querySelector('.cerebro-editor-diff') as HTMLElement).shadowRoot as ShadowRoot;
const folds = () => shadow().querySelectorAll('.cm-diff-b .cm-diff-fold').length;
/** The right side's caret line, zero-based. */
const caret = () => diffSource(shadow().host)?.line;

describe('a diff’s toolbar', () => {
  it('goes to the previous and next difference, from the caret at the first to start with', async () => {
    const { services } = mount();
    expect(button('diff.previousDifference').disabled).toBe(true);
    expect(button('diff.nextDifference').disabled).toBe(false);
    await userEvent.click(button('diff.nextDifference'));
    expect(button('diff.previousDifference').disabled).toBe(false);
    await userEvent.click(button('diff.nextDifference'));
    expect(button('diff.nextDifference').disabled).toBe(true);
    // Its keys act on the diff with the keyboard: the toolbar left it with the diff.
    expect(shadow().activeElement?.closest('.cm-diff-b')).not.toBeNull();
    services.commands.execute('diff.previousDifference');
    await expect.poll(caret).toBe(30);
    // With no diff focused, they do nothing.
    (document.activeElement as HTMLElement).blur();
    expect(services.commands.isEnabled('diff.nextDifference')).toBe(false);
    services.commands.execute('diff.nextDifference');
    await expect.poll(caret).toBe(30);
  });

  it('collapses unchanged fragments to start with, as IntelliJ’s from the Commit window, and keeps the choice', async () => {
    mount();
    await expect.poll(folds).toBeGreaterThan(0);
    expect(button('diff.collapseUnchanged').getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(button('diff.collapseUnchanged'));
    await expect.poll(folds).toBe(0);
    expect(JSON.parse(localStorage.getItem('cerebro.diff') as string)).toEqual({
      viewer: 'sideBySide',
      collapse: false,
      syncScroll: true,
      align: false,
      ignore: 'none',
      highlight: 'words',
      whitespace: false,
      lineNumbers: true,
      indentGuides: false,
      softWrap: false,
    });
    // A new session takes it.
    dispose?.();
    document.body.replaceChildren();
    mount();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(folds()).toBe(0);
  });

  it('aligns changes if turned on, and synchronizes scrolling unless turned off, in its Settings', async () => {
    const { services } = mount();
    const settings = document.querySelector('[data-menu="diff/settings"]') as HTMLElement;
    await userEvent.click(settings);
    // First, as IntelliJ's gear: Align Changes Highlighting, off, then Synchronize Scrolling, on.
    const items = () => [...document.querySelectorAll('[role="menuitemcheckbox"]')].slice(0, 2);
    expect(items().map((item) => item.textContent)).toEqual([
      expect.stringContaining('Align Changes Highlighting') as unknown,
      expect.stringContaining('Synchronize Scrolling') as unknown,
    ]);
    expect(items().map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    await userEvent.click(items()[1] as Element);
    expect(services.commands.isChecked('diff.syncScroll')).toBe(false);
    services.commands.execute('diff.alignChanges');
    expect(services.commands.isChecked('diff.alignChanges')).toBe(true);
    expect(JSON.parse(localStorage.getItem('cerebro.diff') as string)).toMatchObject({
      syncScroll: false,
      align: true,
    });
    // A new session takes it.
    dispose?.();
    document.body.replaceChildren();
    expect(mount().services.commands.isChecked('diff.alignChanges')).toBe(true);
  });

  it('ignores and highlights differences as chosen in its Settings, and keeps the choice', async () => {
    const { services } = mount();
    await userEvent.click(document.querySelector('[data-menu="diff/settings"]') as Element);
    const menu = () => document.querySelector('.cerebro-menu')?.textContent;
    expect(menu()).toContain('Ignore Differences');
    expect(menu()).toContain('Highlighting Differences');
    const item = (label: string) =>
      [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((i) =>
        i.textContent.includes(label),
      ) as Element;
    expect(item('Words').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(item('Ignore whitespaces and empty lines'));
    expect(services.commands.isChecked('diff.ignore.whitespacesAndEmptyLines')).toBe(true);
    expect(services.commands.isChecked('diff.ignore.none')).toBe(false);
    services.commands.execute('diff.highlight.none');
    // Nothing highlighted: no changes to go to.
    await expect.poll(() => button('diff.nextDifference').disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('cerebro.diff') as string)).toMatchObject({
      ignore: 'whitespacesAndEmptyLines',
      highlight: 'none',
    });
    // A new session takes it; one kept that's not known isn't.
    dispose?.();
    document.body.replaceChildren();
    expect(mount().services.commands.isChecked('diff.highlight.none')).toBe(true);
    localStorage.setItem('cerebro.diff', JSON.stringify({ ignore: 'formatting' }));
    expect(load(null).services.commands.isChecked('diff.ignore.none')).toBe(true);
  });

  it('shows whitespace, line numbers, indent guides and soft wraps as chosen in its Settings, and keeps them', async () => {
    const { services } = mount();
    await userEvent.click(document.querySelector('[data-menu="diff/settings"]') as Element);
    const menu = document.querySelector('.cerebro-menu')?.textContent ?? '';
    // Last, under its heading, as IntelliJ's; line numbers alone on, to start with.
    expect(menu.indexOf('Appearance')).toBeGreaterThan(menu.indexOf('Highlighting Differences'));
    const checked = (id: string) => services.commands.isChecked(id);
    expect(
      ['diff.whitespace', 'diff.lineNumbers', 'diff.indentGuides', 'diff.softWrap'].map(checked),
    ).toEqual([false, true, false, false]);
    const item = (label: string) =>
      [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((i) =>
        i.textContent.includes(label),
      ) as Element;
    await userEvent.click(item('Show Line Numbers'));
    await expect.poll(() => shadow().querySelectorAll('.cm-lineNumbers').length).toBe(0);
    for (const id of ['diff.whitespace', 'diff.indentGuides', 'diff.softWrap']) {
      services.commands.execute(id);
    }
    await expect.poll(() => shadow().querySelectorAll('.cm-lineWrapping').length).toBe(2);
    expect(shadow().querySelectorAll('.cm-highlightSpace').length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem('cerebro.diff') as string)).toMatchObject({
      whitespace: true,
      lineNumbers: false,
      indentGuides: true,
      softWrap: true,
    });
    // A new session takes them.
    dispose?.();
    document.body.replaceChildren();
    expect(mount().services.commands.isChecked('diff.lineNumbers')).toBe(false);
  });

  it('shows the diff unified or side by side, as chosen, and keeps the choice', async () => {
    const { services } = mount();
    const pressed = (command: string) => button(command).getAttribute('aria-pressed');
    expect([pressed('diff.sideBySide'), pressed('diff.unified')]).toEqual(['true', 'false']);
    await userEvent.click(button('diff.unified'));
    await expect.poll(() => shadow().querySelector('.cm-diff-unified')).not.toBeNull();
    expect(shadow().querySelector('.cm-diff-b')).toBeNull();
    // Its toolbar acts on it: the arrows, from the caret at its first change.
    expect(button('diff.previousDifference').disabled).toBe(true);
    await userEvent.click(button('diff.nextDifference'));
    expect(caret()).toBe(30);
    // And its keys, with the keyboard in it.
    services.commands.execute('diff.nextDifference');
    await expect.poll(caret).toBe(50);
    await userEvent.click(document.querySelector('[data-menu="diff/settings"]') as Element);
    // Nor Align Changes Highlighting, nor Synchronize Scrolling: one editor.
    expect(document.querySelector('.cerebro-menu')?.textContent).not.toMatch(/Synchronize|Align/);
    await userEvent.keyboard('{Escape}');
    expect(JSON.parse(localStorage.getItem('cerebro.diff') as string)).toMatchObject({
      viewer: 'unified',
    });
    // A new session takes it; back to side by side.
    dispose?.();
    document.body.replaceChildren();
    mount();
    expect(shadow().querySelector('.cm-diff-unified')).not.toBeNull();
    await userEvent.click(button('diff.sideBySide'));
    await expect.poll(() => shadow().querySelector('.cm-diff-b')).not.toBeNull();
  });

  it('starts as before when the toggles can’t be read or kept', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { services } = mount();
    expect(services.commands.isChecked('diff.collapseUnchanged')).toBe(true);
    expect(services.commands.isChecked('diff.syncScroll')).toBe(true);
    services.commands.execute('diff.collapseUnchanged');
    expect(services.commands.isChecked('diff.collapseUnchanged')).toBe(false);
  });

  it('shows each button’s shortcut in its tooltip, from the keymap, and names the gear', async () => {
    const keymap = new Keymap('other');
    keymap.bindDefault('F7', 'diff.nextDifference');
    mount(keymap);
    const tip = () => document.querySelector('.cerebro-tooltip')?.textContent;
    await userEvent.hover(button('diff.nextDifference'));
    await expect.poll(tip).toBe('Next DifferenceF7');
    await userEvent.hover(button('diff.previousDifference'));
    await expect.poll(tip).toBe('Previous Difference');
    await userEvent.hover(document.querySelector('[data-menu="diff/settings"]') as Element);
    await expect.poll(tip).toBe('Settings');
  });

  it('shows no shortcuts with no keymap', async () => {
    mount(null);
    await userEvent.hover(button('diff.nextDifference'));
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe('Next Difference');
  });
});
