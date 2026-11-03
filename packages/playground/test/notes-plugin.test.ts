import type { PluginContext, ViewContribution } from '@cerebro-ide/plugin-api';
import type { CommandSpec, Contribution } from '@cerebro-ide/commands';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { notesPlugin } from '../src/notes-plugin.js';

describe('the Notes plugin', () => {
  it('adds a tool window that keeps notes, and a command in the View menu that clears them', async () => {
    const views: ViewContribution[] = [];
    const commands: CommandSpec[] = [];
    const menus: Contribution[] = [];
    const keys: [string, string][] = [];
    const context = {
      id: 'cerebro.notes',
      registerView: (view: ViewContribution) => views.push(view),
      registerCommand: (spec: CommandSpec) => commands.push(spec),
      contributeMenu: (c: Contribution) => menus.push(c),
      bindKey: (key: string, command: string) => keys.push([key, command]),
      onDispose: () => undefined,
    } as unknown as PluginContext;
    await notesPlugin.activate(context);
    expect(views.map((v) => [v.id, v.anchor])).toEqual([['notes', 'right']]);
    expect(menus).toEqual([{ menu: 'main/view', item: { command: 'notes.clear' }, group: 'z' }]);
    expect(keys).toEqual([['Mod+Alt+Shift+K', 'notes.clear']]);
    const clear = commands[0] as CommandSpec;

    // Cleared while not shown: nothing to draw.
    clear.run(undefined);
    const container = document.body.appendChild(document.createElement('div'));
    const unmount = (views[0] as ViewContribution).mount(container) as () => void;
    const input = container.querySelector('input') as HTMLInputElement;
    const notes = () => [...container.querySelectorAll('li')].map((li) => li.textContent);
    await userEvent.type(input, '  first  {Enter}');
    await userEvent.type(input, '   {Enter}');
    await userEvent.type(input, 'second{Tab}');
    await userEvent.type(input, '{Enter}');
    expect(notes()).toEqual(['first', 'second']);
    expect(input.value).toBe('');
    clear.run(undefined);
    expect(notes()).toEqual([]);
    unmount();
    container.remove();
  });
});
