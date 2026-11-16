// The editor's own actions, as IntelliJ's editor actions are actions like any other: what binds an
// action to its keys also gives it here (`editorActions`), so the app can run it on an editor from
// a menu, Find Action or a mouse shortcut (`runEditorAction`), and tell where it can
// (`hasEditorAction`). An action's keys stop there once it's run (`stopPropagation`): the app's
// command for it, bound to the same keys, would run it again.

import { Facet } from '@codemirror/state';
import { EditorView, type Command, type KeyBinding } from '@codemirror/view';
import type { EditorKeys } from './editor.js';

/** An editor action: Undo and Redo are the app's Edit commands' (`editorHistory`). */
export type EditorAction = Exclude<keyof EditorKeys, 'undo' | 'redo'>;

/** The actions an editor has, each with what runs it; the first given for an action wins. */
export const editorActions = Facet.define<Partial<Record<EditorAction, Command>>>();

/**
 * An action's keys, for a keymap, and the action given to `editorActions`: its keys stop at the
 * editor once it's run.
 */
export function actionKeys(
  action: EditorAction,
  keys: readonly string[],
  run: Command,
  binding: Omit<KeyBinding, 'key' | 'run'> = {},
): { bindings: KeyBinding[]; action: ReturnType<typeof editorActions.of> } {
  return {
    bindings: keys.map((key) => ({ ...binding, key, run, stopPropagation: true })),
    action: editorActions.of({ [action]: run }),
  };
}

/** The editor `element` is in, if any. */
function viewOf(element: Element): EditorView | undefined {
  const editor = element.closest('.cm-editor');
  return (editor && EditorView.findFromDOM(editor as HTMLElement)) ?? undefined;
}

const commandOf = (view: EditorView, action: EditorAction) =>
  view.state.facet(editorActions).find((given) => given[action])?.[action];

/** Whether the editor `element` is in has the action. */
export function hasEditorAction(element: Element, action: EditorAction): boolean {
  const view = viewOf(element);
  return view !== undefined && commandOf(view, action) !== undefined;
}

/**
 * Runs an action on the editor `element` is in, the keyboard back in it first, as a key would run
 * it there; returns whether it ran.
 */
export function runEditorAction(element: Element, action: EditorAction): boolean {
  const view = viewOf(element);
  const run = view && commandOf(view, action);
  if (!view || !run) return false;
  view.focus();
  return run(view);
}
