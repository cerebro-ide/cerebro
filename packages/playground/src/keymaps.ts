// The ready-made keymaps, as IntelliJ's Settings → Keymap lists them (Ido: "the most common in both
// macos and plain (win/Linux) configuration … vscode and intellij own as step 1"). The keys are the
// sources' own, for the commands Cerebro has:
// - IntelliJ: its keymap files, `$default.xml` (Windows and Linux) and `Mac OS X 10.5+.xml`, which
//   takes `$default`'s keys with Ctrl and Meta swapped and overrides some
//   (github.com/JetBrains/intellij-community, platform/platform-resources/src/keymaps).
//   Commit's Ctrl+K is given where the action is declared (platform/vcs-impl, VcsActions.xml), and
//   Push's Ctrl+Shift+K in the keymap dvcs-impl adds to `$default` (platform/dvcs-impl).
// - VS Code: its keyboard shortcut sheets for Windows and macOS
//   (code.visualstudio.com/shortcuts/keyboard-shortcuts-windows.pdf and -macos.pdf); a command they
//   don't name keeps IntelliJ's keys. On Linux, VS Code's keymap takes its Linux sheet's few
//   differences (-linux.pdf): Go Back is Ctrl+Alt+-, as `VSCODE_LINUX` has them.
// - The others: IntelliJ's own files for them, as it ships them (Eclipse, NetBeans and Visual Studio
//   in plugins/keymaps, the rest beside `$default`), named as its Settings names them. Each takes
//   its parent's keys for the commands it doesn't name, as IntelliJ: `$default` (here INTELLIJ) or
//   `Mac OS X 10.5+` (INTELLIJ_MAC). A key other than a letter or digit is the character it types
//   with Shift on a US keyboard (`Ctrl+Shift+_` for IntelliJ's `control shift MINUS`), as the
//   browser names it. Emacs's sequences that start with Escape are left out: Escape closes popups
//   and dialogs here.
// A command none of them names (a plugin's) keeps the key its owner gives it.

import type { Keymap, KeymapPreset } from '@cerebro-ide/commands';
import type { EditorKeys } from '@cerebro-ide/ui-editor';

/** The editor's own actions: CodeMirror runs them, with the keys the keymap gives them. */
export const EDITOR_ACTIONS = {
  goToDefinition: 'editor.goToDefinition',
  findUsages: 'editor.findUsages',
  complete: 'editor.codeCompletion',
  quickDocumentation: 'editor.quickDocumentation',
  parameterInfo: 'editor.parameterInfo',
  rename: 'editor.rename',
  format: 'editor.reformatCode',
  fold: 'editor.collapseRegion',
  unfold: 'editor.expandRegion',
  foldAll: 'editor.collapseAllRegions',
  unfoldAll: 'editor.expandAllRegions',
  nextProblem: 'editor.nextProblem',
  previousProblem: 'editor.previousProblem',
  contextActions: 'editor.showContextActions',
  find: 'editor.find',
  replace: 'editor.replace',
} as const;

export const INTELLIJ: KeymapPreset = {
  id: 'intellij',
  name: 'IntelliJ IDEA',
  bindings: {
    // First: in a diff, its keys come before another command's with the same (macOS System's
    // Meta+[ is Back elsewhere), as IntelliJ's diff takes them.
    'diff.nextDifference': ['F7'],
    'diff.previousDifference': ['Shift+F7'],
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
    'navigate.fileStructure': ['Ctrl+F12'],
    'view.recentFiles': ['Ctrl+E'],
    'view.switcher': ['Ctrl+Tab', 'Ctrl+Shift+Tab'],
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
    'problems.jumpToSource': ['F4'],
    'changes.rollback': ['Ctrl+Alt+Z'],
    'changes.groupByDirectory': ['Ctrl+Alt+P'],
    'changes.expandAll': ['Ctrl+=', 'Ctrl++'],
    'changes.collapseAll': ['Ctrl+-'],
    // The image viewer's: Zoom In and Out take Expand All's and Collapse All's keys, as IntelliJ's.
    'image.toggleGrid': ["Ctrl+'"],
    'image.zoomIn': ['Ctrl+=', 'Ctrl++'],
    'image.zoomOut': ['Ctrl+-'],
    'image.actualSize': ['Ctrl+/'],
    'changes.commit': ['Ctrl+K'],
    'vcs.push': ['Ctrl+Shift+K'],
    // Update Project: given where the action is declared (VcsActions.xml).
    'vcs.update': ['Ctrl+T'],
    // Branches and New Branch: given where git's actions are declared (intellij.vcs.git.backend.xml)
    // and in `$default`.
    'git.branches': ['Ctrl+Shift+~'],
    'git.newBranch': ['Ctrl+Alt+N'],
    'changes.amend': ['Alt+M'],
    [EDITOR_ACTIONS.goToDefinition]: ['Ctrl+B'],
    [EDITOR_ACTIONS.findUsages]: ['Alt+F7'],
    [EDITOR_ACTIONS.contextActions]: ['Alt+Enter'],
    [EDITOR_ACTIONS.find]: ['Ctrl+F'],
    [EDITOR_ACTIONS.replace]: ['Ctrl+R'],
    [EDITOR_ACTIONS.complete]: ['Ctrl+Space'],
    [EDITOR_ACTIONS.quickDocumentation]: ['Ctrl+Q'],
    [EDITOR_ACTIONS.parameterInfo]: ['Ctrl+P'],
    [EDITOR_ACTIONS.rename]: ['Shift+F6'],
    [EDITOR_ACTIONS.format]: ['Ctrl+Alt+L'],
    // Not the numpad's + (`control ADD`): CodeMirror takes Ctrl and + for Expand, Shift or not, and
    // Ctrl+Shift+= would expand one, not all (measured, its keymap's lookup). Its - is the same key.
    [EDITOR_ACTIONS.fold]: ['Ctrl+-'],
    [EDITOR_ACTIONS.unfold]: ['Ctrl+='],
    [EDITOR_ACTIONS.foldAll]: ['Ctrl+Shift+_'],
    [EDITOR_ACTIONS.unfoldAll]: ['Ctrl+Shift++'],
    [EDITOR_ACTIONS.nextProblem]: ['F2'],
    [EDITOR_ACTIONS.previousProblem]: ['Shift+F2'],
  },
};

