// The ready-made keymaps, as IntelliJ's Settings → Keymap lists them (Ido: "the most common in both
// macos and plain (win/Linux) configuration … vscode and intellij own as step 1"). The keys are the
// sources' own, for the commands Cerebro has:
// - IntelliJ: its keymap files, `$default.xml` (Windows and Linux) and `Mac OS X 10.5+.xml`, which
//   takes `$default`'s keys with Ctrl and Meta swapped and overrides some
//   (github.com/JetBrains/intellij-community, platform/platform-resources/src/keymaps).
// - VS Code: its keyboard shortcut sheets for Windows and macOS
//   (code.visualstudio.com/shortcuts/keyboard-shortcuts-windows.pdf and -macos.pdf); a command they
//   don't name keeps IntelliJ's keys. Linux's few differences (Go Back is Ctrl+Alt+-) aren't kept.
// A command none of them names (a plugin's) keeps the key its owner gives it.

import type { Keymap, KeymapPreset } from '@cerebro-ide/commands';
import type { EditorKeys } from '@cerebro-ide/ui-editor';

/** The editor's own actions: CodeMirror runs them, with the keys the keymap gives them. */
export const EDITOR_ACTIONS = {
  goToDefinition: 'editor.goToDefinition',
  findUsages: 'editor.findUsages',
  find: 'editor.find',
  replace: 'editor.replace',
} as const;

export const INTELLIJ: KeymapPreset = {
  id: 'intellij',
  name: 'IntelliJ IDEA',
  bindings: {
    'symbol.goTo': ['Ctrl+Alt+Shift+N'],
    'class.goTo': ['Ctrl+N'],
    'file.goTo': ['Ctrl+Shift+N'],
    'search.everywhere': ['Shift Shift'],
    'action.find': ['Ctrl+Shift+A'],
    'find.inFiles': ['Ctrl+Shift+F'],
    'replace.inFiles': ['Ctrl+Shift+R'],
    'navigate.back': ['Ctrl+Alt+Left'],
    'navigate.forward': ['Ctrl+Alt+Right'],
    'navigate.goToLine': ['Ctrl+G'],
    'view.recentFiles': ['Ctrl+E'],
    'file.new': ['Ctrl+Alt+Shift+Insert'],
    'file.saveAll': ['Ctrl+S'],
    'file.settings': ['Ctrl+Alt+S'],
    'editor.close': ['Ctrl+F4'],
    'editor.copyPath': ['Ctrl+Shift+C'],
    'edit.undo': ['Ctrl+Z'],
    'edit.redo': ['Ctrl+Shift+Z'],
    'edit.cut': ['Ctrl+X'],
    'edit.copy': ['Ctrl+C'],
    'edit.paste': ['Ctrl+V'],
    // Quick Switch Scheme, IntelliJ's nearest.
    'view.darkTheme': ['Ctrl+`'],
    'view.tool.project': ['Alt+1'],
    'view.tool.bookmarks': ['Alt+2'],
    'view.tool.problems': ['Alt+6'],
    'view.tool.structure': ['Alt+7'],
    'view.tool.services': ['Alt+8'],
    'view.tool.git': ['Alt+9'],
    'view.tool.commit': ['Alt+0'],
    'view.tool.terminal': ['Alt+F12'],
    'changes.showDiff': ['Ctrl+D'],
    'changes.jumpToSource': ['F4'],
    'changes.rollback': ['Ctrl+Alt+Z'],
    'changes.groupByDirectory': ['Ctrl+Alt+P'],
    'changes.expandAll': ['Ctrl+=', 'Ctrl++'],
    'changes.collapseAll': ['Ctrl+-'],
    [EDITOR_ACTIONS.goToDefinition]: ['Ctrl+B'],
    [EDITOR_ACTIONS.findUsages]: ['Alt+F7'],
    [EDITOR_ACTIONS.find]: ['Ctrl+F'],
    [EDITOR_ACTIONS.replace]: ['Ctrl+R'],
  },
};

export const INTELLIJ_MAC: KeymapPreset = {
  id: 'intellij-mac',
  name: 'IntelliJ IDEA (macOS)',
  bindings: {
    'symbol.goTo': ['Meta+Alt+O'],
    'class.goTo': ['Meta+O'],
    'file.goTo': ['Meta+Shift+O'],
    'search.everywhere': ['Shift Shift'],
    'action.find': ['Meta+Shift+A'],
    'find.inFiles': ['Meta+Shift+F'],
    'replace.inFiles': ['Meta+Shift+R'],
    'navigate.back': ['Meta+[', 'Meta+Alt+Left'],
    'navigate.forward': ['Meta+]', 'Meta+Alt+Right'],
    'navigate.goToLine': ['Meta+L'],
    'view.recentFiles': ['Meta+E'],
    'file.new': ['Meta+Shift+N'],
    'file.saveAll': ['Meta+S'],
    'file.settings': ['Meta+,'],
    'editor.close': ['Meta+W'],
    'editor.copyPath': ['Meta+Shift+C'],
    'edit.undo': ['Meta+Z'],
    'edit.redo': ['Meta+Shift+Z'],
    'edit.cut': ['Meta+X'],
    'edit.copy': ['Meta+C'],
    'edit.paste': ['Meta+V'],
    'view.darkTheme': ['Ctrl+`'],
    'view.tool.project': ['Meta+1'],
    'view.tool.bookmarks': ['Meta+2'],
    'view.tool.problems': ['Meta+6'],
    'view.tool.structure': ['Meta+7'],
    'view.tool.services': ['Meta+8'],
    'view.tool.git': ['Meta+9'],
    'view.tool.commit': ['Meta+0'],
    'view.tool.terminal': ['Alt+F12'],
    'changes.showDiff': ['Meta+D'],
    'changes.jumpToSource': ['Meta+Down', 'F4'],
    'changes.rollback': ['Meta+Alt+Z'],
    'changes.groupByDirectory': ['Ctrl+P'],
    'changes.expandAll': ['Meta+=', 'Meta++'],
    'changes.collapseAll': ['Meta+-'],
    [EDITOR_ACTIONS.goToDefinition]: ['Meta+B'],
    [EDITOR_ACTIONS.findUsages]: ['Alt+F7'],
    [EDITOR_ACTIONS.find]: ['Meta+F'],
    [EDITOR_ACTIONS.replace]: ['Meta+R'],
  },
};

