import { Keymap, type KeymapPreset } from '@cerebro-ide/commands';
import { describe, expect, it } from 'vitest';
import {
  codeMirrorKey,
  EDITOR_ACTIONS,
  editorKeys,
  forMac,
  INTELLIJ,
  INTELLIJ_MAC,
  PRESETS,
  VSCODE_LINUX,
  vscode,
} from '../src/keymaps.js';

describe('the ready-made keymaps', () => {
  it('are listed by name, each once', () => {
    const names = PRESETS.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it('only name commands IntelliJ’s keymaps have keys for', () => {
    // A misspelt command would bind nothing, unnoticed.
    const known = new Set([
      ...Object.keys(INTELLIJ.bindings),
      ...Object.keys(INTELLIJ_MAC.bindings),
    ]);
    const unknown = (preset: KeymapPreset): string[] => [
      ...Object.keys(preset.bindings).filter((command) => !known.has(command)),
      ...(preset.parent ? unknown(preset.parent) : []),
    ];
    expect(PRESETS.flatMap(unknown)).toEqual([]);
    expect(Object.keys(INTELLIJ.bindings).sort()).toEqual(
      Object.keys(INTELLIJ_MAC.bindings).sort(),
    );
  });

  it('have VS Code’s Linux keys on Linux only', () => {
    const linux = vscode('Linux x86_64');
    const windows = vscode('Win32');
    expect(linux.bindings['navigate.back']).toEqual(VSCODE_LINUX['navigate.back']);
    expect(windows.bindings['navigate.back']).toEqual(['Alt+Left']);
    expect(windows.bindings['editor.close']).toEqual(['Ctrl+F4', 'Ctrl+W']);
    expect([linux.id, windows.id]).toEqual(['vscode', 'vscode']);
  });

  it('swap Ctrl and Meta for a keymap made for macOS from another', () => {
    const mac = forMac({
      id: 'x',
      name: 'X',
      bindings: { a: ['Ctrl+B', 'Meta+Shift+C', 'Ctrl+K Ctrl+T', 'Alt+F7'] },
    });
    expect(mac.bindings['a']).toEqual(['Meta+B', 'Ctrl+Shift+C', 'Meta+K Meta+T', 'Alt+F7']);
    expect(mac.id).toBe('x');
  });
});

describe('the editor’s keys', () => {
  it('are written as CodeMirror writes them', () => {
    expect(codeMirrorKey('Ctrl+B')).toBe('Ctrl-b');
    expect(codeMirrorKey('Ctrl+K Ctrl+T')).toBe('Ctrl-k Ctrl-t');
    expect(codeMirrorKey('Shift+F12')).toBe('Shift-F12');
    expect(codeMirrorKey('Ctrl++')).toBe('Ctrl-+');
    expect(codeMirrorKey('Ctrl+Shift+_')).toBe('Ctrl-Shift-_');
  });

  it('are the keymap’s for the editor’s actions; Undo and Redo are the Edit commands’', () => {
    const keymap = new Keymap('other');
    keymap.setPreset(INTELLIJ);
    expect(editorKeys(keymap)).toEqual({
      goToDefinition: ['Ctrl-b'],
      findUsages: ['Alt-F7'],
      find: ['Ctrl-f'],
      replace: ['Ctrl-r'],
      undo: [],
      redo: [],
    });
    expect(Object.keys(EDITOR_ACTIONS)).toEqual([
      'goToDefinition',
      'findUsages',
      'find',
      'replace',
    ]);
  });
});