export const INTELLIJ_MAC: KeymapPreset = {
  id: 'intellij-mac',
  name: 'IntelliJ IDEA (macOS)',
  bindings: {
    // First: in a diff, its keys come before another command's with the same (macOS System's
    // Meta+[ is Back elsewhere), as IntelliJ's diff takes them.
    'diff.nextDifference': ['F7'],
    'diff.previousDifference': ['Shift+F7'],
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
    'navigate.fileStructure': ['Meta+F12'],
    'view.recentFiles': ['Meta+E'],
    'view.switcher': ['Ctrl+Tab', 'Ctrl+Shift+Tab'],
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
    'problems.jumpToSource': ['Meta+Down', 'F4'],
    'changes.rollback': ['Meta+Alt+Z'],
    'changes.groupByDirectory': ['Ctrl+P'],
    'changes.expandAll': ['Meta+=', 'Meta++'],
    'changes.collapseAll': ['Meta+-'],
    'image.toggleGrid': ["Meta+'"],
    'image.zoomIn': ['Meta+=', 'Meta++'],
    'image.zoomOut': ['Meta+-'],
    'image.actualSize': ['Meta+/'],
    'changes.commit': ['Meta+K'],
    'vcs.push': ['Meta+Shift+K'],
    'vcs.update': ['Meta+T'],
    // Branches' key is removed on macOS where it's declared; New Branch's swapped from `$default`.
    'git.branches': [],
    'git.newBranch': ['Meta+Alt+N'],
    'changes.amend': ['Ctrl+Alt+M'],
    [EDITOR_ACTIONS.goToDefinition]: ['Meta+B'],
    [EDITOR_ACTIONS.findUsages]: ['Alt+F7'],
    [EDITOR_ACTIONS.contextActions]: ['Alt+Enter'],
    [EDITOR_ACTIONS.find]: ['Meta+F'],
    [EDITOR_ACTIONS.replace]: ['Meta+R'],
    // Its file gives Ctrl+Space, over the swap's Meta+Space.
    [EDITOR_ACTIONS.complete]: ['Ctrl+Space'],
    [EDITOR_ACTIONS.quickDocumentation]: ['F1', 'Ctrl+J'],
    [EDITOR_ACTIONS.parameterInfo]: ['Meta+P'],
    [EDITOR_ACTIONS.rename]: ['Shift+F6'],
    [EDITOR_ACTIONS.format]: ['Meta+Alt+L'],
    [EDITOR_ACTIONS.fold]: ['Meta+-'],
    [EDITOR_ACTIONS.unfold]: ['Meta+='],
    [EDITOR_ACTIONS.foldAll]: ['Meta+Shift+_'],
    [EDITOR_ACTIONS.unfoldAll]: ['Meta+Shift++'],
    [EDITOR_ACTIONS.nextProblem]: ['F2'],
    [EDITOR_ACTIONS.previousProblem]: ['Shift+F2'],
  },
};

/** Where VS Code's Linux sheet differs from its Windows one, for the commands Cerebro has. */
export const VSCODE_LINUX: KeymapPreset['bindings'] = {
  // Forward is Ctrl+Shift+-, which the browser names by the character it types.
  'navigate.back': ['Ctrl+Alt+-'],
  'navigate.forward': ['Ctrl+Shift+_'],
  // Without Windows' Ctrl+F4, and its Save All, Ctrl+K S.
  'editor.close': ['Ctrl+W'],
  'file.saveAll': ['Ctrl+S'],
  // Format Document; Format Selection is Ctrl+K Ctrl+F, as on Windows.
  [EDITOR_ACTIONS.format]: ['Ctrl+Shift+I', 'Ctrl+K Ctrl+F'],
};

