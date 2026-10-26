// Parsed file contents, keyed by git blob hash: each distinct content is parsed once, whichever
// worktrees have it. Per blob: its definitions, and every identifier's positions, by name.

import { Language, Parser, Query, type Tree } from 'web-tree-sitter';
import { LANGUAGES, type LanguageId } from './languages.js';

export interface Definition {
  name: string;
  /** From the tags query: `class`, `function`, `method`, `interface`, `type`, `constant`… */
  kind: string;
  /** Zero-based. */
  line: number;
  column: number;
}

export interface Blob {
  definitions: Definition[];
  /** Identifier name → positions, flattened as line, column, line, column… */
  identifiers: Map<string, number[]>;
}

interface Loaded {
  parser: Parser;
  tags: Query;
  identifiers: Query;
}

export class BlobIndex {
  readonly blobs = new Map<string, Blob>();

  private constructor(private readonly languages: ReadonlyMap<LanguageId, Loaded>) {}

  /** Loads the grammars: once per process, then the index parses synchronously. */
  static async create(): Promise<BlobIndex> {
    await Parser.init();
    const languages = new Map<LanguageId, Loaded>();
    for (const [id, spec] of Object.entries(LANGUAGES) as [
      LanguageId,
      (typeof LANGUAGES)[LanguageId],
    ][]) {
      const language = await Language.load(spec.wasm);
      const parser = new Parser();
      parser.setLanguage(language);
      languages.set(id, {
        parser,
        tags: new Query(language, spec.tags),
        identifiers: new Query(language, spec.identifiers),
      });
    }
    return new BlobIndex(languages);
  }

  /** Parses a file's content in a language. */
  parse(source: string, language: LanguageId): Blob {
    const { parser, tags, identifiers } = this.languages.get(language) as Loaded;
    // Null only without a language, and every parser here has one.
    const tree = parser.parse(source) as Tree;
    try {
      const definitions: Definition[] = [];
      for (const match of tags.matches(tree.rootNode)) {
        const name = match.captures.find((c) => c.name === 'name')?.node;
        const kind = match.captures.find((c) => c.name.startsWith('definition.'))?.name.slice(11);
        if (name && kind) {
          definitions.push({
            name: name.text,
            kind,
            line: name.startPosition.row,
            column: name.startPosition.column,
          });
        }
      }
      const ids = new Map<string, number[]>();
      for (const { node } of identifiers.captures(tree.rootNode)) {
        let positions = ids.get(node.text);
        if (!positions) ids.set(node.text, (positions = []));
        positions.push(node.startPosition.row, node.startPosition.column);
      }
      return { definitions, identifiers: ids };
    } finally {
      tree.delete();
    }
  }

  /** Parses a blob unless it's indexed already; returns whether it was parsed. */
  add(blob: string, source: () => string, language: LanguageId): boolean {
    if (this.blobs.has(blob)) return false;
    this.blobs.set(blob, this.parse(source(), language));
    return true;
  }
}
