// Edit → Undo, Redo, Cut, Copy and Paste, as IntelliJ's: they act on what had the focus before the
// menu opened (a menu takes it while open), and their keys are the keymap's. Undo and Redo in a code
// editor are its own history's; elsewhere, and Cut, Copy and Paste everywhere, they're the system's,
// through the app (a page can't paste on its own), or the browser's in a plain browser. Undo, Redo,
// Cut and Paste need somewhere to type; Copy, that or a selection.

import type { CommandRegistry } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import { editorHistory } from '@cerebro-ide/ui-editor';

export type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste';

/**
 * The element that last had the focus outside a menu, inside shadow roots (an editor's): a signal,
 * so the menus' enabled items follow it.
 */
const lastFocused = signal<Element | undefined>(undefined);

/** Where text is typed: a text field, or an editable code editor. */
function editable(element: Element | undefined): boolean {
  if (!element?.isConnected) return false;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    const text = ['text', 'search', 'url', 'email', 'tel', 'password', 'number'];
    return text.includes(element.type) && !element.readOnly && !element.disabled;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/** Whether there's text to copy: somewhere to type, a read-only editor, or a selection. */
function copyable(): boolean {
  const focused = lastFocused.get();
  if (editable(focused) || focused?.closest('.cm-content')) return true;
  return (document.getSelection()?.toString() ?? '') !== '';
}

/** Runs an edit action on what last had the focus. */
function run(action: EditAction): void {
  const focused = lastFocused.peek();
  if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
  if ((action === 'undo' || action === 'redo') && focused && editorHistory(focused, action)) return;
  const app = window.cerebro?.menu;
  if (app) app.edit(action);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- a browser's only way to run them
  else document.execCommand(action);
}

/** Registers the Edit commands, and follows the focus for them. */
export function setupEdit(commands: CommandRegistry): void {
  window.addEventListener(
    'focusin',
    (event) => {
      const target = event.composedPath()[0];
      if (!(target instanceof Element)) return;
      // A menu, its bar or the toolbar's menu button takes the focus while it's open.
      if (target.closest('.cerebro-menu-layer, .cerebro-menubar')) return;
      lastFocused.set(target);
    },
    true,
  );
  const entries: [EditAction, string, () => boolean][] = [
    ['undo', '&Undo', () => editable(lastFocused.get())],
    ['redo', '&Redo', () => editable(lastFocused.get())],
    ['cut', 'Cu&t', () => editable(lastFocused.get())],
    ['copy', '&Copy', copyable],
    ['paste', '&Paste', () => editable(lastFocused.get())],
  ];
  for (const [action, label, enabled] of entries) {
    commands.register({
      id: `edit.${action}`,
      label,
      enabled,
      run: () => {
        run(action);
      },
    });
  }
}