/** VS Code's keymap for Windows and Linux, with its Linux sheet's keys on Linux (`navigator.platform`). */
export function vscode(platform: string): KeymapPreset {
  return {
    ...VSCODE_WINDOWS,
    bindings: {
      ...VSCODE_WINDOWS.bindings,
      ...(platform.startsWith('Linux') ? VSCODE_LINUX : {}),
    },
  };
}

const VSCODE_WINDOWS: KeymapPreset = {
  id: 'vscode',
  name: 'VS Code',
  parent: INTELLIJ,
  bindings: {
    // Ctrl+T is its Go to Symbol in Workspace, and it has no Update Project (Cerebro's choice).
    'vcs.update': [],
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
    'navigate.fileStructure': ['Ctrl+Shift+O'],
    'view.recentFiles': ['Ctrl+Tab'],
    // Ctrl+Tab is Recent Files here, as before the Switcher.
    'view.switcher': [],
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
    [EDITOR_ACTIONS.contextActions]: ['Ctrl+.'],
    [EDITOR_ACTIONS.find]: ['Ctrl+F'],
    [EDITOR_ACTIONS.replace]: ['Ctrl+H'],
    [EDITOR_ACTIONS.complete]: ['Ctrl+Space', 'Ctrl+I'],
    [EDITOR_ACTIONS.quickDocumentation]: ['Ctrl+K Ctrl+I'],
    // Trigger Parameter Hints (code.visualstudio.com/docs/editing/intellisense).
    [EDITOR_ACTIONS.parameterInfo]: ['Ctrl+Shift+Space'],
    // Rename Symbol, and Go to Next and Previous Problem: its sheets.
    [EDITOR_ACTIONS.rename]: ['F2'],
    [EDITOR_ACTIONS.format]: ['Shift+Alt+F', 'Ctrl+K Ctrl+F'],
    // Its documentation's default keys (Fold, Unfold, Fold All, Unfold All), as Linux's.
    [EDITOR_ACTIONS.fold]: ['Ctrl+Shift+{'],
    [EDITOR_ACTIONS.unfold]: ['Ctrl+Shift+}'],
    [EDITOR_ACTIONS.foldAll]: ['Ctrl+K Ctrl+0'],
    [EDITOR_ACTIONS.unfoldAll]: ['Ctrl+K Ctrl+J'],
    [EDITOR_ACTIONS.nextProblem]: ['F8'],
    [EDITOR_ACTIONS.previousProblem]: ['Shift+F8'],
  },
};

export const VSCODE = vscode(navigator.platform);

export const VSCODE_MAC: KeymapPreset = {
  id: 'vscode-mac',
  name: 'VS Code (macOS)',
  parent: INTELLIJ_MAC,
  bindings: {
    'vcs.update': [],
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
    'navigate.fileStructure': ['Meta+Shift+O'],
    'view.recentFiles': ['Ctrl+Tab'],
    // Ctrl+Tab is Recent Files here, as before the Switcher.
    'view.switcher': [],
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
    [EDITOR_ACTIONS.contextActions]: ['Meta+.'],
    [EDITOR_ACTIONS.find]: ['Meta+F'],
    [EDITOR_ACTIONS.replace]: ['Meta+Alt+F'],
    [EDITOR_ACTIONS.complete]: ['Ctrl+Space', 'Meta+I'],
    [EDITOR_ACTIONS.quickDocumentation]: ['Meta+K Meta+I'],
    [EDITOR_ACTIONS.parameterInfo]: ['Meta+Shift+Space'],
    [EDITOR_ACTIONS.rename]: ['F2'],
    [EDITOR_ACTIONS.format]: ['Shift+Alt+F', 'Meta+K Meta+F'],
    [EDITOR_ACTIONS.fold]: ['Meta+Alt+['],
    [EDITOR_ACTIONS.unfold]: ['Meta+Alt+]'],
    [EDITOR_ACTIONS.foldAll]: ['Meta+K Meta+0'],
    [EDITOR_ACTIONS.unfoldAll]: ['Meta+K Meta+J'],
    [EDITOR_ACTIONS.nextProblem]: ['F8'],
    [EDITOR_ACTIONS.previousProblem]: ['Shift+F8'],
  },
};

/**
 * A keymap's keys with Ctrl and Meta swapped, as IntelliJ's `MacOSDefaultKeymap` takes `$default`'s
 * for a keymap made for macOS from it.
 */
