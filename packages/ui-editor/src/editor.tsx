// The code editor: CodeMirror 6, in Cerebro's theme (its colours are the theme's CSS variables, so
// it follows dark and light), with the language for the file and the editor settings applied as
// they change. Read-only until the host can save files.
//
// It lives in a shadow root. CodeMirror adds its styles with style-mod, which uses constructable
// stylesheets inside a shadow root but <style> elements in a document, and the page's
// Content-Security-Policy blocks those (`style-src 'self'`). The theme's variables still reach it:
// custom properties are inherited into shadow roots.

import { defaultKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect } from '@cerebro-ide/reactive';
import { tags } from '@lezer/highlight';
import { languageFor } from './languages.js';

export interface CodeEditorProps {
  /** The file's path: its language comes from the extension. */
  path: string;
  text: string;
  /** Read reactively. Default: 13. */
  fontSize?: () => number;
  /** Read reactively. Default: off. */
  softWrap?: () => boolean;
  /** Read reactively. Default: 4. */
  tabSize?: () => number;
  /** A position to show and select: where a definition is. Read reactively; zero-based. */
  reveal?: () => { line: number; column: number } | undefined;
  /** Go to definition of the word at the cursor: Mod+B or Mod+click, as in IntelliJ. */
  onGoToDefinition?: (word: string) => void;
  /** Find usages of the word at the cursor: Alt+F7, as in IntelliJ. */
  onFindUsages?: (word: string) => void;
}

/** The word at a position in the editor, if there is one. */
function wordAt(view: EditorView, pos: number): string | undefined {
  const range = view.state.wordAt(pos);
  return range ? view.state.sliceDoc(range.from, range.to) : undefined;
}

const variable = (name: string) => `var(--cerebro-${name})`;

/** The editor's look, from the theme's variables. */
const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: variable('text'),
    backgroundColor: variable('background'),
  },
  '.cm-scroller': { fontFamily: variable('font-mono'), lineHeight: '1.6' },
  '.cm-gutters': {
    backgroundColor: variable('background'),
    color: variable('text-muted'),
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: variable('editor-active-line') },
  '.cm-activeLineGutter': { backgroundColor: variable('editor-active-line') },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: variable('editor-selection'),
  },
  '&.cm-focused': { outline: 'none' },
});

/** Syntax colours, from the theme's variables. */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: variable('syntax-keyword') },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: variable('syntax-string') },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: variable('syntax-number') },
  { tag: [tags.comment, tags.meta], color: variable('syntax-comment'), fontStyle: 'italic' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: variable('syntax-function'),
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: variable('syntax-type') },
  { tag: [tags.propertyName, tags.attributeName], color: variable('syntax-property') },
  { tag: [tags.tagName, tags.heading], color: variable('syntax-tag'), fontWeight: 'bold' },
]);

/** A read-only code editor for one file. */
export function CodeEditor(props: CodeEditorProps): Node {
  const container = document.createElement('div');
  container.className = 'cerebro-editor-code';
  const shadow = container.attachShadow({ mode: 'open' });
  const settings = new Compartment();
  const configure = () => [
    EditorState.tabSize.of(props.tabSize?.() ?? 4),
    props.softWrap?.() ? EditorView.lineWrapping : [],
    EditorView.theme({ '.cm-scroller': { fontSize: `${String(props.fontSize?.() ?? 13)}px` } }),
  ];
  const language = languageFor(props.path);
  const view = new EditorView({
    parent: shadow,
    root: shadow,
    state: EditorState.create({
      doc: props.text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        EditorState.readOnly.of(true),
        keymap.of([
          {
            key: 'Mod-b',
            run: (v) => {
              const word = wordAt(v, v.state.selection.main.head);
              if (word === undefined || !props.onGoToDefinition) return false;
              props.onGoToDefinition(word);
              return true;
            },
          },
          {
            key: 'Alt-F7',
            run: (v) => {
              const word = wordAt(v, v.state.selection.main.head);
              if (word === undefined || !props.onFindUsages) return false;
              props.onFindUsages(word);
              return true;
            },
          },
          ...defaultKeymap,
        ]),
        EditorView.domEventHandlers({
          mousedown: (event, v) => {
            if (!(event.ctrlKey || event.metaKey) || !props.onGoToDefinition) return false;
            // Not precise: the nearest position, never none.
            const word = wordAt(v, v.posAtCoords({ x: event.clientX, y: event.clientY }, false));
            if (word === undefined) return false;
            event.preventDefault();
            props.onGoToDefinition(word);
            return true;
          },
        }),
        theme,
        syntaxHighlighting(highlight),
        ...(language ? [language] : []),
        settings.of(configure()),
      ],
    }),
  });
  // The settings apply as they change, without rebuilding the editor.
  const watch = effect(() => {
    view.dispatch({ effects: settings.reconfigure(configure()) });
    return undefined;
  });
  // A position to reveal: selected, scrolled to the middle of the editor, and focused, as IntelliJ
  // does after navigating. After the current task, since an editor opened to reveal a position isn't
  // in the document yet, and a detached element can't take the focus.
  const revealing = effect(() => {
    const at = props.reveal?.();
    if (!at) return undefined;
    queueMicrotask(() => {
      if (!container.isConnected) return;
      const line = view.state.doc.line(Math.min(Math.max(at.line + 1, 1), view.state.doc.lines));
      const pos = Math.min(line.from + at.column, line.to);
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      });
      view.focus();
    });
    return undefined;
  });
  onCleanup(() => {
    watch.dispose();
    revealing.dispose();
    view.destroy();
  });
  return container;
}
