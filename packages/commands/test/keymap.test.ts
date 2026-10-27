import { effect } from '@cerebro-ide/reactive';
import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry, KeyDispatcher, Keymap, SEQUENCE_TIMEOUT } from '../src/index.js';

function setup() {
  const keymap = new Keymap('other');
  const commands = new CommandRegistry();
  const ran: string[] = [];
  for (const id of ['save', 'saveAll', 'settings', 'menu', 'off']) {
    commands.register({ id, label: id, run: () => ran.push(id), enabled: () => id !== 'off' });
  }
  keymap.bindDefault('mod+s', 'save');
  keymap.bindDefault('ctrl+shift+s', 'saveAll');
  keymap.bindDefault('ctrl+k ctrl+s', 'settings');
  keymap.bindDefault('alt+f', 'off');
  keymap.bindDefault('alt+f', 'menu');
  return { keymap, commands, ran, dispatcher: new KeyDispatcher(keymap, commands) };
}

describe('Keymap', () => {
  it('stores defaults normalized, and finds them', () => {
    const { keymap } = setup();
    expect(keymap.commandsFor('Ctrl+S')).toEqual(['save']);
    expect(keymap.shortcutsFor('settings')).toEqual(['Ctrl+K Ctrl+S']);
    expect(keymap.isPrefix('Ctrl+K')).toBe(true);
    expect(keymap.isPrefix('Ctrl+S')).toBe(false);
  });

  it('puts the user’s bindings first, and lets them remove defaults', () => {
    const { keymap } = setup();
    keymap.setUser([
      { key: 'ctrl+alt+s', command: 'save' },
      { key: 'ctrl+s', command: 'save', remove: true },
    ]);
    expect(keymap.shortcutsFor('save')).toEqual(['Ctrl+Alt+S']);
    expect(keymap.commandsFor('Ctrl+S')).toEqual([]);
    expect(keymap.bindings[0]).toEqual({ key: 'Ctrl+Alt+S', command: 'save' });
  });

  it('takes a preset’s keys, and its parent’s, for the commands they name', () => {
    const { keymap } = setup();
    const parent = { id: 'p', name: 'Parent', bindings: { save: ['ctrl+w'], menu: ['F10'] } };
    keymap.setPreset({ id: 'c', name: 'Child', bindings: { save: ['F2', 'ctrl+k s'] }, parent });
    expect(keymap.shortcutsFor('save')).toEqual(['F2', 'Ctrl+K S']);
    expect(keymap.shortcutsFor('menu')).toEqual(['F10']);
    // Not named: the default.
    expect(keymap.shortcutsFor('saveAll')).toEqual(['Ctrl+Shift+S']);
    keymap.setUser([
      { key: 'F2', command: 'save', remove: true },
      { key: 'F3', command: 'save' },
    ]);
    expect(keymap.shortcutsFor('save')).toEqual(['F3', 'Ctrl+K S']);
    keymap.setPreset(undefined);
    expect(keymap.shortcutsFor('save')).toEqual(['F3', 'Ctrl+S']);
  });

  it('removes a default on dispose, and is reactive', () => {
    const keymap = new Keymap('mac');
    const seen: string[][] = [];
    effect(() => {
      seen.push(keymap.shortcutsFor('save'));
      return undefined;
    });
    const handle = keymap.bindDefault('Mod+S', 'save');
    handle.dispose();
    handle.dispose();
    expect(seen).toEqual([[], ['Meta+S'], []]);
  });
});

describe('KeyDispatcher', () => {
  it('runs the command bound to a chord', () => {
    const { dispatcher, ran } = setup();
    expect(dispatcher.press('Ctrl+S')).toBe('handled');
    expect(dispatcher.press('Ctrl+Q')).toBe('unhandled');
    expect(ran).toEqual(['save']);
  });

  it('runs the first enabled command bound to a chord', () => {
    const { dispatcher, ran } = setup();
    expect(dispatcher.press('Alt+F')).toBe('handled');
    expect(ran).toEqual(['menu']);
  });

  it('waits for the rest of a sequence', () => {
    const { dispatcher, ran } = setup();
    expect(dispatcher.press('Ctrl+K')).toBe('pending');
    expect(dispatcher.waiting).toBe(true);
    expect(dispatcher.press('Ctrl+S')).toBe('handled');
    expect(dispatcher.waiting).toBe(false);
    expect(ran).toEqual(['settings']);
  });

  it('swallows a chord that breaks a started sequence', () => {
    const { dispatcher, ran } = setup();
    dispatcher.press('Ctrl+K');
    expect(dispatcher.press('Ctrl+Shift+S')).toBe('handled');
    expect(ran).toEqual([]);
  });

  it('can abandon a started sequence', () => {
    const { dispatcher, ran } = setup();
    dispatcher.press('Ctrl+K');
    dispatcher.cancel();
    expect(dispatcher.press('Ctrl+S')).toBe('handled');
    expect(ran).toEqual(['save']);
  });

  it('runs a chord also bound alone when the sequence breaks or times out', () => {
    vi.useFakeTimers();
    const { keymap, dispatcher, ran } = setup();
    keymap.bindDefault('ctrl+k', 'menu');
    expect(dispatcher.press('Ctrl+K', 'first')).toBe('pending');
    expect(dispatcher.press('Ctrl+S')).toBe('handled');
    expect(ran).toEqual(['settings']);
    dispatcher.press('Ctrl+K');
    expect(dispatcher.press('A')).toBe('handled');
    expect(ran).toEqual(['settings', 'menu']);
    dispatcher.press('Ctrl+K');
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT);
    expect(ran).toEqual(['settings', 'menu', 'menu']);
    expect(dispatcher.waiting).toBe(false);
    vi.useRealTimers();
  });

  it('abandons a started sequence after the timeout, so later keys pass', () => {
    vi.useFakeTimers();
    const { dispatcher, ran } = setup();
    dispatcher.press('Ctrl+K');
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT - 1);
    expect(dispatcher.waiting).toBe(true);
    vi.advanceTimersByTime(1);
    expect(dispatcher.waiting).toBe(false);
    expect(dispatcher.press('A')).toBe('unhandled');
    expect(ran).toEqual([]);
    vi.useRealTimers();
  });

  it('takes the timeout it’s given, and cancelling stops the timer', () => {
    vi.useFakeTimers();
    const { keymap, commands, ran } = setup();
    keymap.bindDefault('ctrl+k', 'menu');
    const quick = new KeyDispatcher(keymap, commands, 100);
    quick.press('Ctrl+K');
    vi.advanceTimersByTime(100);
    expect(ran).toEqual(['menu']);
    quick.press('Ctrl+K');
    quick.cancel();
    vi.advanceTimersByTime(1000);
    expect(ran).toEqual(['menu']);
    vi.useRealTimers();
  });

  it('doesn’t wait for a sequence whose commands are disabled', () => {
    const { keymap, dispatcher, ran } = setup();
    keymap.bindDefault('ctrl+j ctrl+j', 'off');
    expect(dispatcher.press('Ctrl+J')).toBe('unhandled');
    expect(dispatcher.waiting).toBe(false);
    expect(dispatcher.press('Ctrl+S')).toBe('handled');
    expect(ran).toEqual(['save']);
  });

  it('passes the context to the command', () => {
    const keymap = new Keymap('other');
    const commands = new CommandRegistry();
    const run = vi.fn();
    commands.register({ id: 'a', label: 'A', run });
    keymap.bindDefault('F2', 'a');
    new KeyDispatcher(keymap, commands).press('F2', 'ctx');
    expect(run).toHaveBeenCalledWith('ctx');
  });
});
