import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// What the settings start from: saved layers, one unreadable. Put there before the module reads
// them, as it does once, when it loads.
let settings: typeof import('../src/settings.js');
beforeAll(async () => {
  localStorage.setItem('cerebro.settings.global.user', JSON.stringify({ 'editor.tabSize': 4 }));
  localStorage.setItem('cerebro.settings.repo.cerebro', '{unreadable');
  localStorage.setItem('cerebro.settings.worktree.wt', JSON.stringify({ 'editor.softWrap': true }));
  settings = await import('../src/settings.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settings', () => {
  it('start from what was saved, or the defaults where it can’t be read', () => {
    const { globalSettings, settingsFor } = settings;
    expect(globalSettings.get('editor.tabSize')).toBe(4);
    expect(settingsFor(undefined)).toBe(globalSettings);
    const wt = settingsFor('wt');
    expect(settingsFor('wt')).toBe(wt);
    expect([wt.get('editor.tabSize'), wt.get('editor.softWrap')]).toEqual([4, true]);
    expect(settingsFor('other').get('editor.softWrap')).toBe(false);
  });

  it('save each scope’s layer where it’s read from', () => {
    const { globalSettings, save, settingsFor } = settings;
    const wt = settingsFor('wt');
    wt.layers.worktree.set('editor.fontSize', 20);
    wt.layers.repo.set('editor.fontSize', 18);
    wt.layers.global.set('editor.fontSize', 16);
    save(wt, ['global', 'repo', 'worktree']);
    const read = (key: string) => JSON.parse(localStorage.getItem(key) as string) as unknown;
    expect(read('cerebro.settings.worktree.wt')).toEqual({
      'editor.softWrap': true,
      'editor.fontSize': 20,
    });
    expect(read('cerebro.settings.repo.cerebro')).toEqual({ 'editor.fontSize': 18 });
    expect(read('cerebro.settings.global.user')).toMatchObject({ 'editor.fontSize': 16 });
    // The global settings' own worktree layer is no worktree's: nothing to save it as.
    const set = vi.spyOn(Storage.prototype, 'setItem');
    save(globalSettings, ['worktree']);
    expect(set).not.toHaveBeenCalled();
  });

  it('still apply when they can’t be saved', () => {
    const { save, settingsFor } = settings;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const wt = settingsFor('wt');
    wt.layers.worktree.set('editor.tabSize', 8);
    expect(() => {
      save(wt, ['worktree']);
    }).not.toThrow();
    expect(wt.get('editor.tabSize')).toBe(8);
  });

  it('use IntelliJ’s keymap for the system they run on', () => {
    expect(settings.defaultKeymap('MacIntel')).toBe('intellij-mac');
    expect(settings.defaultKeymap('Win32')).toBe('intellij');
    expect(settings.registry.get('keymap')?.default).toBe(
      settings.defaultKeymap(navigator.platform),
    );
  });

  it('offer the display scales as percentages', () => {
    const scale = settings.registry.get('appearance.displayScale');
    expect(scale?.type === 'enum' && scale.options.map((o) => o.label)).toEqual([
      'Auto',
      '100%',
      '125%',
      '150%',
      '175%',
      '200%',
      '250%',
      '300%',
    ]);
  });
});