export function forMac(preset: KeymapPreset): KeymapPreset {
  const swap = (sequence: string) =>
    sequence.replace(/(Ctrl|Meta)\+/g, (modifier) => (modifier === 'Ctrl+' ? 'Meta+' : 'Ctrl+'));
  return {
    ...preset,
    bindings: Object.fromEntries(
      Object.entries(preset.bindings).map(([command, keys]) => [command, keys.map(swap)]),
    ),
  };
}

export const ECLIPSE: KeymapPreset = {
  id: 'eclipse',
  name: 'Eclipse',
  parent: INTELLIJ,
  bindings: {
    'diff.nextDifference': ['Ctrl+F7'],
    'vcs.update': [],
    'class.goTo': ['Ctrl+Shift+T'],
    'file.goTo': ['Ctrl+Shift+R'],
    'find.inFiles': ['Ctrl+H'],
    'replace.inFiles': [],
    'navigate.back': ['Alt+Left'],
    'navigate.forward': ['Alt+Right'],
    'navigate.goToLine': ['Ctrl+L'],
    'navigate.fileStructure': ['Ctrl+F3', 'Ctrl+O'],
    'edit.undo': ['Ctrl+Z'],
    'edit.redo': ['Ctrl+Y'],
    'changes.jumpToSource': ['F12', 'Ctrl+Shift+E'],
    'problems.jumpToSource': ['F12', 'Ctrl+Shift+E'],
    'changes.expandAll': ['Ctrl+Shift+*'],
    'changes.collapseAll': ['Ctrl+Shift+/'],
    'image.zoomIn': ['Ctrl+Shift+*'],
    'image.zoomOut': ['Ctrl+Shift+/'],
    'changes.commit': [],
    [EDITOR_ACTIONS.goToDefinition]: ['F3'],
    [EDITOR_ACTIONS.findUsages]: ['Ctrl+G'],
    [EDITOR_ACTIONS.contextActions]: ['Ctrl+1', 'Alt+Enter'],
    [EDITOR_ACTIONS.find]: [],
    [EDITOR_ACTIONS.replace]: ['Ctrl+F'],
    [EDITOR_ACTIONS.quickDocumentation]: ['Ctrl+Shift+Space', 'F2'],
    [EDITOR_ACTIONS.parameterInfo]: [],
    [EDITOR_ACTIONS.rename]: ['Alt+Shift+R'],
    [EDITOR_ACTIONS.format]: ['Ctrl+Alt+L', 'Ctrl+Shift+F'],
    // The numpad's: -, +, Shift and /, *.
    [EDITOR_ACTIONS.fold]: ['Ctrl+-'],
    [EDITOR_ACTIONS.unfold]: ['Ctrl++'],
    [EDITOR_ACTIONS.foldAll]: ['Ctrl+Shift+/'],
    [EDITOR_ACTIONS.unfoldAll]: ['Ctrl+*'],
    [EDITOR_ACTIONS.nextProblem]: [],
    [EDITOR_ACTIONS.previousProblem]: ['Shift+F1'],
  },
};

export const ECLIPSE_MAC: KeymapPreset = {
  id: 'eclipse-mac',
  name: 'Eclipse (macOS)',
  parent: INTELLIJ_MAC,
  bindings: {
    'diff.nextDifference': ['Ctrl+F7'],
    'vcs.update': [],
    'class.goTo': ['Meta+Shift+T'],
    'file.goTo': ['Meta+Shift+R'],
    'action.find': ['Meta+3'],
    'find.inFiles': ['Ctrl+H'],
    'replace.inFiles': [],
    'navigate.back': ['Meta+['],
    'navigate.forward': ['Meta+]'],
    'navigate.goToLine': ['Meta+L'],
    'navigate.fileStructure': ['Meta+O'],
    'edit.undo': ['Meta+Z'],
    'edit.redo': ['Meta+Shift+Z'],
    'view.tool.project': [],
    'view.tool.bookmarks': [],
    'changes.jumpToSource': ['F3'],
    'problems.jumpToSource': ['F3'],
    'changes.rollback': ['Ctrl+Alt+Shift+Z'],
    'changes.expandAll': ['Meta+Shift+*'],
    'changes.collapseAll': ['Meta+Shift+/'],
    'image.zoomIn': ['Meta+Shift+*'],
    'image.zoomOut': ['Meta+Shift+/'],
    'changes.commit': [],
    [EDITOR_ACTIONS.goToDefinition]: ['F3'],
    [EDITOR_ACTIONS.findUsages]: ['Meta+Shift+G'],
    [EDITOR_ACTIONS.contextActions]: ['Meta+1'],
    [EDITOR_ACTIONS.find]: [],
    [EDITOR_ACTIONS.replace]: [],
    [EDITOR_ACTIONS.quickDocumentation]: ['F2'],
    [EDITOR_ACTIONS.parameterInfo]: ['Ctrl+Shift+Space'],
    [EDITOR_ACTIONS.nextProblem]: ['Meta+.'],
    [EDITOR_ACTIONS.previousProblem]: ['Meta+Shift+>'],
    [EDITOR_ACTIONS.format]: ['Meta+Shift+F'],
    [EDITOR_ACTIONS.fold]: ['Meta+-'],
    [EDITOR_ACTIONS.unfold]: ['Meta++'],
    [EDITOR_ACTIONS.foldAll]: ['Meta+Shift+/'],
    [EDITOR_ACTIONS.unfoldAll]: ['Meta+*'],
  },
};

