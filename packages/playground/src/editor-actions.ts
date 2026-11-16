// The editor's actions as commands, as IntelliJ's editor actions are actions like any other: named
// as IntelliJ names them (ActionsBundle's texts, read from its source), so Find Action finds them and
// the Keymap page changes their keys. Each runs on the editor that has the keyboard, or had it
// before a menu took it, and is on where that editor has it (`hasEditorAction`). Their keys are the
// editor's own (`editorKeys`), which stop there once run; the commands take them where no editor
// ran them. Rename is the Project view's too (`rename-file.ts`).

import type { CommandRegistry } from '@cerebro-ide/commands';
import { hasEditorAction, runEditorAction, type EditorAction } from '@cerebro-ide/ui-editor';
import { target } from './edit.js';
import { EDITOR_ACTIONS } from './keymaps.js';

/**
 * IntelliJ's names for them (`action.{id}.text`), its mnemonics as `&`; Find's and Replace's
 * ellipsis is `dialog`'s.
 */
const LABELS: Readonly<Record<Exclude<EditorAction, 'rename'>, string>> = {
  goToDefinition: 'Go to Declaration or Usages',
  goToImplementation: 'Go to I&mplementation(s)',
  goToTypeDeclaration: 'Go to Type Declaration',
  goToSuperMethod: 'Go to Super Method',
  methodDown: 'N&ext Method',
  methodUp: 'Prev&ious Method',
  findUsages: 'Find &Usages',
  complete: '&Basic',
  quickDocumentation: 'Quick &Documentation',
  quickDefinition: 'Quic&k Definition',
  parameterInfo: '&Parameter Info',
  format: '&Reformat Code',
  fold: '&Collapse',
  unfold: 'E&xpand',
  foldAll: 'Collapse &All',
  unfoldAll: '&Expand All',
  nextProblem: '&Next Highlighted Error',
  previousProblem: '&Previous Highlighted Error',
  contextActions: 'Show Context Actions',
  lineComment: 'Comment with &Line Comment',
  blockComment: 'Comment with &Block Comment',
  moveLineUp: 'Move Line &Up',
  moveLineDown: 'Move Line Do&wn',
  deleteLine: 'Delete Line',
  startNewLine: 'Start New Line',
  startNewLineBefore: 'Start New Line Before Current',
  splitLine: 'Split Line',
  joinLines: 'Join Lines',
  toggleCase: 'Toggle Case',
  expandWord: 'Cyclic &Expand Word',
  expandWordBackward: 'Cyclic &Expand Word (Backward)',
  matchBrace: 'Move Caret to Matching Brace',
  extendSelection: 'Extend Selection',
  shrinkSelection: 'Shrink Selection',
  scrollUp: 'Scroll Up',
  scrollDown: 'Scroll Down',
  scrollToCenter: 'Scroll to Center',
  pageTop: 'Move Caret to Page Top',
  pageBottom: 'Move Caret to Page Bottom',
  pageTopWithSelection: 'Move Caret to Page Top with Selection',
  pageBottomWithSelection: 'Move Caret to Page Bottom with Selection',
  find: '&Find',
  replace: '&Replace',
};

/** Whether the editor with the keyboard, or that had it before a menu, has the action. */
export function editorHas(action: EditorAction): boolean {
  const element = target();
  return element !== undefined && hasEditorAction(element, action);
}

/** Runs the action on that editor; returns whether it ran. */
export function runInEditor(action: EditorAction): boolean {
  const element = target();
  return element !== undefined && runEditorAction(element, action);
}

/** Registers the editor's actions as commands. */
export function setupEditorActions(commands: CommandRegistry): void {
  for (const [action, label] of Object.entries(LABELS) as [EditorAction, string][]) {
    commands.register({
      id: EDITOR_ACTIONS[action],
      label,
      dialog: action === 'find' || action === 'replace',
      enabled: () => editorHas(action),
      run: () => {
        runInEditor(action);
      },
    });
  }
}
