// The Structure tool window, as IntelliJ's (StructureViewWrapperImpl and StructureViewComponent,
// read from its source): the symbols of the active editor's file, as a tree, from its language
// server, as File Structure's popup lists them, read again as the file changes. With IntelliJ's
// defaults (StructureViewFactoryImpl): selecting a symbol shows it in the editor (Autoscroll to
// Source), the focus staying in the tree; double click or Enter goes to it, the editor focused; it
// doesn't follow the caret (Autoscroll from Source is off). Its empty texts are IntelliJ's
// (LangBundle's `panel.empty.text.no.structure`, `status.text.structure.empty`).
// Its title's buttons, as IntelliJ's new UI (StructureViewWrapperImpl: `getViewActions` in View
// Options, `getDotsActions` in the gear's menu): View Options, its Sort heading over Alphabetically
// (`Sorter.ALPHA_SORTER`, names compared ignoring case, off to start with); Options, with Expand
// All and Collapse All, then IntelliJ's two Autoscrolls under their words, Navigate with Single
// Click (to source, on) and Always Select Opened Element (from source, off: a second after the
// caret moves, the innermost symbol holding it selected, without showing it again). The language's
// own filters and groupings aren't there: JavaScript's aren't in IntelliJ's open source. Kept in
// the browser's storage, one for every project (IntelliJ keeps them per project): Claude's choice,
// open to change.

import { onCleanup } from '@cerebro-ide/jsx';
import { effect, signal, untracked } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { TreeModel, TreeView, type TreeRow } from '@cerebro-ide/ui-tree';
import type { EditorDocument } from '@cerebro-ide/ui-editor';
import { symbolIcon } from './icons.js';
import type { FileSymbol } from './structure.js';

interface Place {
  path: string;
  line: number;
  column: number;
}

/** How long after an edit the symbols are asked for again: once typing pauses (a claim). */
export const UPDATE_DELAY = 300;

/** How long after the caret moves Always Select Opened Element selects (IntelliJ's alarm's). */
export const FOLLOW_DELAY = 1000;

const SETTINGS_KEY = 'cerebro.structure';

/** The window's settings, as kept; IntelliJ's defaults (`StructureViewFactoryImpl.State`). */
export function readStructureSettings(): {
  alphabetical: boolean;
  toSource: boolean;
  fromSource: boolean;
} {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as {
      alphabetical?: unknown;
      toSource?: unknown;
      fromSource?: unknown;
    };
    return {
      alphabetical: stored.alphabetical === true,
      toSource: stored.toSource !== false,
      fromSource: stored.fromSource === true,
    };
  } catch {
    return { alphabetical: false, toSource: true, fromSource: false };
  }
}

const settings = readStructureSettings();
const alphabetical = signal(settings.alphabetical);
const toSource = signal(settings.toSource);
const fromSource = signal(settings.fromSource);

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        alphabetical: alphabetical.peek(),
        toSource: toSource.peek(),
        fromSource: fromSource.peek(),
      }),
    );
  } catch {
    // Not kept: it still applies until the page is reloaded.
  }
}

/** The tree shown, which Expand All and Collapse All act on. */
const shownTree = signal<TreeModel<SymbolNode> | undefined>(undefined);