export const EMACS: KeymapPreset = {
  id: 'emacs',
  name: 'Emacs',
  parent: INTELLIJ,
  bindings: {
    'class.goTo': ['Alt+Shift+G'],
    'file.goTo': ['Ctrl+X Ctrl+F'],
    'action.find': ['Alt+X'],
    'navigate.goToLine': ['Alt+G'],
    'view.recentFiles': [],
    'file.saveAll': ['Ctrl+X Ctrl+S'],
    'editor.close': ['Ctrl+F4', 'Ctrl+X K', 'Ctrl+X 0'],
    'edit.undo': ['Ctrl+Shift+_', 'Ctrl+/'],
    'edit.redo': ['Ctrl+Shift+Z', 'Alt+Shift+_'],
    'edit.cut': ['Shift+Delete'],
    'edit.copy': ['Ctrl+Insert', 'Alt+C'],
    'edit.paste': ['Shift+Insert', 'Ctrl+Y'],
    'changes.amend': [],
    [EDITOR_ACTIONS.goToDefinition]: ['Ctrl+Alt+G', 'Alt+.'],
    [EDITOR_ACTIONS.findUsages]: ['Alt+F7', 'Alt+Shift+S'],
    [EDITOR_ACTIONS.find]: ['Ctrl+Alt+S', 'Alt+F3', 'Ctrl+S'],
    [EDITOR_ACTIONS.replace]: ['Alt+Shift+5'],
    [EDITOR_ACTIONS.complete]: ['Alt+/'],
    [EDITOR_ACTIONS.parameterInfo]: ['Alt+Shift+P'],
    [EDITOR_ACTIONS.nextProblem]: ['F2', 'Ctrl+X `'],
    [EDITOR_ACTIONS.previousProblem]: ['Shift+F2', 'Ctrl+Shift+X `'],
    [EDITOR_ACTIONS.format]: [],
    [EDITOR_ACTIONS.foldAll]: [],
  },
};

export const INTELLIJ_CLASSIC: KeymapPreset = {
  id: 'intellij-classic',
  name: 'IntelliJ IDEA Classic (macOS)',
  parent: forMac(INTELLIJ),
  bindings: {
    'find.inFiles': ['Ctrl+Shift+F'],
    'replace.inFiles': ['Ctrl+Shift+R'],
    'file.new': ['Ctrl+Shift+N'],
    'file.settings': ['Meta+,'],
    'edit.undo': ['Meta+Z'],
    'view.darkTheme': ['Ctrl+`'],
    'view.tool.project': ['Meta+1'],
    'view.tool.bookmarks': ['Meta+2'],
    'view.tool.problems': ['Meta+6'],
    'view.tool.structure': ['Meta+7'],
    'view.tool.services': ['Meta+8'],
    'view.tool.git': ['Meta+9'],
    'view.tool.commit': ['Meta+0'],
    'changes.groupByDirectory': ['Ctrl+P'],
    'changes.amend': ['Ctrl+Alt+M'],
    [EDITOR_ACTIONS.goToDefinition]: ['Meta+B'],
    // Its file gives Ctrl+Space, over the swap's Meta+Space.
    [EDITOR_ACTIONS.complete]: ['Ctrl+Space'],
    [EDITOR_ACTIONS.quickDocumentation]: ['Ctrl+J'],
  },
};

export const MACOS_SYSTEM: KeymapPreset = {
  id: 'macos-system',
  name: 'macOS System Shortcuts',
  parent: INTELLIJ_MAC,
  bindings: {
    'diff.nextDifference': ['Meta+]', 'F7'],
    'diff.previousDifference': ['Meta+[', 'Shift+F7'],
    'action.find': ['Meta+Shift+P', 'Meta+Shift+A'],
    'navigate.back': ['Meta+['],
    'navigate.forward': ['Meta+]'],
    'file.new': ['Ctrl+Shift+N'],
    'view.tool.terminal': ['Ctrl+Meta+T', 'Alt+F12'],
    'changes.jumpToSource': ['F4'],
    'problems.jumpToSource': ['F4'],
    [EDITOR_ACTIONS.findUsages]: ['Ctrl+U', 'Alt+F7'],
    [EDITOR_ACTIONS.quickDocumentation]: ['Meta+I', 'F1'],
    [EDITOR_ACTIONS.rename]: ['Meta+Alt+R', 'Shift+F6'],
    [EDITOR_ACTIONS.nextProblem]: ['Ctrl+,', 'F2'],
    [EDITOR_ACTIONS.previousProblem]: ['Ctrl+Shift+<', 'Shift+F2'],
    'navigate.fileStructure': ['Meta+Shift+7', 'Meta+F12'],
    [EDITOR_ACTIONS.foldAll]: ['Alt+Shift+_'],
    [EDITOR_ACTIONS.unfoldAll]: ['Alt+Shift++'],
  },
};

