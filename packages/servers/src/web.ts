// A language server for JSON, CSS (with SCSS and Less) and HTML, of Cerebro's own: Microsoft's
// libraries that VS Code's own servers for them are made of, behind the Language Server Protocol.
// JSON files are checked against the schema they name (`$schema`) or SchemaStore's for their name,
// as VS Code's and IntelliJ's are.

import { readFile } from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  getCSSLanguageService,
  getLESSLanguageService,
  getSCSSLanguageService,
  type LanguageService as CSSService,
} from 'vscode-css-languageservice';
import { getLanguageService as getHTMLService } from 'vscode-html-languageservice';
import {
  getLanguageService as getJSONService,
  type SchemaConfiguration,
} from 'vscode-json-languageservice';
import {
  createConnection,
  InsertTextFormat,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocuments,
  TextDocumentSyncKind,
  type CodeAction,
  type CompletionItem,
  type CompletionList,
  type Diagnostic,
  type TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

/** Fetches a schema by its address: a file's from disk, any other over the network. */
export type Fetch = (uri: string) => Promise<string>;

const fetchText: Fetch = async (uri) => {
  if (uri.startsWith('file:')) return readFile(fileURLToPath(uri), 'utf8');
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`${String(response.status)} for ${uri}`);
  return response.text();
};

/** SchemaStore's catalog: the schemas it knows, and the file names each is for. */
export const CATALOG = 'https://www.schemastore.org/api/json/catalog.json';

/** The catalog's schemas, as the JSON service takes them. */
export function catalogSchemas(text: string): SchemaConfiguration[] {
  const { schemas } = JSON.parse(text) as {
    schemas?: { url?: string; fileMatch?: string[] }[];
  };
  return (schemas ?? []).flatMap(({ url, fileMatch }) =>
    url && fileMatch?.length ? [{ uri: url, fileMatch }] : [],
  );
}

/**
 * A snippet as the text it puts in: each placeholder's text (a choice's first), no tab stops. The
 * libraries write snippets whatever the client takes (VS Code takes them).
 */
export function plainText(snippet: string): string {
  let text = snippet;
  // Innermost first, until none is left.
  for (let last = ''; last !== text;) {
    last = text;
    text = text
      .replace(/\$\{\d+\|([^,|]*)[^|]*\|\}/g, '$1')
      .replace(/\$\{\d+:((?:[^${}\\]|\\.)*)\}/g, '$1');
  }
  // An escaped `$` isn't a tab stop.
  return text.replace(/\\([$}\\])|\$\{\d+\}|\$\d+/g, (_, escaped?: string) => escaped ?? '');
}

/** A completion as plain text, for a client that takes no snippets. */
export function withoutSnippet(item: CompletionItem): CompletionItem {
  if (item.insertTextFormat !== InsertTextFormat.Snippet) return item;
  const plain: CompletionItem = { ...item, insertTextFormat: InsertTextFormat.PlainText };
  if (item.insertText !== undefined) plain.insertText = plainText(item.insertText);
  if (item.textEdit)
    plain.textEdit = { ...item.textEdit, newText: plainText(item.textEdit.newText) };
  return plain;
}

/**
 * An action's edits as a map of files to edits, for a client that doesn't say it takes them per
 * version of a file (LSP); the CSS library sends them that way whatever the client takes.
 */
export function withChanges(action: CodeAction): CodeAction {
  const changes: Record<string, TextEdit[]> = {};
  for (const change of action.edit?.documentChanges ?? []) {
    if ('textDocument' in change) {
      changes[change.textDocument.uri] = change.edits.filter(
        (edit): edit is TextEdit => 'newText' in edit,
      );
    }
  }
  return { ...action, edit: { changes } };
}

export interface WebOptions {
  fetch?: Fetch;
  /** Where SchemaStore's catalog is, or none to do without it. */
  catalog?: string | null;
}

