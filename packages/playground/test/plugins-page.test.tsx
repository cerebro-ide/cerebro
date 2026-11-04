import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { ToolWindows } from '@cerebro-ide/layout';
import { PluginRegistry, ViewRegistry, type Plugin } from '@cerebro-ide/plugin-api';
import { Settings, SettingsLayer, SettingsRegistry } from '@cerebro-ide/settings';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { addPlugins, disabledPlugins, loadDisabled, pluginsPage } from '../src/plugins-page.js';

const STORAGE_KEY = 'cerebro.plugins.disabled';
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  localStorage.clear();
  disabledPlugins.set(new Set());
});

function registry() {
  const settings = new SettingsRegistry();
  const values = new Settings(settings, {
    global: new SettingsLayer(settings, 'global'),
    repo: new SettingsLayer(settings, 'repo'),
    worktree: new SettingsLayer(settings, 'worktree'),
  });
  const commands = new CommandRegistry();
  return {
    commands,
    plugins: new PluginRegistry({
      commands,
      menus: new MenuRegistry(),
      keymap: new Keymap('other'),
      views: new ViewRegistry(new ToolWindows()),
      settings,
      settingsOf: () => values,
      hostOf: () => undefined,
      editors: {
        focused: () => undefined,
        format: () => undefined,
        beforeSave: () => ({ dispose: () => undefined }),
      },
    }),
  };
}

/** A plugin that adds a command named after it. */
const plugin = (id: string, description?: string): Plugin => ({
  id,
  name: id.toUpperCase(),
  ...(description === undefined ? {} : { description }),
  activate: (context) => {
    context.registerCommand({ id: `${id}.go`, label: 'Go', run: () => undefined });
  },
});

function show() {
  const page = pluginsPage();
  const handle = render(() => page.render(() => undefined), document.body);
  dispose = () => {
    handle.dispose();
  };
  return page;
}

const rows = () =>
  [...document.querySelectorAll('.playground-plugins__item')].map((item) => [
    item.querySelector('.playground-plugins__name')?.textContent,
    item.querySelector('input')?.checked,
    [...item.querySelectorAll('.playground-plugins__note')].map((n) => n.textContent).join(' | '),
  ]);

const box = (name: string) =>
  [...document.querySelectorAll('.playground-plugins__item')]
    .find((item) => item.querySelector('.playground-plugins__name')?.textContent === name)
    ?.querySelector('input') as HTMLInputElement;

describe('the plugins turned off', () => {
  it('are read from storage, or are none where it holds nothing readable', () => {
    expect(loadDisabled()).toEqual(new Set());
    localStorage.setItem(STORAGE_KEY, '{unreadable');
    expect(loadDisabled()).toEqual(new Set());
    localStorage.setItem(STORAGE_KEY, '["a"]');
    expect(loadDisabled()).toEqual(new Set(['a']));
  });
});

describe('the Plugins page', () => {
  it('lists nothing before the plugins are added', () => {
    const page = show();
    expect(rows()).toEqual([]);
    page.apply();
  });

  it('lists the plugins, all on, and turns one off and on again', async () => {
    const { commands, plugins } = registry();
    await addPlugins(plugins, [plugin('notes', 'Keeps notes.'), plugin('prettier')]);
    expect(commands.get('notes.go')).toBeDefined();
    const page = show();
    expect(rows()).toEqual([
      ['NOTES', true, 'Keeps notes.'],
      ['PRETTIER', true, ''],
    ]);
    expect(page.changed()).toBe(false);
    await userEvent.click(box('NOTES'));
    expect(page.changed()).toBe(true);
    // Not until it's applied.
    expect(commands.get('notes.go')).toBeDefined();
    page.apply();
    expect(commands.get('notes.go')).toBeUndefined();
    expect(plugins.plugins.has('notes')).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["notes"]');
    expect(page.changed()).toBe(false);
    await userEvent.click(box('NOTES'));
    page.apply();
    await expect.poll(() => commands.get('notes.go')).toBeDefined();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
  });

  it('leaves off the plugins turned off, and keeps them off where storage fails', async () => {
    disabledPlugins.set(new Set(['notes']));
    const { commands, plugins } = registry();
    await addPlugins(plugins, [plugin('notes')]);
    expect(commands.get('notes.go')).toBeUndefined();
    const page = show();
    expect(rows()).toEqual([['NOTES', false, '']]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    await userEvent.click(box('NOTES'));
    await userEvent.click(box('NOTES'));
    page.apply();
    expect(disabledPlugins.peek()).toEqual(new Set(['notes']));
    expect(commands.get('notes.go')).toBeUndefined();
  });

  it('says why one failed to start, and tries it again when applied; leaves one starting', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fails = true;
    let finish: () => void = () => undefined;
    const { commands, plugins } = registry();
    const broken: Plugin = {
      id: 'broken',
      name: 'Broken',
      activate: (context) => {
        if (fails) throw new Error('missing dependency');
        context.registerCommand({ id: 'broken.go', label: 'Go', run: () => undefined });
      },
    };
    const slow: Plugin = {
      id: 'slow',
      name: 'Slow',
      activate: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    };
    await addPlugins(plugins, [broken]);
    expect(errors).toHaveBeenCalledWith(new Error('missing dependency'));
    const adding = addPlugins(plugins, [broken, slow]);
    const page = show();
    expect(rows()).toEqual([
      ['Broken', true, 'Failed to start: missing dependency'],
      ['Slow', true, ''],
    ]);
    fails = false;
    page.apply();
    await expect.poll(() => commands.get('broken.go')).toBeDefined();
    expect(plugins.plugins.get('slow')?.state).toBe('activating');
    finish();
    await adding;
    expect(plugins.plugins.get('slow')?.state).toBe('active');
    expect(rows()[0]).toEqual(['Broken', true, '']);
  });
});
