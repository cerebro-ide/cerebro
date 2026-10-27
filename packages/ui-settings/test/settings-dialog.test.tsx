import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-dialog/styles.css';
import '../src/styles.css';
import { Settings, SettingsLayer, SettingsRegistry, type Scope } from '@cerebro-ide/settings';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSettings, type SettingsDialogOptions } from '../src/index.js';

afterEach(() => {
  for (const dialog of document.querySelectorAll('.cerebro-dialog')) {
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
});

function setup() {
  const registry = new SettingsRegistry();
  registry.registerPage({ id: 'appearance', title: 'Appearance', order: 1 });
  registry.registerPage({ id: 'editor', title: 'Editor', order: 2 });
  registry.registerPage({ id: 'editor/font', title: 'Font', parent: 'editor' });
  registry.registerPage({ id: 'vcs', title: 'Version Control', order: 3 });
  registry.register({
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
  });
  registry.register({
    id: 'editor.fontSize',
    title: 'Size',
    description: 'In pixels.',
    page: 'editor/font',
    type: 'number',
    default: 13,
    min: 6,
    max: 72,
    integer: true,
  });
  registry.register({
    id: 'editor.ligatures',
    title: 'Ligatures',
    page: 'editor/font',
    type: 'boolean',
    default: false,
  });
  registry.register({
    id: 'editor.family',
    title: 'Family',
    page: 'editor/font',
    type: 'string',
    default: 'JetBrains Mono',
  });
  const layers = {
    global: new SettingsLayer(registry, 'global'),
    repo: new SettingsLayer(registry, 'repo'),
    worktree: new SettingsLayer(registry, 'worktree'),
  };
  const settings = new Settings(registry, layers);
  return { registry, layers, settings };
}

function open(options: Partial<SettingsDialogOptions> = {}) {
  const env = setup();
  const onApply = vi.fn();
  const handle = openSettings({ settings: env.settings, onApply, platform: 'other', ...options });
  return { ...env, handle, onApply };
}

const q = (selector: string) => document.querySelector(selector) as HTMLElement;
const pages = () =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-settings__node')].map((n) => [
    n.textContent,
    n.style.paddingLeft,
  ]);
const selected = () => q('.cerebro-settings__node--selected').textContent;
const heading = () => q('.cerebro-settings__heading').textContent;
const page = (id: string) => q(`[data-page="${id}"]`);
const scope = (s: Scope) => q(`[data-scope="${s}"]`);
const setting = (id: string) => q(`[data-setting="${id}"]`);
const input = (id: string) => q(`[data-setting="${id}"] input`) as HTMLInputElement;
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;

