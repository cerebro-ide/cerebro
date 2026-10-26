// The languages the index parses, with tree-sitter's WASM grammars: TypeScript, TSX and JavaScript
// for now, as the spike measured them (spike-multi-worktree.md). The other target languages follow.
//
// Definitions come from each grammar's own tags query, plus the definitions name-based navigation
// needs that those don't cover; identifiers are every name, for usages.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`));
const jsDir = packageDir('tree-sitter-javascript');
const tsDir = packageDir('tree-sitter-typescript');

// The JavaScript tags query attaches doc comments with directives web-tree-sitter doesn't run;
// those parts are dropped, the patterns kept.
const jsTags = readFileSync(join(jsDir, 'queries/tags.scm'), 'utf8')
  .replace(/\(comment\)\* @doc\s*\.\s*/g, '')
  .replace(/^\s*\(#(strip|select-adjacent)! .*\)$/gm, '');
const tsTags = readFileSync(join(tsDir, 'queries/tags.scm'), 'utf8');

/** Definitions the upstream tags queries don't cover. */
const extraDefinitions = `
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.enum
(public_field_definition name: (property_identifier) @name) @definition.field
(program (lexical_declaration (variable_declarator name: (identifier) @name) @definition.constant))
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @name) @definition.constant)))
`;

const jsIdentifiers = `[
  (identifier) (property_identifier)
  (shorthand_property_identifier) (shorthand_property_identifier_pattern)
] @id`;
const tsIdentifiers = jsIdentifiers.replace('(identifier)', '(identifier) (type_identifier)');

export type LanguageId = 'typescript' | 'tsx' | 'javascript';

export interface LanguageSpec {
  wasm: string;
  tags: string;
  identifiers: string;
}

export const LANGUAGES: Readonly<Record<LanguageId, LanguageSpec>> = {
  typescript: {
    wasm: join(tsDir, 'tree-sitter-typescript.wasm'),
    tags: jsTags + tsTags + extraDefinitions,
    identifiers: tsIdentifiers,
  },
  tsx: {
    wasm: join(tsDir, 'tree-sitter-tsx.wasm'),
    tags: jsTags + tsTags + extraDefinitions,
    identifiers: tsIdentifiers,
  },
  javascript: {
    wasm: join(jsDir, 'tree-sitter-javascript.wasm'),
    tags: jsTags,
    identifiers: jsIdentifiers,
  },
};

const EXTENSIONS: Readonly<Record<string, LanguageId>> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
};

/** The language of a file by its extension, if the index parses it. */
export function languageOf(path: string): LanguageId | undefined {
  return EXTENSIONS[extname(path).toLowerCase()];
}
