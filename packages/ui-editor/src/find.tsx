// Find and Replace in a file, as IntelliJ's bar over the editor: Find (Mod+F in IntelliJ's keymap)
// finds, Replace (Mod+R) also replaces.
// The field searches as it's typed, selecting the first match from the cursor; Enter and Shift+Enter
// (or F3 and Shift+F3 in the editor) go to the next and previous; the count says which match of how
// many. Match Case, Words and Regex sit beside the field (Alt+C, Alt+W, Alt+X), Preserve case beside
// Replace's (Alt+E, IntelliJ's mnemonic). Escape closes it.
// CodeMirror's search keeps the query, highlights the matches and replaces; the bar is Cerebro's.

import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type ChangeSpec,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap, runScopeHandlers, type Panel } from '@codemirror/view';
import { applyCase } from './preserve-case.js';

/** The most matches counted; past it, the count says so. */
export const COUNT_LIMIT = 9999;

/** Which match the selection is, and how many there are; at most COUNT_LIMIT counted. */
export function countMatches(state: EditorState): { current: number; total: number } {
  const query = getSearchQuery(state);
  if (!query.valid) return { current: 0, total: 0 };
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done && total < COUNT_LIMIT; next = cursor.next()) {
    total++;
    if (next.value.from === from && next.value.to === to) current = total;
  }
  return { current, total };
}

/** What can change in a query from the bar. */
type QueryChanges = Partial<
  Pick<SearchQuery, 'search' | 'caseSensitive' | 'wholeWord' | 'regexp' | 'replace'>
>;

/** A query like `query`, with `changes`. */
function changed(query: SearchQuery, changes: QueryChanges): SearchQuery {
  return new SearchQuery({
    search: query.search,
    caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord,
    regexp: query.regexp,
    replace: query.replace,
    ...changes,
  });
}

/** Selects the first match at or after `from`, else the first one; whether there was any. */
function selectFrom(view: EditorView, from: number): boolean {
  const query = getSearchQuery(view.state);
  if (!query.valid) return false;
  const after = query.getCursor(view.state, from).next();
  const match = after.done ? query.getCursor(view.state).next() : after;
  if (match.done) return false;
  view.dispatch({
    selection: EditorSelection.single(match.value.from, match.value.to),
    effects: EditorView.scrollIntoView(match.value.from, { y: 'center' }),
  });
  return true;
}

const setPreserveCase = StateEffect.define<boolean>();

/** Whether Replace gives each replacement the case of what it replaces. */
const preserveCase = StateField.define<boolean>({
  create: () => false,
  update: (on, tr) => tr.effects.reduce((v, e) => (e.is(setPreserveCase) ? e.value : v), on),
});

/**
 * With Preserve case on, gives the text that Replace and Replace All put in the case of the text it
 * replaces, as IntelliJ's. A replacement whose length the case changes (`ß` upper-cased is `SS`) is
 * left as it was: the selection Replace moves on to is where CodeMirror put it.
 */
const casedReplacements = EditorState.transactionFilter.of((tr) => {
  if (!tr.startState.field(preserveCase) || !tr.isUserEvent('input.replace')) return tr;
  const changes: ChangeSpec[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    const cased = applyCase(tr.startState.sliceDoc(from, to), text);
    changes.push({ from, to, insert: cased.length === text.length ? cased : text });
  });
  return {
    changes,
    selection: tr.selection,
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    annotations: Transaction.userEvent.of(tr.annotation(Transaction.userEvent) as string),
  };
});

/**
 * IntelliJ's Preserve Case icon (`platform/icons/src/expui/inline/preserveCase.svg`, Apache 2.0,
 * © JetBrains s.r.o. and contributors): two As, an arrow over them.
 */
export function preserveCaseIcon(): Node {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M1.3695 14H0.1815L3.0085 6.3H4.213L7.139 14H5.984L5.28 12.042H2.013L1.3695 14ZM3.476 7.741L2.321 11.1235H4.95L3.729 7.741L3.6025 7.268L3.476 7.741Z"
        fill="currentColor"
      />
      <path
        d="M9.8695 14H8.6815L11.5085 6.3H12.713L15.639 14H14.484L13.78 12.042H10.513L9.8695 14ZM11.976 7.741L10.821 11.1235H13.45L12.229 7.741L12.1025 7.268L11.976 7.741Z"
        fill="currentColor"
      />
      <path
        d="M7 5.8125L9.40625 3.40625L7 1"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
      />
    </svg>
  );
}

