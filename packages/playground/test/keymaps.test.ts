import { Keymap, type KeymapPreset } from '@cerebro-ide/commands';
import { describe, expect, it } from 'vitest';
import {
  codeMirrorKey,
  EDITOR_ACTIONS,
  editorKeys,
  editorMouse,
  forMac,
  INTELLIJ,
  INTELLIJ_MAC,
  ECLIPSE,
  MACOS_SYSTEM,
  NETBEANS,
  PRESETS,
  SUBLIME_MAC,
  VISUAL_STUDIO,
  VSCODE_LINUX,
  VSCODE_MAC,
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
    expect(windows.bindings['navigate.back']).toEqual(['Alt+Left', 'Button4Click']);
    expect(windows.bindings['editor.close']).toEqual(['Ctrl+F4', 'Ctrl+W']);
    expect(linux.bindings[EDITOR_ACTIONS.format]).toEqual(['Ctrl+Shift+I', 'Ctrl+K Ctrl+F']);
    expect(windows.bindings[EDITOR_ACTIONS.format]).toEqual(['Shift+Alt+F', 'Ctrl+K Ctrl+F']);
    expect([linux.id, windows.id]).toEqual(['vscode', 'vscode']);
  });

  it('give a diff’s keys before another command’s with the same: macOS System’s Back', () => {
    const keymap = new Keymap('mac');
    keymap.setPreset(MACOS_SYSTEM);
    expect(keymap.commandsFor('Meta+[')).toEqual(['diff.previousDifference', 'navigate.back']);
    expect(keymap.shortcutsFor('diff.nextDifference')).toEqual(['Meta+]', 'F7']);
  });

  it('give the Log’s New Branch New Branch’s key first, as IntelliJ’s use-shortcut-of', () => {
    for (const [platform, preset] of [
      ['other', INTELLIJ],
      ['mac', INTELLIJ_MAC],
    ] as const) {
      const keymap = new Keymap(platform);
      keymap.setPreset(preset);
      const [key] = keymap.shortcutsFor('git.newBranch');
      expect(keymap.commandsFor(key as string)).toEqual(['log.newBranch', 'git.newBranch']);
    }
  });

  it('give Next and Previous Occurrence their files’ keys, after a diff’s and an editor’s own', () => {
    const keymap = new Keymap('other');
    keymap.setPreset(INTELLIJ);
    expect(keymap.shortcutsFor('navigate.nextOccurrence')).toEqual(['Ctrl+Alt+ArrowDown']);
    keymap.setPreset(VISUAL_STUDIO);
    expect(keymap.commandsFor('F8')).toEqual(['diff.nextDifference', 'navigate.nextOccurrence']);
    expect(keymap.shortcutsFor('navigate.previousOccurrence')).toEqual([
      'Ctrl+Alt+ArrowUp',
      'Shift+F8',
    ]);
    keymap.setPreset(ECLIPSE);
    expect(keymap.shortcutsFor('navigate.nextOccurrence')).toEqual([]);
    // NetBeans names Method Down on its parent's key: Next Occurrence runs while there's one to go
    // to (the first enabled), else Method Down.
    keymap.setPreset(NETBEANS);
    expect(keymap.commandsFor('Ctrl+Alt+ArrowDown')).toEqual([
      'navigate.nextOccurrence',
      EDITOR_ACTIONS.methodDown,
    ]);
    const mac = new Keymap('mac');
    mac.setPreset(INTELLIJ_MAC);
    expect(mac.shortcutsFor('navigate.previousOccurrence')).toEqual(['Alt+Meta+ArrowUp']);
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
  it('give VS Code on macOS its sheet’s Scroll Line Up and Down', () => {
    const keymap = new Keymap('mac');
    keymap.setPreset(VSCODE_MAC);
    expect(editorKeys(keymap)).toMatchObject({
      scrollUp: ['Ctrl-PageUp'],
      scrollDown: ['Ctrl-PageDown'],
    });
  });

  it('are written as CodeMirror writes them', () => {
    expect(codeMirrorKey('Ctrl+B')).toBe('Ctrl-b');
    expect(codeMirrorKey('Ctrl+K Ctrl+T')).toBe('Ctrl-k Ctrl-t');
    expect(codeMirrorKey('Shift+F12')).toBe('Shift-F12');
    expect(codeMirrorKey('Ctrl++')).toBe('Ctrl-+');
    // Shift with a character: its key, as CodeMirror finds it; a letter's, as it is.
    expect(codeMirrorKey('Ctrl+Shift+_')).toBe('Ctrl-Shift--');
    expect(codeMirrorKey('Meta+Shift+>')).toBe('Meta-Shift-.');
    expect(codeMirrorKey('Ctrl+Shift++')).toBe('Ctrl-Shift-=');
    expect(codeMirrorKey('Ctrl+Shift+/')).toBe('Ctrl-Shift-/');
    expect(codeMirrorKey('Ctrl+Shift+?')).toBe('Ctrl-Shift-/');
    expect(codeMirrorKey('Ctrl+Shift+Z')).toBe('Ctrl-Shift-z');
  });

  it('are the keymap’s for the editor’s actions; Undo and Redo are the Edit commands’', () => {
    const keymap = new Keymap('other');
    keymap.setPreset(INTELLIJ);
    expect(editorKeys(keymap)).toEqual({
      goToDefinition: ['Ctrl-b'],
      goToImplementation: ['Ctrl-Alt-b'],
      goToTypeDeclaration: ['Ctrl-Shift-b'],
      goToSuperMethod: ['Ctrl-u'],
      methodDown: ['Alt-ArrowDown'],
      methodUp: ['Alt-ArrowUp'],
      findUsages: ['Alt-F7'],
      complete: ['Ctrl-Space'],
      quickDocumentation: ['Ctrl-q'],
      quickDefinition: ['Ctrl-Shift-i'],
      parameterInfo: ['Ctrl-p'],
      rename: ['Shift-F6'],
      format: ['Ctrl-Alt-l'],
      fold: ['Ctrl--'],
      unfold: ['Ctrl-='],
      foldAll: ['Ctrl-Shift--'],
      unfoldAll: ['Ctrl-Shift-='],
      nextProblem: ['F2'],
      previousProblem: ['Shift-F2'],
      contextActions: ['Alt-Enter'],
      find: ['Ctrl-f'],
      replace: ['Ctrl-r'],
      lineComment: ['Ctrl-/'],
      blockComment: ['Ctrl-Shift-/'],
      moveLineUp: ['Alt-Shift-ArrowUp'],
      moveLineDown: ['Alt-Shift-ArrowDown'],
      deleteLine: ['Ctrl-y'],
      startNewLine: ['Shift-Enter'],
      startNewLineBefore: ['Ctrl-Alt-Enter'],
      splitLine: ['Ctrl-Enter'],
      joinLines: ['Ctrl-Shift-j'],
      toggleCase: ['Ctrl-Shift-u'],
      expandWord: ['Alt-/'],
      expandWordBackward: ['Alt-Shift-/'],
      matchBrace: ['Ctrl-Shift-m'],
      extendSelection: ['Ctrl-w'],
      shrinkSelection: ['Ctrl-Shift-w'],
      scrollUp: ['Ctrl-ArrowUp'],
      scrollDown: ['Ctrl-ArrowDown'],
      scrollToCenter: ['Ctrl-m'],
      pageTop: ['Ctrl-PageUp'],
      pageBottom: ['Ctrl-PageDown'],
      pageTopWithSelection: ['Ctrl-Shift-PageUp'],
      pageBottomWithSelection: ['Ctrl-Shift-PageDown'],
      undo: [],
      redo: [],
    });
    expect(Object.keys(EDITOR_ACTIONS)).toEqual([
      'goToDefinition',
      'goToImplementation',
      'goToTypeDeclaration',
      'goToSuperMethod',
      'methodDown',
      'methodUp',
      'findUsages',
      'complete',
      'quickDocumentation',
      'quickDefinition',
      'parameterInfo',
      'rename',
      'format',
      'fold',
      'unfold',
      'foldAll',
      'unfoldAll',
      'nextProblem',
      'previousProblem',
      'contextActions',
      'lineComment',
      'blockComment',
      'moveLineUp',
      'moveLineDown',
      'deleteLine',
      'startNewLine',
      'startNewLineBefore',
      'splitLine',
      'joinLines',
      'toggleCase',
      'expandWord',
      'expandWordBackward',
      'matchBrace',
      'extendSelection',
      'shrinkSelection',
      'scrollUp',
      'scrollDown',
      'scrollToCenter',
      'pageTop',
      'pageBottom',
      'pageTopWithSelection',
      'pageBottomWithSelection',
      'find',
      'replace',
    ]);
  });
});