export const NETBEANS: KeymapPreset = {
  id: 'netbeans',
  name: 'NetBeans',
  parent: INTELLIJ,
  bindings: {
    'symbol.goTo': ['Ctrl+Alt+Shift+O'],
    'class.goTo': ['Ctrl+O'],
    'file.goTo': ['Alt+Shift+O'],
    'action.find': ['Ctrl+I'],
    'replace.inFiles': ['Ctrl+Shift+H'],
    'navigate.back': ['Alt+Left'],
    'navigate.forward': ['Alt+Right'],
    'view.recentFiles': ['Shift+F4'],
    'file.saveAll': ['Ctrl+S', 'Ctrl+Shift+S'],
    'editor.close': ['Ctrl+F4', 'Ctrl+W'],
    'editor.copyPath': [],
    'edit.redo': ['Ctrl+Shift+Z', 'Alt+Shift+Backspace', 'Ctrl+Y'],
    'view.tool.project': ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Alt+1'],
    'view.tool.bookmarks': [],
    'view.tool.problems': ['Alt+6', 'Ctrl+6'],
    'view.tool.structure': ['Ctrl+7', 'Alt+7'],
    'changes.commit': [],
    [EDITOR_ACTIONS.replace]: ['Ctrl+H'],
    [EDITOR_ACTIONS.complete]: ['Ctrl+Space', 'Ctrl+\\'],
    [EDITOR_ACTIONS.rename]: ['Ctrl+R'],
    [EDITOR_ACTIONS.format]: ['Alt+Shift+F'],
    [EDITOR_ACTIONS.nextProblem]: ['F2', 'Ctrl+.'],
    [EDITOR_ACTIONS.previousProblem]: ['Shift+F2', 'Ctrl+,'],
    'navigate.fileStructure': ['Ctrl+F12', 'Ctrl+Shift+F12'],
  },
};

export const SUBLIME: KeymapPreset = {
  id: 'sublime',
  name: 'Sublime Text',
  parent: INTELLIJ,
  bindings: {
    'vcs.update': [],
    'symbol.goTo': ['Ctrl+Shift+R'],
    'class.goTo': [],
    'file.goTo': ['Ctrl+P'],
    'action.find': ['Ctrl+Shift+P'],
    'replace.inFiles': [],
    'navigate.back': ['Alt+-'],
    'navigate.forward': ['Alt+Shift+-', 'Alt+Shift+_'],
    'editor.close': ['Ctrl+F4', 'Ctrl+W'],
    'edit.redo': ['Ctrl+Shift+Z', 'Ctrl+Y'],
    'edit.paste': ['Ctrl+Shift+V'],
    'changes.commit': [],
    'vcs.push': [],
    [EDITOR_ACTIONS.goToDefinition]: ['F12'],
    [EDITOR_ACTIONS.find]: ['Ctrl+F'],
    [EDITOR_ACTIONS.replace]: ['Ctrl+H'],
    [EDITOR_ACTIONS.quickDocumentation]: [],
    [EDITOR_ACTIONS.parameterInfo]: [],
    [EDITOR_ACTIONS.nextProblem]: [],
    [EDITOR_ACTIONS.previousProblem]: [],
    'navigate.fileStructure': ['Ctrl+R'],
    [EDITOR_ACTIONS.fold]: ['Ctrl+Shift+{'],
    [EDITOR_ACTIONS.unfold]: ['Ctrl+Shift+}'],
    [EDITOR_ACTIONS.foldAll]: ['Ctrl+K Ctrl+1'],
    [EDITOR_ACTIONS.unfoldAll]: ['Ctrl+K Ctrl+J', 'Ctrl+K Ctrl+0'],
  },
};