export const VSCODE: KeymapPreset = {
  id: 'vscode',
  name: 'VS Code',
  parent: INTELLIJ,
  bindings: {
    // The Command Palette: commands, as Find Action's tab.
    'action.find': ['Ctrl+Shift+P', 'F1'],
    'file.goTo': ['Ctrl+P'],
    'symbol.goTo': ['Ctrl+T'],
    // VS Code has no Go to Class; IntelliJ's Ctrl+N is its New File.
    'class.goTo': [],
    'file.settings': ['Ctrl+,'],
    'find.inFiles': ['Ctrl+Shift+F'],
    'replace.inFiles': ['Ctrl+Shift+H'],
    'navigate.back': ['Alt+Left'],
    'navigate.forward': ['Alt+Right'],
    'navigate.goToLine': ['Ctrl+G'],
    'view.recentFiles': ['Ctrl+Tab'],
    'file.new': ['Ctrl+N'],
    'file.saveAll': ['Ctrl+S', 'Ctrl+K S'],
    'editor.close': ['Ctrl+F4', 'Ctrl+W'],
    'editor.copyPath': ['Ctrl+K P'],
    'edit.redo': ['Ctrl+Y'],
    'view.darkTheme': ['Ctrl+K Ctrl+T'],
    'view.tool.project': ['Ctrl+Shift+E'],
    'view.tool.commit': ['Ctrl+Shift+G'],
    'view.tool.problems': ['Ctrl+Shift+M'],
    'view.tool.terminal': ['Ctrl+`'],
    [EDITOR_ACTIONS.goToDefinition]: ['F12'],
    [EDITOR_ACTIONS.findUsages]: ['Shift+F12'],
    [EDITOR_ACTIONS.find]: ['Ctrl+F'],
    [EDITOR_ACTIONS.replace]: ['Ctrl+H'],
  },
};

export const VSCODE_MAC: KeymapPreset = {
  id: 'vscode-mac',
  name: 'VS Code (macOS)',
  parent: INTELLIJ_MAC,
  bindings: {
    'action.find': ['Meta+Shift+P', 'F1'],
    'file.goTo': ['Meta+P'],
    'symbol.goTo': ['Meta+T'],
    // No Go to Class, as on Windows; IntelliJ's Cmd+O would be VS Code's Open.
    'class.goTo': [],
    'file.settings': ['Meta+,'],
    'find.inFiles': ['Meta+Shift+F'],
    'replace.inFiles': ['Meta+Shift+H'],
    // Forward is Ctrl+Shift+-, which the browser names by the character it types.
    'navigate.back': ['Ctrl+-'],
    'navigate.forward': ['Ctrl+Shift+_'],
    'navigate.goToLine': ['Ctrl+G'],
    'view.recentFiles': ['Ctrl+Tab'],
    'file.new': ['Meta+N'],
    'file.saveAll': ['Meta+S', 'Meta+Alt+S'],
    'editor.close': ['Meta+W'],
    'editor.copyPath': ['Meta+K P'],
    'view.darkTheme': ['Meta+K Meta+T'],
    'view.tool.project': ['Meta+Shift+E'],
    'view.tool.commit': ['Ctrl+Shift+G'],
    'view.tool.problems': ['Meta+Shift+M'],
    'view.tool.terminal': ['Ctrl+`'],
    [EDITOR_ACTIONS.goToDefinition]: ['F12'],
    [EDITOR_ACTIONS.findUsages]: ['Shift+F12'],
    [EDITOR_ACTIONS.find]: ['Meta+F'],
    [EDITOR_ACTIONS.replace]: ['Meta+Alt+F'],
  },
};

export const PRESETS: readonly KeymapPreset[] = [INTELLIJ, INTELLIJ_MAC, VSCODE, VSCODE_MAC];

/** A sequence as CodeMirror writes it: `Ctrl+K Ctrl+T` is `Ctrl-k Ctrl-t`. */
export function codeMirrorKey(sequence: string): string {
  return sequence
    .split(' ')
    .map((chord) => {
      const plus = chord.endsWith('++');
      const parts = plus ? [...chord.slice(0, -2).split('+'), '+'] : chord.split('+');
      const key = parts.pop() as string;
      const name = key.length === 1 ? key.toLowerCase() : key;
      return [...parts, name].join('-');
    })
    .join(' ');
}

/** The editor's actions' keys in a keymap, for its editors. */
export function editorKeys(keymap: Keymap): EditorKeys {
  return Object.fromEntries(
    Object.entries(EDITOR_ACTIONS).map(([action, command]) => [
      action,
      keymap.shortcutsFor(command).map(codeMirrorKey),
    ]),
  );
}