describe('the ready-made keymaps’ mouse shortcuts', () => {
  // IntelliJ's for each, read from its keymaps' files (their parents' where they name none, Ctrl
  // and Meta swapped where macOS's take `$default`'s); Force touch left out, having no web event.
  const B = 'Button4Click';
  const F = 'Button5Click';
  const intellij = {
    def: ['Ctrl+Click'],
    impl: ['Ctrl+Alt+Click'],
    type: ['Ctrl+Shift+Click'],
    doc: ['Alt+MiddleClick'],
  };
  const mac = {
    def: ['Meta+Click', 'MiddleClick'],
    impl: ['Alt+Meta+Click'],
    type: ['Shift+Meta+Click'],
    doc: ['Ctrl+MiddleClick'],
  };
  const none = { def: [], impl: [], type: [], doc: [] };
  const EXPECTED: Record<string, { def: string[]; impl: string[]; type: string[]; doc: string[] }> =
    {
      intellij,
      'intellij-mac': mac,
      'intellij-classic': mac,
      netbeans: intellij,
      vscode: { ...none, def: ['Ctrl+Click'], type: ['Ctrl+Shift+Click'] },
      'vscode-mac': { ...mac, impl: [] },
      eclipse: { ...none, def: ['Ctrl+Click'], doc: ['Alt+MiddleClick'] },
      'eclipse-mac': { ...none, def: ['Ctrl+Click'], doc: ['Alt+MiddleClick'] },
      emacs: { ...intellij, impl: [] },
      'macos-system': { ...mac, doc: [] },
      sublime: { ...none, def: ['MiddleClick', 'Ctrl+Shift+Click'], impl: ['Ctrl+Alt+Click'] },
      'sublime-mac': { ...none, def: ['MiddleClick', 'Shift+Meta+Click'] },
      'visual-studio': { ...none, def: ['Ctrl+Click', 'MiddleClick'], type: ['Ctrl+Shift+Click'] },
      'visual-studio-mac': {
        ...none,
        def: ['Meta+Click'],
        impl: ['Alt+Meta+Click'],
        type: ['Shift+Meta+Click', 'Shift+MiddleClick'],
      },
    };

  it('are IntelliJ’s, Back and Forward on the mouse’s own buttons in each', () => {
    const shown: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const preset of PRESETS) {
      const keymap = new Keymap(
        preset.id.includes('mac') || preset.id.includes('classic') ? 'mac' : 'other',
      );
      keymap.setPreset(preset);
      const of = (command: string) => keymap.mouseShortcutsFor(command).sort();
      shown[preset.id] = {
        def: of(EDITOR_ACTIONS.goToDefinition),
        impl: of(EDITOR_ACTIONS.goToImplementation),
        type: of(EDITOR_ACTIONS.goToTypeDeclaration),
        doc: of(EDITOR_ACTIONS.quickDocumentation),
        back: of('navigate.back'),
        forward: of('navigate.forward'),
      };
      const want = EXPECTED[preset.id] as (typeof EXPECTED)[string];
      expected[preset.id] = {
        def: [...want.def].sort(),
        impl: [...want.impl].sort(),
        type: [...want.type].sort(),
        doc: [...want.doc].sort(),
        back: [B],
        forward: [F],
      };
    }
    expect(shown).toEqual(expected);
  });
});

