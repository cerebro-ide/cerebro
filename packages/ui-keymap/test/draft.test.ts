import { Keymap, type KeymapPreset } from '@cerebro-ide/commands';
import { describe, expect, it } from 'vitest';
import { KeymapDraft } from '../src/index.js';

function setup(user: { key: string; command: string; remove?: boolean }[] = []) {
  const keymap = new Keymap('other');
  keymap.bindDefault('mod+s', 'save');
  keymap.bindDefault('ctrl+k ctrl+t', 'theme');
  keymap.bindDefault('F2', 'rename');
  const preset: KeymapPreset = { id: 'p', name: 'P', bindings: { rename: ['shift+F6'] } };
  return new KeymapDraft(user, (u) => keymap.bindingsWith(u, preset), 'other');
}

describe('KeymapDraft', () => {
  it('gives the keymap’s shortcuts with the user’s, normalized', () => {
    const draft = setup([{ key: 'ctrl+alt+s', command: 'save' }]);
    expect(draft.user).toEqual([{ key: 'Ctrl+Alt+S', command: 'save' }]);
    expect(draft.shortcutsFor('save')).toEqual(['Ctrl+Alt+S', 'Ctrl+S']);
    // The preset's keys, not the default's.
    expect(draft.shortcutsFor('rename')).toEqual(['Shift+F6']);
    expect(draft.isModified('save')).toBe(true);
    expect(draft.isModified('theme')).toBe(false);
  });

  it('adds a shortcut, once, and gives back one it had removed', () => {
    const draft = setup();
    draft.add('save', 'F5');
    draft.add('save', 'F5');
    expect(draft.shortcutsFor('save')).toEqual(['F5', 'Ctrl+S']);
    draft.remove('save', 'Ctrl+S');
    expect(draft.user).toEqual([
      { key: 'F5', command: 'save' },
      { key: 'Ctrl+S', command: 'save', remove: true },
    ]);
    draft.add('save', 'ctrl+s');
    expect(draft.user).toEqual([{ key: 'F5', command: 'save' }]);
    expect(draft.shortcutsFor('save')).toEqual(['F5', 'Ctrl+S']);
  });

  it('removes an added shortcut by dropping it, and resets a command', () => {
    const draft = setup();
    draft.add('theme', 'F9');
    draft.remove('theme', 'F9');
    expect(draft.user).toEqual([]);
    draft.remove('theme', 'Ctrl+K Ctrl+T');
    draft.add('theme', 'F9');
    expect(draft.shortcutsFor('theme')).toEqual(['F9']);
    draft.reset('theme');
    expect(draft.shortcutsFor('theme')).toEqual(['Ctrl+K Ctrl+T']);
    expect(draft.isModified('theme')).toBe(false);
  });

  it('finds conflicts: the same keys, or a sequence one starts', () => {
    const draft = setup();
    expect(draft.conflicts('ctrl+s', 'other')).toEqual(['save']);
    expect(draft.conflicts('Ctrl+S', 'save')).toEqual([]);
    // Ctrl+K starts Ctrl+K Ctrl+T, and Ctrl+S Ctrl+X starts with Ctrl+S.
    expect(draft.conflicts('Ctrl+K', 'other')).toEqual(['theme']);
    expect(draft.conflicts('Ctrl+S Ctrl+X', 'other')).toEqual(['save']);
    expect(draft.conflicts('F12', 'other')).toEqual([]);
  });

  it('takes conflicting shortcuts from the other commands', () => {
    const draft = setup();
    draft.add('save', 'F12');
    draft.removeFromOthers('Ctrl+K', 'other');
    draft.removeFromOthers('F12', 'other');
    expect(draft.shortcutsFor('theme')).toEqual([]);
    expect(draft.shortcutsFor('save')).toEqual(['Ctrl+S']);
  });
});
