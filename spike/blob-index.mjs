// A tree-sitter index keyed by git blob hash, shared by every worktree of a repo.
// Each distinct file content is parsed once; a worktree is a map from path to blob hash.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Parser, Language, Query } from 'web-tree-sitter';

const require = createRequire(import.meta.url);
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const jsDir = pkgDir('tree-sitter-javascript');
const tsDir = pkgDir('tree-sitter-typescript');

// The upstream JS tags query attaches doc comments with directives web-tree-sitter doesn't run;
// drop those parts and keep the patterns.
const jsTags = readFileSync(path.join(jsDir, 'queries/tags.scm'), 'utf8')
    .replace(/\(comment\)\* @doc\s*\.\s*/g, '')
    .replace(/^\s*\(#(strip|select-adjacent)! .*\)$/gm, '');
const tsTags = readFileSync(path.join(tsDir, 'queries/tags.scm'), 'utf8');

// Definitions the upstream tags queries don't cover, which name-based navigation needs.
const extraDefs = `
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

const LANGUAGES = {
    typescript: { wasm: path.join(tsDir, 'tree-sitter-typescript.wasm'), tags: jsTags + tsTags + extraDefs, ids: tsIdentifiers },
    tsx: { wasm: path.join(tsDir, 'tree-sitter-tsx.wasm'), tags: jsTags + tsTags + extraDefs, ids: tsIdentifiers },
    javascript: { wasm: path.join(jsDir, 'tree-sitter-javascript.wasm'), tags: jsTags, ids: jsIdentifiers },
};

const EXTENSIONS = {
    '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
};

export function languageOf(file) {
    return EXTENSIONS[path.extname(file)];
}

export class BlobIndex {
    // blob hash -> { defs: [{ name, kind, row, col }], ids: Map<name, [row, col, row, col, ...]> }
    blobs = new Map();

    static async create() {
        await Parser.init();
        const index = new BlobIndex();
        index.langs = {};
        for (const [name, { wasm, tags, ids }] of Object.entries(LANGUAGES)) {
            const language = await Language.load(wasm);
            const parser = new Parser();
            parser.setLanguage(language);
            index.langs[name] = { parser, tags: new Query(language, tags), ids: new Query(language, ids) };
        }
        return index;
    }

    parse(source, lang) {
        const { parser, tags, ids } = this.langs[lang];
        const tree = parser.parse(source);
        const defs = [];
        for (const match of tags.matches(tree.rootNode)) {
            const name = match.captures.find((c) => c.name === 'name')?.node;
            const kind = match.captures.find((c) => c.name.startsWith('definition.'))?.name.slice(11);
            if (name && kind) defs.push({ name: name.text, kind, row: name.startPosition.row, col: name.startPosition.column });
        }
        const idMap = new Map();
        for (const { node } of ids.captures(tree.rootNode)) {
            let list = idMap.get(node.text);
            if (!list) idMap.set(node.text, (list = []));
            list.push(node.startPosition.row, node.startPosition.column);
        }
        tree.delete();
        return { defs, ids: idMap };
    }

    // Index a worktree's tracked source files, parsing only blobs not already indexed.
    indexWorktree(worktree) {
        const t0 = performance.now();
        const paths = new Map();
        const out = execFileSync('git', ['-C', worktree, 'ls-files', '-s', '-z'], { maxBuffer: 1 << 28 }).toString();
        for (const entry of out.split('\0')) {
            const tab = entry.indexOf('\t');
            if (tab < 0) continue;
            const file = entry.slice(tab + 1);
            const [mode, blob] = entry.slice(0, tab).split(' ');
            if (mode !== '120000' && languageOf(file)) paths.set(file, blob);
        }
        const t1 = performance.now();
        let parsed = 0, bytes = 0;
        for (const [file, blob] of paths) {
            if (this.blobs.has(blob)) continue;
            const source = readFileSync(path.join(worktree, file), 'utf8');
            bytes += source.length;
            this.blobs.set(blob, this.parse(source, languageOf(file)));
            parsed++;
        }
        const t2 = performance.now();
        return { paths, files: paths.size, parsed, reused: paths.size - parsed, bytes, listMs: t1 - t0, parseMs: t2 - t1, totalMs: t2 - t0 };
    }
}
