// Edit → Undo, Redo, Cut, Copy and Paste, as IntelliJ's: they act on what had the focus before the
// menu opened (a menu takes it while open), and their keys are the keymap's. Undo and Redo in a code
// editor are its own history's; elsewhere, and Cut, Copy and Paste everywhere, they're the system's,
// through the app (a page can't paste on its own), or the browser's in a plain browser. In a code
// editor, Undo and Redo say what they'd do ("Undo Typing"), and are enabled only when there's
// something to do, as IntelliJ's (UndoManagerImpl); elsewhere they need somewhere to type, as Cut and
// Paste do. Copy needs that or a selection; in a terminal, it copies the terminal's selection. A
// terminal takes typing and pastes, but its text is the shell's: nothing is cut from it or undone.
// Duplicate Line or Selection is the code editor's alone, in one that can be changed.

import type { CommandRegistry } from '@cerebro-ide/commands';
import { focusedElement } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import {
  editorDuplicate,
  editorHistory,
  historyNamesIn,
  inChangeableEditor,
} from '@cerebro-ide/ui-editor';

export type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste';

/**
 * The element that last had the focus outside a menu, inside shadow roots (an editor's): a signal,
 * so the menus' enabled items follow it.
 */
const lastFocused = signal<Element | undefined>(undefined);

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
  const active = focusedElement();
  if (!inMenu(active)) lastFocused.set(active);
}

/** What last had the focus outside a menu, while it's still on the page (a closed editor isn't). */
function last(): Element | undefined {
  const focused = lastFocused.get();
  return focused?.isConnected ? focused : undefined;
}

/** What a command acts on: what has the focus, or had it before a menu took it. */
export function target(): Element | undefined {
  const active = focusedElement();
  return inMenu(active) ? last() : active;
}

/**
 * Where text is typed: a text field, or an editable code editor; not a read-only one, whose content
 * is `contenteditable` all the same (CodeMirror's `readOnly` keeps its caret).
 */
function editable(element: Element | undefined): boolean {
  if (!element) return false;
  if (element.closest('.cm-content')) return inChangeableEditor(element);
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    const text = ['text', 'search', 'url', 'email', 'tel', 'password', 'number'];
    return text.includes(element.type) && !element.readOnly && !element.disabled;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/** Where text is typed and can be changed: not a terminal, which only takes what's typed. */
function changeable(element: Element | undefined): boolean {
  return editable(element) && !element?.closest('.cerebro-terminal');
}

/** Whether there's text to copy: somewhere to type, a read-only editor, or a selection. */
function copyable(): boolean {
  const focused = last();
  if (editable(focused) || focused?.closest('.cm-content')) return true;
  return (document.getSelection()?.toString() ?? '') !== '';
}

/** What Undo or Redo would do in the editor that last had the focus; undefined outside one. */
function history(action: 'undo' | 'redo'): { name: string | undefined } | undefined {
  const focused = last();
  const names = focused && historyNamesIn(focused);
  return names && { name: names[action] };
}

/** Runs an edit action on what last had the focus. */
function run(action: EditAction): void {
  const focused = target();
  if (focused instanceof HTMLElement) focused.focus();
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
    ['cut', 'Cu&t', () => changeable(last())],
    ['copy', '&Copy', copyable],
    ['paste', '&Paste', () => editable(last())],
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
  commands.register({
    id: 'edit.duplicate',
    // IntelliJ's `EditorDuplicate`, which its menu shows with no mnemonic.
    label: 'Duplicate Line or Selection',
    enabled: () => {
      const focused = last();
      return focused !== undefined && inChangeableEditor(focused);
    },
    run: () => {
      const focused = target();
      if (focused instanceof HTMLElement) {
        focused.focus();
        editorDuplicate(focused);
      }
    },
  });
  for (const [action, label] of [
    ['undo', '&Undo'],
    ['redo', '&Redo'],
  ] as const) {
    commands.register({
      id: `edit.${action}`,
      label,
      // IntelliJ's "_Undo {0}", its name cut to 30 characters; a change without one, only "Undo".
      text: () => {
        const name = history(action)?.name?.slice(0, 30);
        return name ? `${label} ${name}` : label;
      },
      enabled: () => {
        const editor = history(action);
        return editor ? editor.name !== undefined : changeable(last());
      },
      run: () => {
        run(action);
      },
    });
  }
}