export const SUBLIME_MAC: KeymapPreset = {
  id: 'sublime-mac',
  name: 'Sublime Text (macOS)',
  parent: INTELLIJ_MAC,
  bindings: {
    'vcs.update': [],
    'symbol.goTo': ['Meta+Shift+R'],
    'class.goTo': [],
    'file.goTo': ['Meta+P', 'Meta+T'],
    'action.find': ['Meta+Shift+P'],
    'replace.inFiles': [],
    'navigate.back': ['Ctrl+-'],
    'navigate.forward': ['Ctrl+Shift+-', 'Ctrl+Shift+_'],
    'navigate.goToLine': ['Ctrl+G'],
    'navigate.fileStructure': ['Meta+R'],
    'edit.redo': ['Meta+Y', 'Meta+Shift+Z'],
    'edit.paste': ['Meta+Shift+V'],
    'changes.jumpToSource': [],
    'problems.jumpToSource': [],
    'changes.commit': [],
    [EDITOR_ACTIONS.goToDefinition]: ['F12', 'Meta+Alt+Down'],
    [EDITOR_ACTIONS.replace]: ['Meta+Alt+F'],
    [EDITOR_ACTIONS.quickDocumentation]: [],
    [EDITOR_ACTIONS.parameterInfo]: [],
    [EDITOR_ACTIONS.nextProblem]: [],
    [EDITOR_ACTIONS.previousProblem]: [],
    [EDITOR_ACTIONS.fold]: ['Meta+Alt+['],
    [EDITOR_ACTIONS.unfold]: ['Meta+Alt+]'],
    [EDITOR_ACTIONS.foldAll]: ['Meta+K Meta+1'],
    [EDITOR_ACTIONS.unfoldAll]: ['Meta+K Meta+J', 'Meta+K Meta+0'],
  },
};

export const VISUAL_STUDIO: KeymapPreset = {
  id: 'visual-studio',
  name: 'Visual Studio',
  parent: INTELLIJ,
  bindings: {
    'diff.nextDifference': ['F7', 'F8'],
    'diff.previousDifference': ['Shift+F7', 'Shift+F8'],
    'vcs.update': ['Ctrl+Alt+W'],
    'symbol.goTo': ['Ctrl+Alt+Shift+T'],
    'class.goTo': [],
    'file.goTo': ['Ctrl+Shift+T'],
    'replace.inFiles': ['Ctrl+Shift+H'],
    'navigate.back': ['Ctrl+-'],
    'navigate.forward': ['Ctrl+Shift+_', 'Ctrl+Shift+-'],
    'navigate.goToLine': ['Ctrl+G'],
    'navigate.fileStructure': ['Alt+\\'],
    'view.recentFiles': ['Ctrl+,'],
    'file.saveAll': ['Ctrl+Shift+S'],
    'edit.redo': ['Ctrl+Y', 'Ctrl+Shift+Z', 'Alt+Shift+Backspace'],
    'edit.cut': ['Ctrl+X', 'Shift+Delete'],
    'edit.copy': ['Ctrl+C', 'Ctrl+Insert'],
    'edit.paste': ['Ctrl+V', 'Shift+Insert'],
    'view.darkTheme': [],
    'view.tool.project': ['Ctrl+Alt+L', 'Alt+1'],
    'view.tool.structure': ['Ctrl+Alt+F'],
    'view.tool.services': [],
    'view.tool.commit': [],
    'view.tool.terminal': ['Ctrl+Alt+1'],
    'changes.commit': ['Ctrl+Alt+K'],
    [EDITOR_ACTIONS.goToDefinition]: ['F12'],
    [EDITOR_ACTIONS.findUsages]: ['Shift+F12'],
    [EDITOR_ACTIONS.contextActions]: ['Alt+Enter', 'Ctrl+.', 'Alt+Shift+F10'],
    [EDITOR_ACTIONS.replace]: ['Ctrl+H'],
    [EDITOR_ACTIONS.complete]: ['Ctrl+Space', 'Ctrl+J'],
    [EDITOR_ACTIONS.quickDocumentation]: ['Ctrl+K I', 'Ctrl+K Ctrl+I', 'Ctrl+Shift+F1'],
    [EDITOR_ACTIONS.parameterInfo]: ['Ctrl+Shift+Space'],
    [EDITOR_ACTIONS.rename]: ['Ctrl+R R', 'Ctrl+R Ctrl+R'],
    [EDITOR_ACTIONS.format]: [
      'Ctrl+Alt+Enter',
      'Ctrl+K F',
      'Ctrl+K Ctrl+F',
      'Ctrl+K D',
      'Ctrl+K Ctrl+D',
    ],
    [EDITOR_ACTIONS.fold]: ['Ctrl+M S', 'Ctrl+M Ctrl+S'],
    [EDITOR_ACTIONS.unfold]: ['Ctrl+M E', 'Ctrl+M Ctrl+E'],
    [EDITOR_ACTIONS.foldAll]: ['Ctrl+M A', 'Ctrl+M Ctrl+A'],
    [EDITOR_ACTIONS.unfoldAll]: ['Ctrl+M X', 'Ctrl+M Ctrl+X'],
    [EDITOR_ACTIONS.nextProblem]: ['Alt+PageDown'],
    [EDITOR_ACTIONS.previousProblem]: ['Alt+PageUp'],
  },
};

