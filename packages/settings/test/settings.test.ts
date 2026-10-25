import { effect } from '@cerebro-ide/reactive';
import { describe, expect, it } from 'vitest';
import {
  allows,
  isValid,
  Settings,
  SettingsLayer,
  SettingsRegistry,
  type SettingSpec,
} from '../src/index.js';

const FONT: SettingSpec = {
  id: 'editor.fontSize',
  title: 'Font size',
  page: 'editor/font',
  type: 'number',
  default: 13,
  min: 6,
  max: 72,
  integer: true,
};
const THEME: SettingSpec = {
  id: 'appearance.theme',
  title: 'Theme',
  page: 'appearance',
  type: 'enum',
  default: 'dark',
  options: [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ],
  scopes: ['global'],
};
const WRAP: SettingSpec = {
  id: 'editor.softWrap',
  title: 'Soft wrap',
  page: 'editor',
  type: 'boolean',
  default: false,
};
const PREFIX: SettingSpec = {
  id: 'git.branchPrefix',
  title: 'Branch prefix',
  page: 'vcs',
  type: 'string',
  default: '',
};

function setup() {
  const registry = new SettingsRegistry();
  for (const spec of [FONT, THEME, WRAP, PREFIX]) registry.register(spec);
  const global = new SettingsLayer(registry, 'global');
  const repo = new SettingsLayer(registry, 'repo');
  const worktree = new SettingsLayer(registry, 'worktree');
  const settings = new Settings(registry, { global, repo, worktree });
  return { registry, global, repo, worktree, settings };
}

describe('isValid and allows', () => {
  it('checks values against each type', () => {
    expect(isValid(WRAP, true)).toBe(true);
    expect(isValid(WRAP, 'true')).toBe(false);
    expect(isValid(PREFIX, 'feat/')).toBe(true);
    expect(isValid(PREFIX, 1)).toBe(false);
    expect(isValid(THEME, 'light')).toBe(true);
    expect(isValid(THEME, 'blue')).toBe(false);
    expect(isValid(FONT, 14)).toBe(true);
    for (const bad of [14.5, 5, 73, Number.NaN, '14']) expect(isValid(FONT, bad)).toBe(false);
    const free: SettingSpec = { id: 'x', title: 'X', page: 'p', type: 'number', default: 0 };
    expect(isValid(free, -1.5)).toBe(true);
    expect(isValid(free, Infinity)).toBe(false);
  });

  it('allows every scope unless a setting names its own', () => {
    expect(allows(FONT, 'worktree')).toBe(true);
    expect(allows(THEME, 'global')).toBe(true);
    expect(allows(THEME, 'repo')).toBe(false);
  });
});

describe('SettingsRegistry', () => {
  it('registers settings once, with valid defaults, until disposed', () => {
    const registry = new SettingsRegistry();
    const font = registry.register(FONT);
    expect(registry.get('editor.fontSize')).toBe(FONT);
    expect(() => registry.register(FONT)).toThrow(/already registered/);
    expect(() => registry.register({ ...WRAP, id: 'bad', default: 'no' } as never)).toThrow(
      /invalid default/,
    );
    font.dispose();
    expect(registry.get('editor.fontSize')).toBeUndefined();
    const copy = { ...FONT };
    const again = registry.register(copy);
    font.dispose();
    expect(registry.get('editor.fontSize')).toBe(copy);
    again.dispose();
  });

  it('nests pages in order, and lists each page’s settings', () => {
    const { registry } = setup();
    const editor = registry.registerPage({ id: 'editor', title: 'Editor', order: 1 });
    registry.registerPage({ id: 'appearance', title: 'Appearance' });
    registry.registerPage({ id: 'vcs', title: 'Version Control', order: 2 });
    registry.registerPage({ id: 'editor/font', title: 'Font', parent: 'editor' });
    registry.registerPage({ id: 'editor/general', title: 'General', parent: 'editor' });
    expect(registry.children().map((p) => p.id)).toEqual(['appearance', 'editor', 'vcs']);
    expect(registry.children('editor').map((p) => p.title)).toEqual(['Font', 'General']);
    expect(registry.onPage('editor/font')).toEqual([FONT]);
    expect(() => registry.registerPage({ id: 'editor', title: 'Again' })).toThrow(/already/);
    editor.dispose();
    expect(registry.children().map((p) => p.id)).toEqual(['appearance', 'vcs']);
    const replaced = registry.registerPage({ id: 'editor', title: 'Editor' });
    editor.dispose();
    expect(registry.pages.get('editor')).toBeDefined();
    replaced.dispose();
  });
});