/** The title's menus' commands and items. */
export function setupStructureView(services: MenuServices): void {
  const { commands, menus } = services;
  const toggles = [
    ['structure.sortAlphabetically', 'Alphabetically', alphabetical],
    ['structure.autoscrollToSource', 'Navigate with Single Click', toSource],
    ['structure.autoscrollFromSource', 'Always Select Opened Element', fromSource],
  ] as const;
  for (const [id, label, setting] of toggles) {
    commands.register({
      id,
      label,
      checked: () => setting.get(),
      run: () => {
        setting.set(!setting.peek());
        saveSettings();
      },
    });
  }
  commands.register({
    id: 'structure.expandAll',
    label: 'Expand All',
    icon: 'expandAll',
    enabled: () => shownTree.get() !== undefined,
    run: () => shownTree.peek()?.expandAll(),
  });
  commands.register({
    id: 'structure.collapseAll',
    label: 'Collapse All',
    icon: 'collapseAll',
    enabled: () => shownTree.get() !== undefined,
    run: () => {
      shownTree.peek()?.collapseAll();
    },
  });
  menus.contribute({ menu: VIEW_MENU, item: { heading: 'Sort' } });
  menus.contribute({ menu: VIEW_MENU, item: { command: 'structure.sortAlphabetically' } });
  for (const command of ['structure.expandAll', 'structure.collapseAll']) {
    menus.contribute({ menu: OPTIONS_MENU, item: { command }, group: 'a' });
  }
  for (const command of ['structure.autoscrollToSource', 'structure.autoscrollFromSource']) {
    menus.contribute({ menu: OPTIONS_MENU, item: { command }, group: 'b' });
  }
}

/** The title's View Options menu, and its Options (IntelliJ's gear) menu. */
export const VIEW_MENU = 'structure/view';
export const OPTIONS_MENU = 'structure/options';

export interface StructureViewProps {
  /** The active editor's file; undefined with none. */
  file: () => string | undefined;
  /** A file's document, as its editor has it, or why it can't be read. */
  document: (path: string) => Promise<EditorDocument | { error: string }>;
  /** A file's symbols, for its text, from its language server; null without one. */
  symbols: (path: string, text: string) => Promise<readonly FileSymbol[] | null>;
  /** Shows a place in its file's editor; `focus` puts the focus there. */
  show: (at: Place, focus: boolean) => void;
  /** The active editor's caret, read reactively: Always Select Opened Element follows it. */
  caret: () => { line: number; column: number } | undefined;
}

interface SymbolNode {
  key: string;
  symbol: FileSymbol;
}

/** Symbols' nodes, keyed by where they are in the file, so sorting keeps their keys. */
const nodes = (symbols: readonly FileSymbol[], parent: string): SymbolNode[] =>
  symbols.map((symbol, index) => ({ key: `${parent}/${String(index)}`, symbol }));

