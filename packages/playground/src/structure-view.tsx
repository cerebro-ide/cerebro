// The Structure tool window, as IntelliJ's (StructureViewWrapperImpl and StructureViewComponent,
// read from its source): the symbols of the active editor's file, as a tree, from its language
// server, as File Structure's popup lists them, read again as the file changes. With IntelliJ's
// defaults (StructureViewFactoryImpl): selecting a symbol shows it in the editor (Autoscroll to
// Source), the focus staying in the tree; double click or Enter goes to it, the editor focused; it
// doesn't follow the caret (Autoscroll from Source is off). Its empty texts are IntelliJ's
// (LangBundle's `panel.empty.text.no.structure`, `status.text.structure.empty`).

import { onCleanup } from '@cerebro-ide/jsx';
import { effect, signal, untracked } from '@cerebro-ide/reactive';
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

export interface StructureViewProps {
  /** The active editor's file; undefined with none. */
  file: () => string | undefined;
  /** A file's document, as its editor has it, or why it can't be read. */
  document: (path: string) => Promise<EditorDocument | { error: string }>;
  /** A file's symbols, for its text, from its language server; null without one. */
  symbols: (path: string, text: string) => Promise<readonly FileSymbol[] | null>;
  /** Shows a place in its file's editor; `focus` puts the focus there. */
  show: (at: Place, focus: boolean) => void;
}

interface SymbolNode {
  key: string;
  symbol: FileSymbol;
}

const nodes = (symbols: readonly FileSymbol[], parent: string): SymbolNode[] =>
  symbols.map((symbol, index) => ({ key: `${parent}/${String(index)}`, symbol }));

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
  ) as Node;
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
  const model = new TreeModel<SymbolNode>({
    children: (node) =>
      Promise.resolve(node ? nodes(node.symbol.children, node.key) : nodes(props.found, '')),
    key: (node) => node.key,
    isLeaf: (node) => node.symbol.children.length === 0,
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
  // Autoscroll to Source: the selected symbol shown, the focus left in the tree.
  let shown: string | undefined;
  const following = effect(() => {
    const key = model.selected;
    if (key === undefined || key === shown) return undefined;
    shown = key;
    // The selection is always a row's: collapsing a symbol selects it, if a member was.
    const row = untracked(() => model.rows.find((r) => r.key === key)) as TreeRow<SymbolNode>;
    go(row.node, false);
    return undefined;
  });
  onCleanup(() => {
    following.dispose();
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