describe('the editor’s mouse shortcuts', () => {
  const press = (init: MouseEventInit) => new MouseEvent('mousedown', { detail: 1, ...init });

  it('are the keymap’s presses, Go to Declaration’s modifiers its link’s', () => {
    const keymap = new Keymap('other');
    keymap.setPreset(INTELLIJ);
    const mouse = editorMouse(keymap);
    expect(mouse.isShortcut(press({ ctrlKey: true }))).toBe(true);
    expect(mouse.isShortcut(press({ ctrlKey: true, altKey: true }))).toBe(true);
    expect(mouse.isShortcut(press({}))).toBe(false);
    expect(mouse.isShortcut(press({ button: 7 }))).toBe(false);
    expect(mouse.isLink(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))).toBe(
      true,
    );
    // Go to Implementation's: no link.
    expect(mouse.isLink(press({ ctrlKey: true, altKey: true }))).toBe(false);
  });

  it('show no link with nothing held, for a Middle-Click', () => {
    const keymap = new Keymap('mac');
    keymap.setPreset(SUBLIME_MAC);
    const mouse = editorMouse(keymap);
    expect(mouse.isShortcut(press({ button: 1 }))).toBe(true);
    expect(mouse.isLink(press({}))).toBe(false);
    expect(mouse.isLink(press({ shiftKey: true, metaKey: true }))).toBe(true);
  });
});
