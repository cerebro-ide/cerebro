// IntelliJ's gutter markers for a file's types and their members, worked out from what language
// servers offer: neither TypeScript 7's server nor basedpyright offers the type hierarchy request
// (measured: neither lists `typeHierarchyProvider`), but both answer `documentSymbol` and
// `implementation` (measured).
//
// - **Down** (is implemented, is overridden): a member's or a type's implementations, from the
//   server, but itself (it may be among them, as basedpyright's and TypeScript's are).
// - **Up** (implements, overrides): the bases named in a type's header (after `extends` and
//   `implements`, or in Python's parentheses), each found by going to its definition; a member of
//   the nearest base with the member's name is the one it implements or overrides. By name, as
//   both languages override.

/** A place in a file, zero-based, its path with `/`. */
export interface Place {
  path: string;
  line: number;
  column: number;
}

/** What a gutter marker says: up, to what a member implements or overrides; down, to what does. */
export type MarkerKind = 'implements' | 'overrides' | 'implemented' | 'overridden';

/** A gutter marker on a line, and where it goes. */
export interface Marker {
  line: number;
  kind: MarkerKind;
  name: string;
  targets: Place[];
}

/** A symbol in a file, as a server's `documentSymbol` answers (LSP's DocumentSymbol). */
export interface DocumentSymbol {
  name: string;
  kind: number;
  selectionRange: { start: { line: number; character: number } };
  children?: DocumentSymbol[];
}

/** What the markers are worked out from: a file's language server, and its files' text. */
export interface Ask {
  symbols(path: string): Promise<DocumentSymbol[]>;
  definitions(at: Place): Promise<Place[]>;
  implementations(at: Place): Promise<Place[]>;
  /** A file's text: the open one's as the UI has it; undefined when it can't be read. */
  text(path: string): Promise<string | undefined>;
}

// LSP's SymbolKind.
const CLASS = 5;
const INTERFACE = 11;
const MEMBERS = new Set([6 /* method */, 7 /* property */, 8 /* field */]);

/** How far up the bases are followed (a claim: deeper hierarchies are rare). */
const DEPTH = 8;
/** How long a type's header is read for its bases, in characters (a claim). */
const HEADER = 1_000;

const KEYWORDS = new Set(['extends', 'implements']);

interface Type {
  path: string;
  symbol: DocumentSymbol;
}

const placeOf = (path: string, symbol: DocumentSymbol): Place => ({
  path,
  line: symbol.selectionRange.start.line,
  column: symbol.selectionRange.start.character,
});

const same = (a: Place, b: Place) =>
  a.path === b.path && a.line === b.line && a.column === b.column;

/** The classes and interfaces among a file's symbols, nested ones too. */
function typesIn(symbols: readonly DocumentSymbol[]): DocumentSymbol[] {
  return symbols.flatMap((s) => [
    ...(s.kind === CLASS || s.kind === INTERFACE ? [s] : []),
    ...typesIn(s.children ?? []),
  ]);
}

const membersOf = (type: DocumentSymbol) =>
  (type.children ?? []).filter((c) => MEMBERS.has(c.kind));

/** Whether a member is abstract: TypeScript's keyword before its name, or Python's decorator. */
function isAbstract(text: string | undefined, at: Place): boolean {
  if (text === undefined) return false;
  const lines = text.split('\n');
  const before = (lines[at.line] ?? '').slice(0, at.column);
  return /\babstract\b/.test(before) || /@(abc\.)?abstractmethod\b/.test(lines[at.line - 1] ?? '');
}

/** The names in a type's header after its own, where its bases are, as places to ask about. */
export function baseNames(text: string, type: Place, name: string): Place[] {
  const lines = text.split('\n');
  const found: Place[] = [];
  let depth = 0;
  let read = 0;
  for (let line = type.line, column = type.column + name.length; line < lines.length; line++) {
    const content = lines[line] as string;
    for (; column < content.length && read < HEADER; column++, read++) {
      const char = content[column] as string;
      if (char === '{' || (char === ':' && depth === 0)) return found;
      if ('([<'.includes(char)) depth++;
      else if (')]>'.includes(char)) depth--;
      // A word whole: a name, or a number (as in a Python generic's `Literal[1]`).
      const word = /^[\w$]+/.exec(content.slice(column))?.[0];
      if (word) {
        if (!KEYWORDS.has(word) && !/^\d/.test(word)) found.push({ path: type.path, line, column });
        column += word.length - 1;
        read += word.length - 1;
      }
    }
    column = 0;
  }
  return found;
}