/** The keymap scope of the keys that work both in the editor and in the bar's fields. */
const SCOPE = 'cerebro-find';

/** Each editor's bar, so Mod+R can show replacing in an open one. */
const bars = new WeakMap<EditorView, { replacing: ReturnType<typeof signal<boolean>> }>();

/** The bar's options' keys: by their place, since on macOS Option+C types ç. */
const OPTION_KEYS = { KeyC: 'caseSensitive', KeyW: 'wholeWord', KeyX: 'regexp' } as const;

function findBar(view: EditorView, editable: boolean): Panel {
  const dom = document.createElement('div');
  dom.className = 'cerebro-find';
  // Its options' keys are its own, not the menu bar's mnemonics (Alt+E is Edit's).
  dom.dataset['altKeys'] = 'CWXE';
  // Escape anywhere in the bar (a field, or a button pressed) closes it, back to the editor.
  dom.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeSearchPanel(view);
    view.focus();
  });
  const replacing = signal(false);
  bars.set(view, { replacing });
  /** The query as the bar shows it, kept in step with the editor's. */
  const query = signal(getSearchQuery(view.state));
  const count = signal(countMatches(view.state));
  const update = (changes: QueryChanges, select: boolean) => {
    const next = changed(query.peek(), changes);
    // Where typing started: the match at the cursor stays chosen while it still matches.
    const from = view.state.selection.main.from;
    view.dispatch({ effects: setSearchQuery.of(next) });
    if (select) selectFrom(view, from);
  };
  const toggle = (option: (typeof OPTION_KEYS)[keyof typeof OPTION_KEYS]) => {
    update({ [option]: !query.peek()[option] }, true);
  };
  const preserving = signal(view.state.field(preserveCase));
  const togglePreserve = () => {
    view.dispatch({ effects: setPreserveCase.of(!view.state.field(preserveCase)) });
  };
  const onFindKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.code in OPTION_KEYS) {
      event.preventDefault();
      toggle(OPTION_KEYS[event.code as keyof typeof OPTION_KEYS]);
    } else if (runScopeHandlers(view, event, SCOPE)) {
      // The bar's own keys from the editor (Mod+F, Mod+R, F3) work in its fields too.
      event.preventDefault();
    }
  };
  const option = (
    label: string,
    text: string,
    name: (typeof OPTION_KEYS)[keyof typeof OPTION_KEYS],
  ) => (
    <button
      type="button"
      class="cerebro-find__option"
      aria-label={label}
      title={label}
      aria-pressed={() => String(query.get()[name])}
      on:mousedown={(event) => {
        event.preventDefault();
      }}
      on:click={() => {
        toggle(name);
      }}
    >
      {text}
    </button>
  );
  const button = (label: string, run: () => void) => (
    <button
      type="button"
      class="cerebro-find__button"
      on:click={() => {
        run();
      }}
    >
      {label}
    </button>
  );
  const handle = render(
    () => [
      <div class="cerebro-find__row">
        <input
          class="cerebro-find__field"
          type="text"
          spellcheck={false}
          aria-label="Find"
          placeholder="Find"
          main-field="true"
          value={() => query.get().search}
          on:input={(event) => {
            update({ search: (event.currentTarget as HTMLInputElement).value }, true);
          }}
          on:keydown={onFindKey}
        />
        {option('Match Case (Alt+C)', 'Cc', 'caseSensitive')}
        {option('Words (Alt+W)', 'W', 'wholeWord')}
        {option('Regex (Alt+X)', '.*', 'regexp')}
        <span class="cerebro-find__count">
          {() => {
            const { current, total } = count.get();
            if (query.get().search === '') return '';
            if (total === 0) return '0 results';
            const of = total === COUNT_LIMIT ? `${String(total)}+` : String(total);
            return current === 0 ? `${of} results` : `${String(current)}/${of}`;
          }}
        </span>
        <button
          type="button"
          class="cerebro-find__button"
          aria-label="Previous Occurrence (Shift+Enter)"
          title="Previous Occurrence (Shift+Enter)"
          on:click={() => findPrevious(view)}
        >
          ↑
        </button>
        <button
          type="button"
          class="cerebro-find__button"
          aria-label="Next Occurrence (Enter)"
          title="Next Occurrence (Enter)"
          on:click={() => findNext(view)}
        >
          ↓
        </button>
        <button
          type="button"
          class="cerebro-find__button cerebro-find__close"
          aria-label="Close (Escape)"
          title="Close (Escape)"
          on:click={() => {
            closeSearchPanel(view);
            view.focus();
          }}
        >
          ×
        </button>
      </div>,
      () =>
        editable && replacing.get() ? (
          <div class="cerebro-find__row">
            <input
              class="cerebro-find__field cerebro-find__replace"
              type="text"
              spellcheck={false}
              aria-label="Replace"
              placeholder="Replace"
              value={() => query.get().replace}
              on:input={(event) => {
                update({ replace: (event.currentTarget as HTMLInputElement).value }, false);
              }}
              on:keydown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  replaceNext(view);
                } else if (
                  event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  event.code === 'KeyE'
                ) {
                  event.preventDefault();
                  togglePreserve();
                } else onFindKey(event);
              }}
            />
            <button
              type="button"
              class="cerebro-find__option"
              aria-label="Preserve case (Alt+E)"
              title="Preserve case (Alt+E)"
              aria-pressed={() => String(preserving.get())}
              on:mousedown={(event) => {
                event.preventDefault();
              }}
              on:click={togglePreserve}
            >
              {preserveCaseIcon()}
            </button>
            {button('Replace', () => replaceNext(view))}
            {button('Replace All', () => replaceAll(view))}
          </div>
        ) : null,
    ],
    dom,
  );
  return {
    dom,
    top: true,
    update: (update) => {
      const next = getSearchQuery(update.state);
      if (!next.eq(query.peek())) query.set(next);
      preserving.set(update.state.field(preserveCase));
      if (update.docChanged || update.selectionSet || !next.eq(getSearchQuery(update.startState))) {
        count.set(countMatches(update.state));
      }
    },
    destroy: () => {
      handle.dispose();
      bars.delete(view);
    },
  };
}