function type(element: HTMLInputElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('openSettings', () => {
  it('shows the pages as a tree, the first chosen', () => {
    open();
    expect(q('.cerebro-dialog__title').textContent).toContain('Settings');
    expect(pages()).toEqual([
      ['Appearance', '8px'],
      ['Editor', '8px'],
      ['Font', '24px'],
      ['Version Control', '8px'],
    ]);
    expect(selected()).toBe('Appearance');
    expect(heading()).toBe('Appearance');
  });

  it('shows a page’s settings when it’s chosen, by click or arrows', () => {
    open();
    page('editor/font').click();
    expect(heading()).toBe('Font');
    expect(q('.cerebro-setting__note').textContent).toBe('In pixels.');
    const tree = q('.cerebro-settings__tree');
    const key = (k: string) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      tree.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(key('ArrowDown')).toBe(true);
    expect(selected()).toBe('Version Control');
    key('ArrowDown');
    expect(selected()).toBe('Version Control');
    key('ArrowUp');
    key('ArrowUp');
    key('ArrowUp');
    key('ArrowUp');
    expect(selected()).toBe('Appearance');
    expect(key('x')).toBe(false);
    page('editor').click();
    expect(q('.cerebro-settings__empty').textContent).toBe('Choose a page below Editor');
  });

  it('starts at a page and scope, and names the scopes as asked', () => {
    open({
      page: 'editor/font',
      scope: 'repo',
      scopeLabels: { repo: 'Repository: cerebro' },
    });
    expect(heading()).toBe('Font');
    expect(scope('repo').getAttribute('aria-checked')).toBe('true');
    expect(
      [...document.querySelectorAll('.cerebro-settings__scope')].map((b) => b.textContent),
    ).toEqual(['Global', 'Repository: cerebro', 'Worktree']);
  });

  it('offers only the scopes asked for', () => {
    open({ scopes: ['global'] });
    expect(document.querySelectorAll('.cerebro-settings__scope')).toHaveLength(1);
  });

  it('says so when there are no settings', () => {
    const settings = new Settings(new SettingsRegistry(), {
      global: new SettingsLayer(new SettingsRegistry(), 'global'),
      repo: new SettingsLayer(new SettingsRegistry(), 'repo'),
      worktree: new SettingsLayer(new SettingsRegistry(), 'worktree'),
    });
    openSettings({ settings });
    expect(q('.cerebro-settings__empty').textContent).toBe('No settings');
  });

  it('filters the tree by page and setting titles', () => {
    open();
    const search = q('.cerebro-settings__search') as HTMLInputElement;
    type(search, 'liga');
    expect(pages().map(([t]) => t)).toEqual(['Editor', 'Font']);
    type(search, 'version');
    expect(pages().map(([t]) => t)).toEqual(['Version Control']);
    type(search, 'zzz');
    expect(pages()).toEqual([]);
    q('.cerebro-settings__tree').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(heading()).toBe('Appearance');
    type(search, ' ');
    expect(pages()).toHaveLength(4);
  });

  it('edits a draft, applied by Apply into the scope being edited', () => {
    const { layers, settings, onApply } = open({ page: 'editor/font' });
    expect(button('Apply').disabled).toBe(true);
    type(input('editor.fontSize'), '15');
    const ligatures = input('editor.ligatures');
    ligatures.checked = true;
    ligatures.dispatchEvent(new Event('change', { bubbles: true }));
    scope('repo').click();
    type(input('editor.family'), 'Fira Code');
    expect(settings.get('editor.fontSize')).toBe(13);
    expect(button('Apply').disabled).toBe(false);
    button('Apply').click();
    expect(layers.global.toJSON()).toEqual({ 'editor.fontSize': 15, 'editor.ligatures': true });
    expect(layers.repo.toJSON()).toEqual({ 'editor.family': 'Fira Code' });
    expect(onApply).toHaveBeenCalledWith(['repo', 'global']);
    expect(button('Apply').disabled).toBe(true);
  });

  it('keeps invalid numbers out of the draft, marking the field', () => {
    open({ page: 'editor/font' });
    const size = input('editor.fontSize');
    type(size, '100');
    expect(size.classList.contains('cerebro-setting__input--invalid')).toBe(true);
    expect(button('Apply').disabled).toBe(true);
    type(size, '20');
    expect(size.classList.contains('cerebro-setting__input--invalid')).toBe(false);
  });

  it('applies on OK, and drops the draft on Cancel', async () => {
    const first = open({ page: 'editor/font' });
    type(input('editor.fontSize'), '16');
    button('OK').click();
    expect(await first.handle.result).toBe(true);
    expect(first.settings.get('editor.fontSize')).toBe(16);
    const second = open({ page: 'editor/font' });
    type(input('editor.fontSize'), '17');
    button('Cancel').click();
    expect(await second.handle.result).toBeUndefined();
    expect(second.settings.get('editor.fontSize')).toBe(13);
    expect(second.onApply).not.toHaveBeenCalled();
  });

  it('shows inherited values, overrides in narrower scopes, and resets', () => {
    const { layers, settings } = open({ page: 'editor/font', scope: 'worktree' });
    layers.global.set('editor.fontSize', 14);
    layers.repo.set('editor.fontSize', 15);
    expect(input('editor.fontSize').value).toBe('15');
    expect(setting('editor.fontSize').classList.contains('cerebro-setting--set')).toBe(false);
    scope('global').click();
    expect(input('editor.fontSize').value).toBe('14');
    expect(setting('editor.fontSize').textContent).toContain('Overridden in Repository');
    scope('repo').click();
    expect(setting('editor.fontSize').classList.contains('cerebro-setting--set')).toBe(true);
    q('[data-setting="editor.fontSize"] .cerebro-setting__reset').click();
    expect(input('editor.fontSize').value).toBe('14');
    expect(setting('editor.fontSize').classList.contains('cerebro-setting--set')).toBe(false);
    button('Apply').click();
    expect(layers.repo.has('editor.fontSize')).toBe(false);
    expect(settings.get('editor.fontSize')).toBe(14);
  });

  it('shows a setting beside another on its row, as IntelliJ’s Sync with OS', () => {
    const env = setup();
    env.registry.register({
      id: 'appearance.syncWithOs',
      title: 'Sync with OS',
      page: 'appearance',
      type: 'boolean',
      default: false,
      scopes: ['global'],
      beside: 'appearance.theme',
    });
    // Beside a setting that isn't on the page: shown on its own.
    env.registry.register({
      id: 'appearance.alone',
      title: 'Alone',
      page: 'appearance',
      type: 'boolean',
      default: false,
      beside: 'editor.fontSize',
    });
    openSettings({ settings: env.settings, onApply: vi.fn(), platform: 'other' });
    const rows = [...document.querySelectorAll<HTMLElement>('.cerebro-setting')].map(
      (row) => row.dataset['setting'],
    );
    expect(rows).toEqual(['appearance.theme', 'appearance.alone']);
    const row = q('[data-setting="appearance.theme"] .cerebro-setting__row');
    expect(row.textContent).toBe('ThemeDarkLightSync with OS');
    const sync = input('appearance.syncWithOs');
    // The title is its label: clicking it checks the box.
    q('[data-setting="appearance.syncWithOs"] .cerebro-setting__beside-title').click();
    expect(sync.checked).toBe(true);
    expect(
      setting('appearance.syncWithOs').classList.contains('cerebro-setting__beside--set'),
    ).toBe(true);
    q('[data-setting="appearance.syncWithOs"] .cerebro-setting__reset').click();
    expect(sync.checked).toBe(false);
    sync.click();
    button('Apply').click();
    expect(env.layers.global.toJSON()).toEqual({ 'appearance.syncWithOs': true });
  });

  it('disables settings the scope can’t set, naming where they can be', () => {
    open({ scope: 'repo' });
    const select = q('[data-setting="appearance.theme"] select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(setting('appearance.theme').textContent).toContain('Global only');
    scope('global').click();
    expect(select.disabled).toBe(false);
    select.value = 'light';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(select.value).toBe('light');
  });

  it('ignores values a layer holds that are invalid, or not for its scope', () => {
    const registry = new SettingsRegistry();
    const layers = {
      global: new SettingsLayer(registry, 'global'),
      repo: new SettingsLayer(registry, 'repo'),
      worktree: new SettingsLayer(registry, 'worktree'),
    };
    // Loaded before the settings are registered, so not checked then.
    layers.repo.load({ 'appearance.theme': 'light', 'editor.fontSize': 'huge' });
    registry.registerPage({ id: 'p', title: 'Page' });
    registry.register({
      id: 'editor.fontSize',
      title: 'Size',
      page: 'p',
      type: 'number',
      default: 13,
    });
    registry.register({
      id: 'appearance.theme',
      title: 'Theme',
      page: 'p',
      type: 'enum',
      default: 'dark',
      options: [
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
      ],
      scopes: ['global'],
    });
    openSettings({ settings: new Settings(registry, layers), scope: 'worktree' });
    expect(input('editor.fontSize').value).toBe('13');
    expect((q('select') as HTMLSelectElement).value).toBe('dark');
  });
});
