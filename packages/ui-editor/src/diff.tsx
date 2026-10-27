// A file's diff, side by side as IntelliJ shows it: the last committed text on the left, the
// current one on the right, changed lines marked and unchanged ones aligned. CodeMirror's merge
// view, read-only, in the code editor's look and in a shadow root for the same reason (editor.tsx).
// To merge, the right side can be edited, with an arrow by each change that takes the left's.

import { MergeView } from '@codemirror/merge';
import { syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect } from '@cerebro-ide/reactive';
import { highlight, scroller, selection, theme, variable } from './editor.js';
import { languageFor } from './languages.js';

export interface DiffEditorProps {
  /** The file's path: its language comes from the extension. */
  path: string;
  /** As last committed: empty for a new file. */
  original: string;
  /** As it is now: empty for a deleted file. */
  text: string;
  /** Read reactively. Default: 13. */
  fontSize?: () => number;
  /** Read reactively. Default: 4. */
  tabSize?: () => number;
  /** Makes the right side editable, to merge into it: called with its text as it's edited. */
  onEdit?: (text: string) => void;
}

/** The changes' colours, from the theme's variables: removed on the left, added on the right. */
const diffTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: variable('diff-removed') },
  '&.cm-merge-b .cm-changedLine': { backgroundColor: variable('diff-added') },
  '&.cm-merge-a .cm-changedText': { background: variable('diff-removed-text') },
  '&.cm-merge-b .cm-changedText': { background: variable('diff-added-text') },
  '&.cm-merge-a .cm-changedLineGutter': { background: variable('diff-removed-text') },
  '&.cm-merge-b .cm-changedLineGutter': { background: variable('diff-added-text') },
});

/** A diff of one file: read-only, or editable on the right to merge. */
export function DiffEditor(props: DiffEditorProps): Node {
  const container = document.createElement('div');
  container.className = 'cerebro-editor-diff';
  const shadow = container.attachShadow({ mode: 'open' });
  const language = languageFor(props.path);
  const sides = [new Compartment(), new Compartment()] as const;
  const configure = (): Extension => [
    EditorState.tabSize.of(props.tabSize?.() ?? 4),
    EditorView.theme({ '.cm-scroller': scroller(props.fontSize?.() ?? 13) }),
  ];
  const side = (doc: string, settings: Compartment, onEdit?: (text: string) => void) => ({
    doc,
    extensions: [
      lineNumbers(),
      selection,
      onEdit
        ? EditorView.updateListener.of((update) => {
            if (update.docChanged) onEdit(update.state.doc.toString());
          })
        : EditorState.readOnly.of(true),
      theme,
      diffTheme,
      syntaxHighlighting(highlight),
      ...(language ? [language] : []),
      settings.of(configure()),
    ],
  });
  const view = new MergeView({
    a: side(props.original, sides[0]),
    b: side(props.text, sides[1], props.onEdit),
    parent: shadow,
    root: shadow,
    gutter: true,
    highlightChanges: true,
    ...(props.onEdit ? { revertControls: 'a-to-b' as const } : {}),
  });
  // The merge view grows with its text; its frame scrolls. Set through the style object, which
  // the page's Content-Security-Policy allows.
  view.dom.style.height = '100%';
  view.dom.style.overflow = 'auto';
  const watch = effect(() => {
    const settings = configure();
    view.a.dispatch({ effects: sides[0].reconfigure(settings) });
    view.b.dispatch({ effects: sides[1].reconfigure(settings) });
    return undefined;
  });
  onCleanup(() => {
    watch.dispose();
    view.destroy();
  });
  return container;
}