/** Opens the bar, replacing too if asked, with the selection's text to find when it's on a line. */
function open(view: EditorView, replace: boolean): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (selected !== '' && !selected.includes('\n')) {
    view.dispatch({
      effects: setSearchQuery.of(changed(getSearchQuery(view.state), { search: selected })),
    });
  }
  const wasOpen = searchPanelOpen(view.state);
  if (!wasOpen) openSearchPanel(view);
  bars.get(view)?.replacing.set(replace);
  // Already open: back to its field, its text selected, as IntelliJ.
  const field = view.dom.querySelector<HTMLInputElement>(
    replace ? '.cerebro-find__replace' : '.cerebro-find__field',
  );
  field?.focus();
  field?.select();
  return true;
}

/** Find, and Replace when the editor can be edited, with the bar and its keys. */
export function findAndReplace(
  editable: boolean,
  keys: { find: readonly string[]; replace: readonly string[] },
): Extension {
  return [
    search({ top: true, createPanel: (view) => findBar(view, editable) }),
    preserveCase,
    casedReplacements,
    keymap.of([
      ...keys.find.map((key) => ({
        key,
        run: (view: EditorView) => open(view, false),
        preventDefault: true,
        scope: `editor ${SCOPE}`,
      })),
      ...(editable ? keys.replace : []).map((key) => ({
        key,
        run: (view: EditorView) => open(view, true),
        preventDefault: true,
        scope: `editor ${SCOPE}`,
      })),
      {
        key: 'F3',
        run: findNext,
        shift: findPrevious,
        preventDefault: true,
        scope: `editor ${SCOPE}`,
      },
      {
        key: 'Escape',
        run: (view) => {
          if (!searchPanelOpen(view.state)) return false;
          closeSearchPanel(view);
          return true;
        },
      },
    ]),
  ];
}
