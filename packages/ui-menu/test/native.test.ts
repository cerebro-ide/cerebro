import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import { describe, expect, it } from 'vitest';
import { nativeMenu, syncNativeMenu, toAccelerator, type NativeMenuItem } from '../src/index.js';

function setup() {
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const keymap = new Keymap('mac');
  const ran: [string, unknown][] = [];
  const saved = signal(false);
  commands.register({
    id: 'open',
    label: '&Open',
    dialog: true,
    run: (c) => ran.push(['open', c]),
  });
  commands.register({
    id: 'save',
    label: '&Save',
    enabled: () => !saved.get(),
    run: (c) => ran.push(['save', c]),
  });
  commands.register({
    id: 'wrap',
    label: 'Soft-&Wrap',
    checked: (c) => c === 'wrapped',
    run: () => undefined,
  });
  commands.register({ id: 'chord', label: 'Chord', run: () => undefined });
  menus.contribute({ menu: 'main', item: { submenu: 'file', label: '&File' } });
  menus.contribute({ menu: 'main', item: { submenu: 'empty', label: '&Empty' } });
  menus.contribute({ menu: 'file', item: { command: 'open' }, group: 'a' });
  menus.contribute({ menu: 'file', item: { command: 'save' }, group: 'a' });
  menus.contribute({ menu: 'file', item: { command: 'wrap' }, group: 'b' });
  menus.contribute({ menu: 'file', item: { command: 'chord' }, group: 'b' });
  menus.contribute({ menu: 'file', item: { command: 'missing' }, group: 'b' });
  keymap.bindDefault('Mod+O', 'open');
  keymap.bindDefault('Mod+K Mod+C', 'chord');
  return { services: { commands, menus, keymap }, ran, saved };
}

function fakeBridge() {
  const sent: NativeMenuItem[][] = [];
  let listener: ((command: string) => void) | undefined;
  return {
    sent,
    choose: (command: string) => listener?.(command),
    listening: () => listener !== undefined,
    bridge: {
      set: (items: NativeMenuItem[]) => sent.push(items),
      onCommand: (l: (command: string) => void) => {
        listener = l;
        return () => {
          listener = undefined;
        };
      },
    },
  };
}

describe('toAccelerator', () => {
  it('names modifiers and keys as Electron does', () => {
    expect(toAccelerator('Ctrl+Alt+Shift+Meta+K')).toBe('Ctrl+Alt+Shift+Command+K');
    expect(toAccelerator('Meta+1')).toBe('Command+1');
    expect(toAccelerator('F12')).toBe('F12');
    expect(toAccelerator('Meta+Enter')).toBe('Command+Return');
    expect(toAccelerator('Alt+ArrowUp')).toBe('Alt+Up');
    expect(toAccelerator('Meta++')).toBe('Command+Plus');
    expect(toAccelerator('Meta+,')).toBe('Command+,');
    expect(toAccelerator('Shift+Escape')).toBe('Shift+Escape');
  });

  it('gives none for several chords, or keys it can’t name', () => {
    expect(toAccelerator('Meta+K Meta+C')).toBeUndefined();
    expect(toAccelerator('Meta+ContextMenu')).toBeUndefined();
  });
});

describe('nativeMenu', () => {
  it('turns the menus into a tree, as the menu bar shows them', () => {
    const { services } = setup();
    expect(nativeMenu(services, 'main')).toEqual([
      {
        label: 'File',
        submenu: [
          { label: 'Open…', command: 'open', enabled: true, accelerator: 'Command+O' },
          { label: 'Save', command: 'save', enabled: true },
          { separator: true },
          { label: 'Soft-Wrap', command: 'wrap', enabled: true, checked: false },
          { label: 'Chord', command: 'chord', enabled: true },
        ],
      },
    ]);
  });

  it('shows commands’ states for a context, and no shortcuts without a keymap', () => {
    const { services } = setup();
    const file = nativeMenu(
      { commands: services.commands, menus: services.menus },
      'file',
      'wrapped',
    );
    expect(file[0]).toEqual({ label: 'Open…', command: 'open', enabled: true });
    expect(file[3]).toEqual(expect.objectContaining({ checked: true }));
  });
});

describe('syncNativeMenu', () => {
  it('sends the menu, again when it changes, and stops on dispose', () => {
    const { services, saved } = setup();
    const { bridge, sent, listening } = fakeBridge();
    const sync = syncNativeMenu(services, bridge, { menu: 'file' });
    expect(sent).toHaveLength(1);
    saved.set(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.[1]).toEqual(expect.objectContaining({ command: 'save', enabled: false }));
    sync.dispose();
    saved.set(false);
    expect(sent).toHaveLength(2);
    expect(listening()).toBe(false);
  });

  it('runs chosen commands with the context, from the main menu by default', () => {
    const { services, ran } = setup();
    const { bridge, sent, choose } = fakeBridge();
    const sync = syncNativeMenu(services, bridge, { context: () => 'ctx' });
    expect(sent[0]?.[0]?.label).toBe('File');
    choose('open');
    expect(ran).toEqual([['open', 'ctx']]);
    sync.dispose();
    const plain = fakeBridge();
    syncNativeMenu(services, plain.bridge).dispose();
  });

  it('runs without a context', () => {
    const { services, ran } = setup();
    const { bridge, choose } = fakeBridge();
    const sync = syncNativeMenu(services, bridge);
    choose('save');
    expect(ran).toEqual([['save', undefined]]);
    sync.dispose();
  });
});
