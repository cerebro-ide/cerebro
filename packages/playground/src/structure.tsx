// File Structure, as IntelliJ's (Ctrl+F12): a file's symbols from its language server, as a tree in
// a popup titled with the file's name, the symbol at the caret highlighted. Typing narrows the tree
// to the symbols whose names match and what they're in, the first match highlighted; Enter goes to
// the one chosen.

import { match, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { symbolIcon } from './icons.js';

interface Place {
  line: number;
  column: number;
}

/** A symbol in a file, as the host gives it: all of it, where its name is, what's in it. */
export interface FileSymbol {
  name: string;
  /** LSP's kind, by its name (`class`, `method`...). */
  kind?: string;
  from: Place;
  to: Place;
  at: Place;
  children: FileSymbol[];
}

interface Item extends PickerItem {
  symbol: FileSymbol;
  /** Whether its name matches what's typed; what a match is in doesn't. */
  matches: boolean;
}

/** Whether `a` is at or before `b`. */
const upTo = (a: Place, b: Place) => a.line < b.line || (a.line === b.line && a.column <= b.column);

/**
 * The symbols as a tree's items, in the file's order: those whose names match `query` and those
 * they're in; all of them for no query.
 */
export function structureItems(symbols: readonly FileSymbol[], query: string, depth = 0): Item[] {
  return symbols.flatMap((symbol) => {
    const children = structureItems(symbol.children, query, depth + 1);
    const matched = query.trim() === '' ? { indices: [] } : match(query, symbol.name);
    if (!matched && children.length === 0) return [];
    const item: Item = {
      label: symbol.name,
      ...(depth ? { depth } : {}),
      ...(matched?.indices.length ? { highlight: matched.indices } : {}),
      icon: () => symbolIcon(symbol.kind),
      symbol,
      matches: matched !== undefined,
    };
    return [item, ...children];
  });
}

/**
 * Opens File Structure for a file's symbols, `title` its name, the innermost symbol holding the
 * caret highlighted. Resolves with the symbol chosen.
 */
export async function openStructure(
  title: string,
  symbols: readonly FileSymbol[] | null,
  caret: Place,
): Promise<FileSymbol | undefined> {
  let opened = false;
  const chosen = await openPicker<Item>({
    label: 'File Structure',
    position: 'top',
    // IntelliJ's empty tree says so; no server's answer says why.
    empty: symbols ? 'Nothing to show' : 'No language server answered',
    header: () => <span class="playground-popup__title">{title}</span>,
    items: (query) => structureItems(symbols ?? [], query),
    initial: (items) => {
      if (opened) return items.findIndex((item) => item.matches);
      opened = true;
      // The last one holding the caret is the innermost: what's in a symbol comes after it.
      return items.findLastIndex(
        ({ symbol }) => upTo(symbol.from, caret) && upTo(caret, symbol.to),
      );
    },
  }).result;
  return chosen?.symbol;
}