/** The markers for a file's types and members. */
export async function markersOf(path: string, ask: Ask): Promise<Marker[]> {
  const symbols = await ask.symbols(path);
  const text = await ask.text(path);
  const types = typesIn(symbols);
  const texts = new Map<string, Promise<string | undefined>>([[path, Promise.resolve(text)]]);
  const textOf = (file: string) => {
    let known = texts.get(file);
    if (!known) {
      known = ask.text(file);
      texts.set(file, known);
    }
    return known;
  };
  const symbolsOf = new Map<string, Promise<DocumentSymbol[]>>([[path, Promise.resolve(symbols)]]);
  /** The type defined at a place: where a base's name goes. */
  const typeAt = async (at: Place): Promise<Type | undefined> => {
    let known = symbolsOf.get(at.path);
    if (!known) {
      known = ask.symbols(at.path).catch(() => []);
      symbolsOf.set(at.path, known);
    }
    const symbol = typesIn(await known).find((t) => same(placeOf(at.path, t), at));
    return symbol && { path: at.path, symbol };
  };
  /** A type's bases: the types its header's names are defined as. */
  const basesOf = async (type: Type): Promise<Type[]> => {
    const header = await textOf(type.path);
    if (header === undefined) return [];
    const names = baseNames(header, placeOf(type.path, type.symbol), type.symbol.name);
    const defined = await Promise.all(names.map((n) => ask.definitions(n).catch(() => [])));
    const bases = await Promise.all(defined.flat().map(typeAt));
    return bases.filter((b): b is Type => b !== undefined);
  };

  const down = async (at: Place, interfaceLike: boolean, name: string): Promise<Marker[]> => {
    const targets = (await ask.implementations(at).catch(() => [])).filter((t) => !same(t, at));
    if (targets.length === 0) return [];
    const kind = interfaceLike || isAbstract(text, at) ? 'implemented' : 'overridden';
    return [{ line: at.line, kind, name, targets }];
  };

  const up = async (type: DocumentSymbol): Promise<Marker[]> => {
    const left = new Map(membersOf(type).map((m) => [m.name, m]));
    const markers: Marker[] = [];
    const seen = new Set<string>();
    let level = await basesOf({ path, symbol: type });
    for (let depth = 0; depth < DEPTH && left.size > 0; depth++) {
      // Each base once, however it's reached (a base named twice, or a cycle in a broken project).
      level = level.filter((b) => {
        const key = `${b.path}:${String(b.symbol.selectionRange.start.line)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (level.length === 0) break;
      const found = new Map<string, { kind: MarkerKind; targets: Place[] }>();
      for (const base of level) {
        for (const member of membersOf(base.symbol)) {
          if (!left.has(member.name)) continue;
          const target = placeOf(base.path, member);
          const implemented =
            base.symbol.kind === INTERFACE || isAbstract(await textOf(base.path), target);
          const entry = found.get(member.name) ?? { kind: 'overrides', targets: [] };
          if (implemented) entry.kind = 'implements';
          entry.targets.push(target);
          found.set(member.name, entry);
        }
      }
      for (const [name, { kind, targets }] of found) {
        const member = left.get(name) as DocumentSymbol;
        left.delete(name);
        markers.push({ line: member.selectionRange.start.line, kind, name, targets });
      }
      level = (await Promise.all(level.map(basesOf))).flat();
    }
    return markers;
  };

  const all = await Promise.all(
    types.flatMap((type) => [
      up(type),
      down(placeOf(path, type), type.kind === INTERFACE, type.name),
      ...membersOf(type).map((m) => down(placeOf(path, m), type.kind === INTERFACE, m.name)),
    ]),
  );
  return all.flat().sort((a, b) => a.line - b.line);
}
