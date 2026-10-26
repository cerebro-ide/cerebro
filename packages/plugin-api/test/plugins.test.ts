import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { ToolWindows } from '@cerebro-ide/layout';
import { describe, expect, it, vi } from 'vitest';
import { PluginRegistry, ViewRegistry, type Plugin, type ViewContribution } from '../src/index.js';

function setup() {
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const keymap = new Keymap('other');
  const toolWindows = new ToolWindows();
  const views = new ViewRegistry(toolWindows);
  const plugins = new PluginRegistry({ commands, menus, keymap, views });
  return { commands, menus, keymap, toolWindows, views, plugins };
}

const view = (id: string): ViewContribution => ({
  id,
  title: id,
  anchor: 'right',
  mount: (container) => {
    container.textContent = id;
    return undefined;
  },
});

/** A plugin that adds one of everything. */
const notes: Plugin = {
  id: 'cerebro.notes',
  name: 'Notes',
  activate(context) {
    context.registerCommand({ id: 'notes.clear', label: 'Clear Notes', run: () => undefined });
    context.contributeMenu({ menu: 'main/view', item: { command: 'notes.clear' } });
    context.bindKey('Ctrl+Alt+N', 'notes.clear');
    context.registerView(view('notes'));
  },
};

describe('ViewRegistry', () => {
  it('adds a view with its tool window, and removes both', () => {
    const { views, toolWindows } = setup();
    const added = views.register(view('notes'));
    expect(views.get('notes')?.title).toBe('notes');
    expect(toolWindows.windows.get('notes')?.anchor).toBe('right');
    added.dispose();
    added.dispose();
    expect(views.get('notes')).toBeUndefined();
    expect(toolWindows.windows.has('notes')).toBe(false);
  });

  it('refuses a view whose tool window exists', () => {
    const { views, toolWindows } = setup();
    toolWindows.register({ id: 'notes', title: 'Notes', anchor: 'left' });
    expect(() => views.register(view('notes'))).toThrow(/already registered/);
  });
});

describe('PluginRegistry', () => {
  it('activates a plugin, which contributes commands, menus, shortcuts and views', async () => {
    const { plugins, commands, menus, keymap, views } = setup();
    await plugins.add(notes);
    expect(plugins.plugins.get('cerebro.notes')?.state).toBe('active');
    expect(commands.get('notes.clear')?.label).toBe('Clear Notes');
    expect(menus.entries('main/view')).toEqual([{ command: 'notes.clear' }]);
    expect(keymap.shortcutsFor('notes.clear')).toEqual(['Ctrl+Alt+N']);
    expect(views.get('notes')).toBeDefined();
  });

  it('removes everything a plugin added when it’s removed', async () => {
    const { plugins, commands, menus, keymap, views } = setup();
    const cleanup = vi.fn();
    await plugins.add({
      ...notes,
      activate(context) {
        void notes.activate(context);
        context.onDispose(cleanup);
      },
    });
    plugins.remove('cerebro.notes');
    expect(plugins.plugins.has('cerebro.notes')).toBe(false);
    expect(commands.get('notes.clear')).toBeUndefined();
    expect(menus.entries('main/view')).toEqual([]);
    expect(keymap.shortcutsFor('notes.clear')).toEqual([]);
    expect(views.get('notes')).toBeUndefined();
    expect(cleanup).toHaveBeenCalledOnce();
    // Removing again, or something never added, does nothing.
    plugins.remove('cerebro.notes');
    plugins.remove('unknown');
  });

  it('waits for an async activation', async () => {
    const { plugins, commands } = setup();
    let finish: () => void = () => undefined;
    const adding = plugins.add({
      id: 'slow',
      name: 'Slow',
      activate: async (context) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        context.registerCommand({ id: 'slow.go', label: 'Go', run: () => undefined });
      },
    });
    expect(plugins.plugins.get('slow')?.state).toBe('activating');
    finish();
    await adding;
    expect(plugins.plugins.get('slow')?.state).toBe('active');
    expect(commands.get('slow.go')).toBeDefined();
  });

  it('undoes what a failing plugin added, and records why it failed', async () => {
    const { plugins, commands } = setup();
    await expect(
      plugins.add({
        id: 'broken',
        name: 'Broken',
        activate(context) {
          context.registerCommand({ id: 'broken.half', label: 'Half', run: () => undefined });
          throw new Error('missing dependency');
        },
      }),
    ).rejects.toThrow('missing dependency');
    expect(commands.get('broken.half')).toBeUndefined();
    const entry = plugins.plugins.get('broken');
    expect(entry?.state).toBe('failed');
    expect(entry?.error).toBe('missing dependency');
    await expect(
      plugins.add({
        id: 'odd',
        name: 'Odd',
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- what a careless plugin does
        activate: () => Promise.reject('a string'),
      }),
    ).rejects.toBe('a string');
    expect(plugins.plugins.get('odd')?.error).toBe('a string');
  });

  it('refuses a plugin added twice', async () => {
    const { plugins } = setup();
    await plugins.add(notes);
    await expect(plugins.add(notes)).rejects.toThrow(/already added/);
  });
});