/** As Java's `compareToIgnoreCase`, which IntelliJ's sorter uses: not by the locale. */
export function compareIgnoringCase(a: string, b: string): number {
  const x = a.toUpperCase().toLowerCase();
  const y = b.toUpperCase().toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Whether `a` is at or before `b`. */
const upTo = (a: Place | FileSymbol['at'], b: Place | FileSymbol['at']) =>
  a.line < b.line || (a.line === b.line && a.column <= b.column);

/** The keys from the outermost symbol holding `caret` down to the innermost; none if none does. */
export function keysAt(symbols: readonly FileSymbol[], caret: FileSymbol['at']): string[] {
  const keys: string[] = [];
  let list = nodes(symbols, '');
  for (;;) {
    const holding = list.find(({ symbol }) => upTo(symbol.from, caret) && upTo(caret, symbol.to));
    if (!holding) return keys;
    keys.push(holding.key);
    list = nodes(holding.symbol.children, holding.key);
  }
}

/** The window's content: the active file's structure, or why there's none. */
export function StructureView(props: StructureViewProps): Node {
  return (
    <div class="playground-occurrences">
      {() => {
        const path = props.file();
        if (path === undefined) return <p class="playground-project__empty">No structure</p>;
        return untracked(() => <FileStructure path={path} {...props} />);
      }}
    </div>
  );
}

function FileStructure(props: StructureViewProps & { path: string }) {
  const { path } = props;
  /** The symbols last read: undefined until then, null without a server. */
  const read = signal<readonly FileSymbol[] | null | undefined>(undefined);
  let asked = 0;
  const ask = async (text: string) => {
    const mine = ++asked;
    const symbols = await props.symbols(path, text);
    // Only the latest answer: an earlier one may come after it.
    if (mine === asked) read.set(symbols);
  };
  // The document's effect is made once it's read: stopped with the view, or at once if it's gone.
  let disposed = false;
  let stop: (() => void) | undefined;
  onCleanup(() => {
    disposed = true;
    stop?.();
  });
  void props.document(path).then((doc) => {
    if (disposed) return;
    if ('error' in doc) {
      read.set(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const watching = effect(() => {
      const text = doc.text.get().toString();
      if (first) {
        first = false;
        void ask(text);
      } else {
        clearTimeout(timer);
        timer = setTimeout(() => void ask(text), UPDATE_DELAY);
      }
      return undefined;
    });
    stop = () => {
      clearTimeout(timer);
      watching.dispose();
    };
  });
  return () => {
    const symbols = read.get();
    if (symbols === undefined) return null;
    if (symbols === null || symbols.length === 0) {
      return (
        <p class="playground-project__empty">
          {symbols === null ? 'No structure' : 'Structure is empty'}
        </p>
      );
    }
    return untracked(() => <Tree {...props} found={symbols} />);
  };
}

/** The symbols' tree, every symbol with members expanded; selecting one shows it. */
function Tree(props: StructureViewProps & { path: string; found: readonly FileSymbol[] }) {
  const sorted = (list: SymbolNode[]) =>
    alphabetical.peek()
      ? list.sort((a, b) => compareIgnoringCase(a.symbol.name, b.symbol.name))
      : list;
  const model = new TreeModel<SymbolNode>({
    children: (node) =>
      Promise.resolve(
        sorted(node ? nodes(node.symbol.children, node.key) : nodes(props.found, '')),
      ),
    key: (node) => node.key,
    isLeaf: (node) => node.symbol.children.length === 0,
  });
  shownTree.set(model);
  // Sorted otherwise: read again, what's expanded and selected kept.
  let sorting = alphabetical.peek();
  const resorting = effect(() => {
    if (alphabetical.get() !== sorting) {
      sorting = alphabetical.peek();
      void model.refresh();
    }
    return undefined;
  });
  const expand = (list: readonly SymbolNode[]) => {
    for (const node of list) {
      if (node.symbol.children.length === 0) continue;
      model.expand(node);
      expand(nodes(node.symbol.children, node.key));
    }
  };
  expand(nodes(props.found, ''));
  const go = (node: SymbolNode, focus: boolean) => {
    props.show({ path: props.path, ...node.symbol.at }, focus);
  };
  // Autoscroll to Source: the selected symbol shown, the focus left in the tree; not one
  // Always Select Opened Element selected.
  let shown: string | undefined;
  const following = effect(() => {
    const key = model.selected;
    if (key === undefined || key === shown) return undefined;
    shown = key;
    if (!untracked(() => toSource.get())) return undefined;
    // The selection is always a row's: collapsing a symbol selects it, if a member was.
    const row = untracked(() => model.rows.find((r) => r.key === key)) as TreeRow<SymbolNode>;
    go(row.node, false);
    return undefined;
  });
  // Always Select Opened Element: a while after the caret moves, as the tree opens too.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fromCaret = effect(() => {
    const caret = props.caret();
    clearTimeout(timer);
    if (caret === undefined || !untracked(() => fromSource.get())) return undefined;
    timer = setTimeout(() => {
      const keys = keysAt(props.found, caret);
      const last = keys.at(-1);
      if (last === undefined) return;
      shown = last;
      void model.reveal(keys);
    }, FOLLOW_DELAY);
    return undefined;
  });
  onCleanup(() => {
    following.dispose();
    resorting.dispose();
    fromCaret.dispose();
    clearTimeout(timer);
    // A tree goes before the next one's made.
    shownTree.set(undefined);
  });
  return (
    <TreeView
      model={model}
      label="Structure"
      openParents
      row={(node) => [
        symbolIcon(node.symbol.kind),
        <span class="playground-occurrences__name">{node.symbol.name}</span>,
      ]}
      onOpen={(node) => {
        go(node, true);
      }}
    />
  );
}