export const VISUAL_STUDIO_MAC: KeymapPreset = {
  id: 'visual-studio-mac',
  name: 'Visual Studio (macOS)',
  parent: INTELLIJ_MAC,
  bindings: {
    'vcs.update': ['Meta+Alt+W'],
    'symbol.goTo': ['Meta+Alt+Shift+T'],
    'class.goTo': [],
    'file.goTo': ['Meta+Shift+T'],
    'replace.inFiles': ['Meta+Shift+H'],
    'navigate.back': ['Meta+-'],
    'navigate.forward': ['Meta+Shift+_', 'Meta+Shift+-'],
    'navigate.goToLine': ['Meta+G'],
    'navigate.fileStructure': ['Alt+\\'],
    'view.recentFiles': ['Ctrl+,'],
    'file.saveAll': ['Meta+Shift+S'],
    'editor.close': ['Meta+F4'],
    'edit.redo': ['Meta+Y', 'Meta+Shift+Z', 'Alt+Shift+Backspace'],
    'edit.cut': ['Meta+X', 'Shift+Delete', 'Meta+L'],
    'edit.copy': ['Meta+C', 'Meta+Insert'],
    'edit.paste': ['Meta+V', 'Shift+Insert'],
    'view.darkTheme': [],
    'view.tool.project': ['Meta+Alt+L', 'Meta+1'],
    'view.tool.structure': ['Ctrl+Alt+F'],
    'view.tool.services': [],
    'view.tool.commit': [],
    'view.tool.terminal': ['Ctrl+Meta+1'],
    'changes.commit': ['Meta+Alt+Shift+K'],
    [EDITOR_ACTIONS.goToDefinition]: ['F12'],
    [EDITOR_ACTIONS.findUsages]: ['Shift+F12'],
    [EDITOR_ACTIONS.replace]: ['Ctrl+H'],
    [EDITOR_ACTIONS.complete]: ['Ctrl+Space', 'Ctrl+J'],
    [EDITOR_ACTIONS.quickDocumentation]: ['Meta+K I', 'Meta+K Meta+I', 'Ctrl+Shift+F1'],
    [EDITOR_ACTIONS.rename]: ['Meta+R R', 'Meta+R Meta+R'],
    [EDITOR_ACTIONS.format]: [
      'Meta+Alt+Enter',
      'Meta+K F',
      'Meta+K Meta+F',
      'Meta+K D',
      'Meta+K Meta+D',
    ],
    // Its file's own, with Ctrl (`control M`), as Visual Studio's on Windows.
    [EDITOR_ACTIONS.fold]: ['Ctrl+M S', 'Ctrl+M Ctrl+S'],
    [EDITOR_ACTIONS.unfold]: ['Ctrl+M E', 'Ctrl+M Ctrl+E'],
    [EDITOR_ACTIONS.foldAll]: ['Ctrl+M A', 'Ctrl+M Ctrl+A'],
    [EDITOR_ACTIONS.unfoldAll]: ['Ctrl+M X', 'Ctrl+M Ctrl+X'],
    [EDITOR_ACTIONS.nextProblem]: ['Alt+PageDown'],
    [EDITOR_ACTIONS.previousProblem]: ['Alt+PageUp'],
  },
};

/** By name. */
export const PRESETS: readonly KeymapPreset[] = [
  ECLIPSE,
  ECLIPSE_MAC,
  EMACS,
  INTELLIJ,
  INTELLIJ_MAC,
  INTELLIJ_CLASSIC,
  MACOS_SYSTEM,
  NETBEANS,
  SUBLIME,
  SUBLIME_MAC,
  VISUAL_STUDIO,
  VISUAL_STUDIO_MAC,
  VSCODE,
  VSCODE_MAC,
];

/** The key each character is typed with Shift on, on a US keyboard. */
const UNSHIFTED: Readonly<Record<string, string>> = {
  '~': '`',
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
};

/** A sequence as CodeMirror writes it: `Ctrl+K Ctrl+T` is `Ctrl-k Ctrl-t`. */
export function codeMirrorKey(sequence: string): string {
  return sequence
    .split(' ')
    .map((chord) => {
      const plus = chord.endsWith('++');
      const parts = plus ? [...chord.slice(0, -2).split('+'), '+'] : chord.split('+');
      const key = parts.pop() as string;
      // With Shift, a character's key, as CodeMirror finds it: by the character without Shift
      // (`Ctrl-_`), then by its key with (`Ctrl-Shift--`), measured. Its key, as the other keys.
      const shifted = parts.includes('Shift') ? UNSHIFTED[key] : undefined;
      const name = shifted ?? (key.length === 1 ? key.toLowerCase() : key);
      return [...parts, name].join('-');
    })
    .join(' ');
}

/**
 * The editor's actions' keys in a keymap, for its editors. Undo and Redo have none there: the Edit
 * commands' keys run them (edit.ts), so the editor doesn't too.
 */
export function editorKeys(keymap: Keymap): EditorKeys {
  return {
    ...Object.fromEntries(
      Object.entries(EDITOR_ACTIONS).map(([action, command]) => [
        action,
        keymap.shortcutsFor(command).map(codeMirrorKey),
      ]),
    ),
    undo: [],
    redo: [],
  };
}