describe('SettingsLayer', () => {
  it('sets valid values its scope allows, and resets them', () => {
    const { repo } = setup();
    expect(repo.set('editor.fontSize', 15)).toBe(true);
    expect(repo.set('editor.fontSize', 100)).toBe(false);
    expect(repo.set('appearance.theme', 'light')).toBe(false);
    expect(repo.set('unknown', 1)).toBe(false);
    expect(repo.toJSON()).toEqual({ 'editor.fontSize': 15 });
    repo.reset('editor.fontSize');
    expect(repo.has('editor.fontSize')).toBe(false);
  });

  it('loads values from a file, keeping unknown settings and dropping invalid ones', () => {
    const { global } = setup();
    global.set('editor.softWrap', true);
    global.load({
      'editor.fontSize': 'big',
      'appearance.theme': 'light',
      'plugin.setting': { any: 'thing' },
    });
    expect(global.toJSON()).toEqual({
      'appearance.theme': 'light',
      'plugin.setting': { any: 'thing' },
    });
  });
});

describe('Settings', () => {
  it('sees the narrowest layer that sets a value, else the default', () => {
    const { settings, global, repo, worktree } = setup();
    expect(settings.get('editor.fontSize')).toBe(13);
    expect(settings.scopeOf('editor.fontSize')).toBeUndefined();
    global.set('editor.fontSize', 14);
    repo.set('editor.fontSize', 15);
    expect(settings.get('editor.fontSize')).toBe(15);
    expect(settings.scopeOf('editor.fontSize')).toBe('repo');
    worktree.set('editor.fontSize', 16);
    expect(settings.get('editor.fontSize')).toBe(16);
    worktree.reset('editor.fontSize');
    repo.reset('editor.fontSize');
    expect(settings.get('editor.fontSize')).toBe(14);
    expect(settings.scopeOf('editor.fontSize')).toBe('global');
  });

  it('ignores values loaded before their setting was registered, if invalid for it', () => {
    const registry = new SettingsRegistry();
    const layer = (scope: 'global' | 'repo' | 'worktree') => new SettingsLayer(registry, scope);
    const repo = layer('repo');
    repo.load({ 'appearance.theme': 'light', 'editor.fontSize': 'huge' });
    const settings = new Settings(registry, {
      global: layer('global'),
      repo,
      worktree: layer('worktree'),
    });
    registry.register(THEME);
    registry.register(FONT);
    expect(settings.get('appearance.theme')).toBe('dark');
    expect(settings.get('editor.fontSize')).toBe(13);
    expect(settings.scopeOf('unknown')).toBeUndefined();
    expect(() => settings.get('unknown')).toThrow(/not registered/);
  });

  it('is reactive, across environments sharing layers', () => {
    const { registry, global, repo, settings } = setup();
    const other = new Settings(registry, {
      global,
      repo,
      worktree: new SettingsLayer(registry, 'worktree'),
    });
    const seen: unknown[] = [];
    const watch = effect(() => {
      seen.push([settings.get('editor.softWrap'), other.get('editor.softWrap')]);
      return undefined;
    });
    repo.set('editor.softWrap', true);
    settings.layers.worktree.set('editor.softWrap', false);
    watch.dispose();
    expect(seen).toEqual([
      [false, false],
      [true, true],
      [false, true],
    ]);
  });

  it('checks each layer has its scope', () => {
    const registry = new SettingsRegistry();
    const global = new SettingsLayer(registry, 'global');
    expect(() => new Settings(registry, { global, repo: global, worktree: global })).toThrow(
      /The worktree layer has scope global/,
    );
  });
});
