// The editor's actions as commands, as IntelliJ's editor actions are actions like any other: named
// as IntelliJ names them (ActionsBundle's texts, read from its source), so Find Action finds them and
// the Keymap page changes their keys. Each runs on the editor that has the keyboard, or had it
// before a menu took it, and is on where that editor has it (`hasEditorAction`). Their keys are the
// editor's own (`editorKeys`), which stop there once run; the commands take them where no editor
// ran them. Rename is the Project view's too (`rename-file.ts`). They're in the menus where
// IntelliJ's are (its LangActions.xml and PlatformActions.xml), among Cerebro's own items.

import type { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
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
  codeBlockStart: 'Move Caret to Code Block Start',
  codeBlockEnd: 'Move Caret to Code Block End',
  codeBlockStartWithSelection: 'Move Caret to Code Block Start with Selection',
  codeBlockEndWithSelection: 'Move Caret to Code Block End with Selection',
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

/**
 * What a mouse shortcut was pressed on, as the command it runs is given it. Its editor actions act
 * on the editor there, or on none: as IntelliJ's mouse shortcuts take their data context from the
 * component under the pointer (IdeMouseEventDispatcher), not from the one with the keyboard. A
 * middle click on a tab, which closes it, doesn't go to the declaration at an editor's caret.
 */
export interface Pointed {
  readonly pointed: Element;
}

/** The editor an action acts on: the one pointed at, or the one with the keyboard. */
function editorFor(context: unknown): Element | undefined {
  return typeof context === 'object' && context !== null && 'pointed' in context
    ? (context as Pointed).pointed
    : target();
}

/**
 * Whether the editor with the keyboard, or that had it before a menu, has the action; or the one
 * a mouse shortcut was pressed on (`Pointed`).
 */
export function editorHas(action: EditorAction, context?: unknown): boolean {
  const element = editorFor(context);
  return element !== undefined && hasEditorAction(element, action);
}

/** Runs the action on that editor; returns whether it ran. */
export function runInEditor(action: EditorAction, context?: unknown): boolean {
  const element = editorFor(context);
  return element !== undefined && runEditorAction(element, action);
}

/** Registers the editor's actions as commands, in the menus. */
export function setupEditorActions(commands: CommandRegistry, menus: MenuRegistry): void {
  for (const [action, label] of Object.entries(LABELS) as [EditorAction, string][]) {
    commands.register({
      id: EDITOR_ACTIONS[action],
      label,
      dialog: action === 'find' || action === 'replace',
      enabled: (context) => editorHas(action, context),
      run: (context) => {
        runInEditor(action, context);
      },
    });
  }
  contributeMenus(menus);
}

/**
 * Their places in the menus, as IntelliJ's: its groups' order, a separator between them, and its
 * texts for the Navigate menu (`action.{id}.MainMenu.text`).
 */
function contributeMenus(menus: MenuRegistry): void {
  const add = (menu: string, action: EditorAction, group: string, label?: string) =>
    menus.contribute({
      menu,
      item: { command: EDITOR_ACTIONS[action], ...(label === undefined ? {} : { label }) },
      group,
    });
  const submenu = (menu: string, submenu: string, label: string, group: string) =>
    menus.contribute({ menu, item: { submenu, label }, group });
  // Code, after Navigate, and Refactor after it, as IntelliJ's `CodeMenu` and `RefactoringMenu`.
  menus.contribute({ menu: 'main', item: { submenu: 'main/code', label: '&Code' }, order: 5 });
  menus.contribute({
    menu: 'main',
    item: { submenu: 'main/refactor', label: '&Refactor' },
    order: 6,
  });
  submenu('main/code', 'main/code/completion', 'Code &Completion', 'a');
  add('main/code/completion', 'complete', 'a');
  submenu('main/code', 'main/code/folding', 'Folding', 'b');
  add('main/code/folding', 'unfold', 'a');
  add('main/code/folding', 'unfoldAll', 'a');
  add('main/code/folding', 'fold', 'b');
  add('main/code/folding', 'foldAll', 'b');
  // `CommentGroup` and `CodeFormatGroup`: Optimize Imports after Reformat Code (main.tsx).
  add('main/code', 'lineComment', 'c');
  add('main/code', 'blockComment', 'c');
  add('main/code', 'format', 'c');
  add('main/code', 'moveLineDown', 'd');
  add('main/code', 'moveLineUp', 'd');
  add('main/refactor', 'rename', 'a');
  // Navigate: `GoToErrorGroup`, `NavigateInFileGroup`, then `GoToCodeGroup` after Select In.
  add('main/navigate', 'nextProblem', 'a2');
  add('main/navigate', 'previousProblem', 'a2');
  add('main/navigate', 'methodDown', 'a3');
  add('main/navigate', 'methodUp', 'a3');
  add('main/navigate', 'goToDefinition', 'b2', '&Declaration or Usages');
  add('main/navigate', 'goToImplementation', 'b2', 'I&mplementation(s)');
  add('main/navigate', 'goToTypeDeclaration', 'b2', '&Type Declaration');
  add('main/navigate', 'goToSuperMethod', 'b2', 'S&uper Method');
  // Edit: `FindMenuGroup`'s first (Find in Files after them, main.tsx); `EditSelectWordGroup`, at
  // `EditSelectGroup`'s end; `EditSmartGroup`'s first, before Duplicate Line or Selection.
  add('main/edit/find', 'find', 'a');
  add('main/edit/find', 'replace', 'a');
  add('main/edit', 'extendSelection', 'r');
  add('main/edit', 'shrinkSelection', 'r');
  for (const [order, action] of [
    [-2, 'toggleCase'],
    [-1, 'joinLines'],
  ] as const) {
    menus.contribute({
      menu: 'main/edit',
      item: { command: EDITOR_ACTIONS[action] },
      group: 's',
      order,
    });
  }
  // View: `QuickActions`, after the window's look (Tool Windows here, before Recent Files).
  add('main/view', 'quickDefinition', 'b2');
  add('main/view', 'quickDocumentation', 'b2');
}
