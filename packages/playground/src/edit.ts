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

/** The focused element, inside shadow roots: an editor's content, or its find bar's field. */
function deepActive(): Element | undefined {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active ?? undefined;
}

/** Whether an element is a menu's, its bar's, or the page itself: never what's edited. */
function inMenu(element: Element): boolean {
  return (
    element === document.body || element.closest('.cerebro-menu-layer, .cerebro-menubar') !== null
  );
}

/**
 * Follows the focus. A move inside a shadow root, as from an editor to its find bar, reaches the
 * window as no focus event (the DOM stops one whose target and related target are the same host),
 * so it's also read before each key and press, which come before a menu opens.
 */
function follow(): void {
  const active = deepActive();
  if (active && !inMenu(active)) lastFocused.set(active);
}

/** What the command acts on: what has the focus, or had it before a menu took it. */
function target(): Element | undefined {
  const active = deepActive();
  return active && !inMenu(active) ? active : lastFocused.peek();
}

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
  const focused = target();
  if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
  if ((action === 'undo' || action === 'redo') && focused && editorHistory(focused, action)) return;
  const app = window.cerebro?.menu;
  if (app) app.edit(action);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- a browser's only way to run them
  else document.execCommand(action);
}

/** Registers the Edit commands, and follows the focus for them. */
export function setupEdit(commands: CommandRegistry): void {
  for (const type of ['focusin', 'keydown', 'pointerdown']) {
    window.addEventListener(type, follow, true);
  }
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
