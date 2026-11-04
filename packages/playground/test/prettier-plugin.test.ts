import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { ToolWindows } from '@cerebro-ide/layout';
import {
  PluginRegistry,
  ViewRegistry,
  type BeforeSave,
  type Editors,
  type Formatter,
  type FormatWords,
  type Host,
} from '@cerebro-ide/plugin-api';
import { Settings, SettingsLayer, SettingsRegistry } from '@cerebro-ide/settings';
import { describe, expect, it, vi } from 'vitest';
import { FILES_DEFAULT, matchesGlob, NO_HOST, prettierPlugin } from '../src/prettier-plugin.js';

/** The plugin, added to a registry of its own, with a host that answers `answer`. */
async function setup(answer: unknown = { text: 'formatted' }) {
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const keymap = new Keymap('other');
  const settings = new SettingsRegistry();
  const values = new Settings(settings, {
    global: new SettingsLayer(settings, 'global'),
    repo: new SettingsLayer(settings, 'repo'),
    worktree: new SettingsLayer(settings, 'worktree'),
  });
  let hook: BeforeSave | undefined;
  let focused: string | undefined;
  const format = vi.fn<Editors['format']>();
  const request = vi.fn<Host['request']>(() => Promise.resolve(answer));
  let host: Host | undefined = { request };
  const plugins = new PluginRegistry({
    commands,
    menus,
    keymap,
    views: new ViewRegistry(new ToolWindows()),
    settings,
    settingsOf: () => values,
    hostOf: () => host,
    editors: {
      focused: () => focused,
      format,
      beforeSave: (h) => {
        hook = h;
        return { dispose: () => undefined };
      },
    },
  });
  await plugins.add(prettierPlugin);
  return {
    commands,
    menus,
    keymap,
    settings,
    values,
    request,
    format,
    hook: () => hook as BeforeSave,
    focus: (path: string | undefined) => {
      focused = path;
    },
    noHost: () => {
      host = undefined;
    },
  };
}

describe('the Prettier plugin', () => {
  it('has its settings on Languages & Frameworks → JavaScript → Prettier, as IntelliJ’s', async () => {
    const { settings, values } = await setup();
    expect(settings.pages.get('languages/javascript/prettier')).toMatchObject({
      title: 'Prettier',
      parent: 'languages/javascript',
    });
    expect(settings.onPage('languages/javascript/prettier').map((s) => s.title)).toEqual([
      'Prettier package',
      'Run for files',
      'Run on save',
    ]);
    expect(values.get('prettier.package')).toBe('');
    expect(values.get('prettier.files')).toBe(FILES_DEFAULT);
    expect(values.get('prettier.onSave')).toBe(false);
  });

  it('reformats the focused editor from its context menu and on Ctrl+Alt+Shift+P', async () => {
    const { commands, menus, keymap, format, request, focus, noHost, values } = await setup();
    expect(menus.entries('editor/content')).toEqual([{ command: 'prettier.reformat' }]);
    expect(keymap.shortcutsFor('prettier.reformat')).toEqual(['Ctrl+Alt+Shift+P']);
    const command = commands.get('prettier.reformat');
    expect(command?.label).toBe('Reformat with Prettier');
    expect(command?.enabled?.(undefined)).toBe(false);
    focus('/r/a.ts');
    expect(command?.enabled?.(undefined)).toBe(true);
    commands.execute('prettier.reformat');
    const [formatter, words] = format.mock.calls[0] as [Formatter, FormatWords];
    expect(words.name).toBe('Reformat Code With Prettier');
    expect([words.formatted(1), words.formatted(3), words.unchanged]).toEqual([
      'Prettier: formatted 1 line',
      'Prettier: formatted 3 lines',
      'Prettier: no lines changed. Content is already properly formatted',
    ]);
    // Through the file's host, with the package the settings name, if one.
    expect(await formatter({ path: '/r/a.ts', text: 'x' })).toEqual({ text: 'formatted' });
    expect(request).toHaveBeenLastCalledWith('prettier.format', { path: '/r/a.ts', text: 'x' });
    values.layers.global.set('prettier.package', '/p/prettier');
    await formatter({ path: '/r/a.ts', text: 'xy', range: { from: 1, to: 2 } });
    expect(request).toHaveBeenLastCalledWith('prettier.format', {
      path: '/r/a.ts',
      text: 'xy',
      from: 1,
      to: 2,
      package: '/p/prettier',
    });
    noHost();
    expect(await formatter({ path: '/r/a.ts', text: 'x' })).toEqual({ refused: NO_HOST });
  });

  it('formats what’s saved when Run on save is on, for the files Run for files names', async () => {
    const { hook, values, request } = await setup();
    const file = { path: '/r/a.ts', text: 'x' };
    expect(await hook()(file)).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    values.layers.global.set('prettier.onSave', true);
    expect(await hook()(file)).toEqual({ text: 'formatted', name: 'Reformat Code With Prettier' });
    expect(await hook()({ path: '/r/a.py', text: 'x' })).toBeUndefined();
    values.layers.global.set('prettier.files', '**/*.py');
    expect(await hook()({ path: '/r/a.py', text: 'x' })).toEqual({
      text: 'formatted',
      name: 'Reformat Code With Prettier',
    });
  });

  it('saves a file Prettier can’t format as it is', async () => {
    const { hook, values } = await setup({ refused: 'Prettier: Unexpected token (1:7)' });
    values.layers.global.set('prettier.onSave', true);
    expect(await hook()({ path: '/r/a.ts', text: 'const = ;' })).toBeUndefined();
  });
});

describe('Run for files’ globs', () => {
  it('match as IntelliJ’s, from any folder down', () => {
    expect(matchesGlob(FILES_DEFAULT, '/r/src/a.ts')).toBe(true);
    expect(matchesGlob(FILES_DEFAULT, 'C:\\r\\src\\a.json')).toBe(true);
    expect(matchesGlob(FILES_DEFAULT, '/r/a.tsx')).toBe(true);
    expect(matchesGlob(FILES_DEFAULT, '/r/a.py')).toBe(false);
    expect(matchesGlob(FILES_DEFAULT, '/r/a.ts.bak')).toBe(false);
    expect(matchesGlob('src/**/*.ts', '/r/src/x/y/a.ts')).toBe(true);
    expect(matchesGlob('src/**/*.ts', '/r/lib/a.ts')).toBe(false);
    expect(matchesGlob('src/**', '/r/src/x/a.md')).toBe(true);
    expect(matchesGlob('?.md', '/r/a.md')).toBe(true);
    expect(matchesGlob('?.md', '/r/ab.md')).toBe(false);
    expect(matchesGlob('*.md', '/r/notes/a.md')).toBe(true);
    expect(matchesGlob('a+b.(x)', '/r/a+b.(x)')).toBe(true);
  });
});