/** Serves JSON, CSS, SCSS, Less and HTML over LSP, on `input` and `output`. */
export function serveWeb(input: Readable, output: Writable, options: WebOptions = {}): void {
  const { fetch: get = fetchText, catalog = CATALOG } = options;
  const connection = createConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output),
  );
  const documents = new TextDocuments(TextDocument);
  const json = getJSONService({
    schemaRequestService: get,
    // A schema's `$ref` to another beside it.
    workspaceContext: { resolveRelativePath: (path, resource) => new URL(path, resource).href },
  });
  const sheets: Readonly<Record<string, CSSService>> = {
    css: getCSSLanguageService(),
    scss: getSCSSLanguageService(),
    less: getLESSLanguageService(),
  };
  const html = getHTMLService();
  const isJSON = (document: TextDocument) =>
    document.languageId === 'json' || document.languageId === 'jsonc';
  let snippets = false;

  connection.onInitialize(({ capabilities }) => {
    snippets = capabilities.textDocument?.completion?.completionItem?.snippetSupport === true;
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        completionProvider: { triggerCharacters: ['"', ':', '.', '-', '<', ' '] },
        definitionProvider: true,
        referencesProvider: true,
        documentHighlightProvider: true,
        codeActionProvider: true,
      },
    };
  });

  /** Sends a file's problems: JSON's, against its schema, and style sheets'; HTML has none. */
  const validate = async (document: TextDocument) => {
    // The document changes in place as it's edited: its version as it was, here.
    const { version } = document;
    const sheet = sheets[document.languageId];
    let diagnostics: Diagnostic[] = [];
    if (isJSON(document)) {
      const jsonc = document.languageId === 'jsonc';
      diagnostics = await json.doValidation(document, json.parseJSONDocument(document), {
        comments: jsonc ? 'ignore' : 'error',
        trailingCommas: jsonc ? 'ignore' : 'error',
      });
    } else if (sheet) {
      diagnostics = sheet.doValidation(document, sheet.parseStylesheet(document));
    }
    // Only for the text it was worked out from.
    if (documents.get(document.uri)?.version !== version) return;
    void connection.sendDiagnostics({ uri: document.uri, version, diagnostics });
  };

  json.configure({ validate: true, schemas: [] });
  connection.onInitialized(() => {
    if (!catalog) return;
    // Once it's had, the files open are checked again against it.
    get(catalog)
      .then((text) => {
        json.configure({ validate: true, schemas: catalogSchemas(text) });
        for (const document of documents.all()) void validate(document);
      })
      .catch(() => undefined);
  });

  documents.onDidChangeContent(({ document }) => {
    void validate(document);
  });

  connection.onHover(({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    if (!document) return null;
    const sheet = sheets[document.languageId];
    if (isJSON(document)) return json.doHover(document, position, json.parseJSONDocument(document));
    if (sheet) return sheet.doHover(document, position, sheet.parseStylesheet(document));
    return html.doHover(document, position, html.parseHTMLDocument(document));
  });

  connection.onCompletion(async ({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    if (!document) return null;
    const sheet = sheets[document.languageId];
    let list: CompletionList | null;
    if (isJSON(document)) {
      list = await json.doComplete(document, position, json.parseJSONDocument(document));
    } else if (sheet) {
      list = sheet.doComplete(document, position, sheet.parseStylesheet(document));
    } else {
      list = html.doComplete(document, position, html.parseHTMLDocument(document));
    }
    if (!list || snippets) return list;
    return { ...list, items: list.items.map(withoutSnippet) };
  });

  connection.onDefinition(({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    const sheet = document && sheets[document.languageId];
    if (!document || !sheet) return null;
    return sheet.findDefinition(document, position, sheet.parseStylesheet(document));
  });

  connection.onReferences(({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    const sheet = document && sheets[document.languageId];
    if (!document || !sheet) return null;
    return sheet.findReferences(document, position, sheet.parseStylesheet(document));
  });

  connection.onDocumentHighlight(({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    if (!document || isJSON(document)) return null;
    const sheet = sheets[document.languageId];
    if (sheet) {
      return sheet.findDocumentHighlights(document, position, sheet.parseStylesheet(document));
    }
    return html.findDocumentHighlights(document, position, html.parseHTMLDocument(document));
  });

  connection.onCodeAction(({ textDocument, range, context }) => {
    const document = documents.get(textDocument.uri);
    const sheet = document && sheets[document.languageId];
    if (!document || !sheet) return null;
    // Its types are LSP 3.17's, where a problem's message is only text, as the client's are.
    const asked = context as Parameters<CSSService['doCodeActions2']>[2];
    return sheet
      .doCodeActions2(document, range, asked, sheet.parseStylesheet(document))
      .map(withChanges);
  });

  documents.listen(connection);
  connection.listen();
}
