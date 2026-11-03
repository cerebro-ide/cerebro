// Language servers, for precise go to definition and find usages: the host's own LSP client over a
// server's stdin and stdout, and a lazy pool of servers, one per worktree and server, started on
// first use and stopped after a while unused (decision "Many worktrees must be proven solvable":
// agents don't use them, so only worktrees the human looks at have one).
//
// The UI sends a file's text with each request, so a file with unsaved edits is answered as it
// is. An answer that doesn't come in time (a server still loading its project) is given up on:
// the UI shows the index's name matches meanwhile.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Connection } from '@cerebro-ide/protocol';
import { frame, FrameReader } from './framing.js';
import { serverFor, servers, type ServerSpec } from '@cerebro-ide/servers';
import { markersOf, type DocumentSymbol, type Marker } from './markers.js';

/** A place in a file, zero-based, its path with `/` on every OS. */
export interface Located {
  path: string;
  line: number;
  column: number;
}

/** A stretch of a file's text, zero-based, the end after its last character. */
export interface Span {
  from: { line: number; column: number };
  to: { line: number; column: number };
}

/** Where the symbol at the caret is in its file: read, or written (assigned, declared with a value). */
export interface Highlight extends Span {
  write: boolean;
}

/**
 * How bad a problem is, as IntelliJ ranks its highlights: LSP's error, warning, information (a weak
 * warning) and hint (shown only by its tags: unused, deprecated).
 */
export type Severity = 'error' | 'warning' | 'weak' | 'hint';

/** A problem a language server finds in a file: an error, a warning. */
export interface Problem extends Span {
  severity: Severity;
  message: string;
  /** What found it ("ts", "basedpyright") and its name for it, when the server says. */
  source?: string;
  code?: string;
  /** Code that does nothing (an unused variable), or that's deprecated: LSP's tags. */
  unused: boolean;
  deprecated: boolean;
}

/** A change to a file's text: what's between `from` and `to` becomes `text`. */
export interface TextEdit extends Span {
  text: string;
}

/** What Alt+Enter offers at a place, as IntelliJ's context actions: a server's fix, as its edits. */
export interface ContextAction {
  title: string;
  /** LSP's kind of it (`quickfix`, `refactor.extract`...), when the server says. */
  kind?: string;
  edits: TextEdit[];
}

/** A file as the UI has it, edits and all. */
export interface OpenFile {
  path: string;
  text: string;
}

/** How long a server is kept unused (a claim: long enough to come back to a worktree). */
export const IDLE_AFTER = 10 * 60_000;
/** How long an answer is waited for before the name matches are shown instead. */
export const PATIENCE = 3_000;
/**
 * How long a file's gutter markers are waited for: a question per member, and the files its bases
 * are in read (a claim: long enough for a server still loading its project).
 */
export const MARKERS_PATIENCE = 30_000;
/**
 * How long a file's problems are waited for (a claim: long enough for a server still loading its
 * project; an answer for text since edited is dropped by the UI anyway).
 */
export const PROBLEMS_PATIENCE = 30_000;
/** How long a server is given to stop before it's killed. */
const STOP_WAIT = 2_000;

/** Starts a server's process: what tests replace. */
export type Run = (
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
) => ChildProcess;

const runProcess: Run = (command, args, cwd, env) =>
  spawn(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });

/**
 * A path as a file URI, a Windows drive spelled as VS Code spells it (`file:///c%3A/...`): so
 * TypeScript's server does, and it compares URIs as text (its highlights are kept only for the URI
 * asked about).
 */
export function uriOf(path: string, platform: NodeJS.Platform = process.platform): string {
  const windows = platform === 'win32';
  return pathToFileURL(path, { windows }).href.replace(
    /^file:\/\/\/([A-Za-z]):/,
    (_, drive: string) => `file:///${drive.toLowerCase()}%3A`,
  );
}

/** A file URI as a path with `/`, a Windows drive in capitals, as git writes them. */
export function pathOf(uri: string, platform: NodeJS.Platform = process.platform): string {
  const path = fileURLToPath(uri, { windows: platform === 'win32' }).replaceAll('\\', '/');
  return path.replace(/^[a-z]:/, (drive) => drive.toUpperCase());
}

interface Range {
  end: { line: number; character: number };
  start: { line: number; character: number };
}
type Location = { uri: string; range: Range } | { targetUri: string; targetSelectionRange: Range };

/** LSP's locations (or location links) as places. */
export function located(result: unknown, platform: NodeJS.Platform = process.platform): Located[] {
  if (result === null || result === undefined) return [];
  const all = (Array.isArray(result) ? result : [result]) as Location[];
  return all.map((location) => {
    const [uri, range] =
      'targetUri' in location
        ? [location.targetUri, location.targetSelectionRange]
        : [location.uri, location.range];
    return { path: pathOf(uri, platform), line: range.start.line, column: range.start.character };
  });
}

/** A server's document highlights: LSP's kind 3 is a write; 1 (text) and 2 (read) are reads. */
export function highlighted(result: unknown): Highlight[] {
  if (!Array.isArray(result)) return [];
  return (result as { range: Range; kind?: number }[]).map(({ range, kind }) => ({
    from: { line: range.start.line, column: range.start.character },
    to: { line: range.end.line, column: range.end.character },
    write: kind === 3,
  }));
}

/** A server's references that are in one file, as highlights: reads, as references can't tell. */
export function referencesIn(
  path: string,
  result: unknown,
  platform: NodeJS.Platform = process.platform,
): Highlight[] {
  if (!Array.isArray(result)) return [];
  return (result as { uri: string; range: Range }[])
    .filter(({ uri }) => pathOf(uri, platform) === path)
    .map(({ range }) => ({
      from: { line: range.start.line, column: range.start.character },
      to: { line: range.end.line, column: range.end.character },
      write: false,
    }));
}

const SEVERITIES: Readonly<Record<number, Severity>> = {
  1: 'error',
  2: 'warning',
  3: 'weak',
  4: 'hint',
};

/** LSP's diagnostics as problems; none if there are none. One without a severity is an error. */
export function problemsOf(items: unknown): Problem[] {
  if (!Array.isArray(items)) return [];
  return (
    items as {
      range: Range;
      severity?: number;
      message: string;
      source?: string;
      code?: string | number;
      tags?: number[];
    }[]
  ).map(({ range, severity, message, source, code, tags }) => ({
    from: { line: range.start.line, column: range.start.character },
    to: { line: range.end.line, column: range.end.character },
    severity: SEVERITIES[severity ?? 1] ?? 'error',
    message,
    ...(source === undefined ? {} : { source }),
    ...(code === undefined ? {} : { code: String(code) }),
    unused: tags?.includes(1) ?? false,
    deprecated: tags?.includes(2) ?? false,
  }));
}

interface CodeAction {
  title: string;
  kind?: string;
  edit?: { changes?: Record<string, { range: Range; newText: string }[]> };
  command?: unknown;
  disabled?: unknown;
}

/**
 * A server's code actions as context actions: those made by edits to the file asked about alone.
 * Left out: commands, which have the server make the change (neither TypeScript's server nor
 * basedpyright gave one, measured), actions it says are disabled, and edits to other files.
 */
export function actionsOf(
  path: string,
  result: unknown,
  platform: NodeJS.Platform = process.platform,
): ContextAction[] {
  if (!Array.isArray(result)) return [];
  return (result as CodeAction[]).flatMap(({ title, kind, edit, command, disabled }) => {
    const changes = Object.entries(edit?.changes ?? {});
    if (command !== undefined || disabled !== undefined || changes.length === 0) return [];
    if (changes.some(([uri]) => pathOf(uri, platform) !== path)) return [];
    const edits = changes.flatMap(([, list]) =>
      list.map(({ range, newText }) => ({
        from: { line: range.start.line, column: range.start.character },
        to: { line: range.end.line, column: range.end.character },
        text: newText,
      })),
    );
    return [{ title, ...(kind === undefined ? {} : { kind }), edits }];
  });
}

/** Whether a place is in a range, its ends included. */
function contains(range: Range, at: Located): boolean {
  const from = (end: { line: number; character: number }) =>
    end.line - at.line || end.character - at.column;
  return from(range.start) <= 0 && from(range.end) >= 0;
}

/** The kinds of action asked for: LSP's own. */
const KINDS = [
  '',
  'quickfix',
  'refactor',
  'refactor.extract',
  'refactor.inline',
  'refactor.rewrite',
  'source',
  'source.organizeImports',
  'source.fixAll',
];

/** One server's process, for one worktree. */
export class LanguageServer {
  /** Resolves once the server has answered `initialize`. */
  readonly ready: Promise<void>;
  readonly #connection: Connection;
  readonly #process: ChildProcess;
  /** The files it has open, by URI: their version and text. */
  readonly #documents = new Map<string, { version: number; text: string }>();
  /** The diagnostics it last sent of each file, unasked, and for which of its versions. */
  readonly #pushed = new Map<string, { version: number; diagnostics: unknown[] }>();
  /** Who waits for a file's problems to be sent. */
  readonly #waiting = new Map<string, Set<() => void>>();
  /** Whether it answers when asked for a file's problems; if not, it sends them as they change. */
  #pulls = false;
  #exited = false;

  constructor(spec: ServerSpec, root: string, onExit: () => void, run: Run = runProcess) {
    const { command, args, env } = spec.command();
    this.#process = run(command, args, root, env);
    const stdin = this.#process.stdin;
    // Writing to a server that's gone fails here; its exit is handled below.
    stdin?.on('error', () => undefined);
    this.#connection = new Connection((message) => {
      stdin?.write(frame(message));
    });
    const reader = new FrameReader((message) => {
      this.#connection.receive(message);
    });
    this.#process.stdout?.on('data', (chunk: Buffer) => {
      reader.push(chunk);
    });
    const exited = () => {
      if (this.#exited) return;
      this.#exited = true;
      this.#connection.close();
      onExit();
    };
    this.#process.on('exit', exited);
    this.#process.on('error', exited);
    // What servers ask of their client: settings (none), and leave to register and report.
    this.#connection.onRequest('workspace/configuration', (params) =>
      ((params as { items?: unknown[] } | null)?.items ?? []).map(() => null),
    );
    for (const method of ['client/registerCapability', 'window/workDoneProgress/create']) {
      this.#connection.onRequest(method, () => null);
    }
    // Problems sent unasked: for the version given, or the file's latest if none is.
    this.#connection.onNotification('textDocument/publishDiagnostics', (params) => {
      const { uri, version, diagnostics } = params as {
        uri: string;
        version?: number;
        diagnostics: unknown[];
      };
      const latest = this.#documents.get(uri)?.version ?? 0;
      this.#pushed.set(uri, { version: version ?? latest, diagnostics });
      for (const wake of this.#waiting.get(uri) ?? []) wake();
    });
    const folders = [{ uri: uriOf(root), name: root.slice(root.lastIndexOf('/') + 1) }];
    this.#connection.onRequest('workspace/workspaceFolders', () => folders);
    // A server that says when it's read the project is ready then; others once initialized.
    const { readyWhen } = spec;
    const loaded = readyWhen
      ? new Promise<void>((resolve) => {
          this.#connection.onNotification('window/logMessage', (params) => {
            const message = (params as { message?: unknown } | null)?.message;
            if (typeof message === 'string' && readyWhen.test(message)) resolve();
          });
        })
      : undefined;
    this.ready = this.#connection
      .request('initialize', {
        processId: process.pid,
        rootUri: uriOf(root),
        workspaceFolders: folders,
        capabilities: {
          textDocument: {
            synchronization: { didSave: false },
            definition: { linkSupport: true },
            references: {},
            documentHighlight: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            implementation: { linkSupport: true },
            publishDiagnostics: { versionSupport: true, tagSupport: { valueSet: [1, 2] } },
            // Actions as edits, not commands: without it, a server may give only commands (LSP).
            codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: KINDS } } },
            // Not registered as the server goes: basedpyright then exits (measured, 1.40.2). The
            // tags here too, or TypeScript's answers leave them out (measured).
            diagnostic: { dynamicRegistration: false, tagSupport: { valueSet: [1, 2] } },
          },
          workspace: { configuration: true, workspaceFolders: true },
        },
      })
      .then((result) => {
        const capabilities = (result as { capabilities?: { diagnosticProvider?: unknown } } | null)
          ?.capabilities;
        this.#pulls = capabilities?.diagnosticProvider !== undefined;
        this.#connection.notify('initialized', {});
        return loaded;
      });
    // A server that fails to start exits, and is forgotten then: no one need wait on it.
    this.ready.catch(() => undefined);
  }

  get exited(): boolean {
    return this.#exited;
  }

  /** A file open in the server, with the text it has; undefined when it isn't open. */
  opened(path: string): OpenFile | undefined {
    const open = this.#documents.get(uriOf(path));
    return open && { path, text: open.text };
  }

  /** Opens a file in the server, or gives it the file's text as it is now. */
  sync(file: OpenFile, languageId: string): void {
    const uri = uriOf(file.path);
    const open = this.#documents.get(uri);
    if (!open) {
      this.#documents.set(uri, { version: 1, text: file.text });
      this.#connection.notify('textDocument/didOpen', {
        textDocument: { uri, languageId, version: 1, text: file.text },
      });
    } else if (open.text !== file.text) {
      open.version++;
      open.text = file.text;
      this.#connection.notify('textDocument/didChange', {
        textDocument: { uri, version: open.version },
        contentChanges: [{ text: file.text }],
      });
    }
  }

  /** Where the symbol at a place in a file is defined. */
  async definitions(file: OpenFile, languageId: string, at: Located): Promise<Located[]> {
    return located(await this.#ask('textDocument/definition', file, languageId, at));
  }

  /** Where the symbol at a place in a file is used, its declaration left out, as IntelliJ's. */
  async usages(file: OpenFile, languageId: string, at: Located): Promise<Located[]> {
    return located(
      await this.#ask('textDocument/references', file, languageId, at, {
        context: { includeDeclaration: false },
      }),
    );
  }

  /** Where the symbol at a place in a file is, in that file: its usages, as IntelliJ highlights. */
  async highlights(file: OpenFile, languageId: string, at: Located): Promise<Highlight[]> {
    const found = highlighted(
      await this.#ask('textDocument/documentHighlight', file, languageId, at),
    );
    if (found.length > 0) return found;
    // TypeScript 7 has none for a name reached through a module's exports, though it finds its
    // references (measured: eslint-plugin-react-hooks' `configs`, from an eslint.config.js).
    return referencesIn(
      file.path,
      await this.#ask('textDocument/references', file, languageId, at, {
        context: { includeDeclaration: true },
      }),
    );
  }

  /** What a symbol at a place in a file is implemented or overridden by. */
  async implementations(file: OpenFile, languageId: string, at: Located): Promise<Located[]> {
    return located(await this.#ask('textDocument/implementation', file, languageId, at));
  }

  /** A file's symbols, nested: its types, and their members in them. */
  async symbols(file: OpenFile, languageId: string): Promise<DocumentSymbol[]> {
    await this.ready;
    this.sync(file, languageId);
    const answer = await this.#connection.request('textDocument/documentSymbol', {
      textDocument: { uri: uriOf(file.path) },
    });
    // Flat SymbolInformation, from a server that ignores the client's nesting: none to use.
    return Array.isArray(answer)
      ? (answer as DocumentSymbol[]).filter((s) => 'selectionRange' in s)
      : [];
  }

  /** A file's problems, as it is now. */
  async problems(file: OpenFile, languageId: string): Promise<Problem[]> {
    return problemsOf(await this.#diagnostics(file, languageId));
  }

  /**
   * What Alt+Enter offers at a place in a file: the server's fixes for the problems there, and its
   * other actions. TypeScript's server offers fixes only for the diagnostics it's given (measured).
   */
  async contextActions(file: OpenFile, languageId: string, at: Located): Promise<ContextAction[]> {
    const there = (await this.#diagnostics(file, languageId)).filter((d) =>
      contains((d as { range: Range }).range, at),
    );
    const place = { line: at.line, character: at.column };
    const answer = await this.#connection.request('textDocument/codeAction', {
      textDocument: { uri: uriOf(file.path) },
      range: { start: place, end: place },
      // Invoked, as by Alt+Enter.
      context: { diagnostics: there, triggerKind: 1 },
    });
    return actionsOf(file.path, answer);
  }

  /**
   * A file's diagnostics, as it is now and as the server gave them: asked for, of a server that
   * answers (TypeScript's), or as the server sends them for this version of it (basedpyright's,
   * bash-language-server's).
   */
  async #diagnostics(file: OpenFile, languageId: string): Promise<unknown[]> {
    await this.ready;
    this.sync(file, languageId);
    const uri = uriOf(file.path);
    if (this.#pulls) {
      // A full report, with its items: no earlier one is named, to answer as unchanged (LSP).
      const answer = (await this.#connection.request('textDocument/diagnostic', {
        textDocument: { uri },
      })) as { items: unknown[] };
      return answer.items;
    }
    const version = (this.#documents.get(uri) as { version: number }).version;
    const sent = () => {
      const pushed = this.#pushed.get(uri);
      return pushed && pushed.version >= version ? pushed.diagnostics : undefined;
    };
    return (
      sent() ??
      new Promise<unknown[]>((resolve) => {
        const waiting = this.#waiting.get(uri) ?? new Set();
        this.#waiting.set(uri, waiting);
        const wake = () => {
          const diagnostics = sent();
          if (!diagnostics) return;
          waiting.delete(wake);
          resolve(diagnostics);
        };
        waiting.add(wake);
      })
    );
  }

  /** Asks it to stop, and kills it if it doesn't; resolves once its process has exited. */
  async stop(): Promise<void> {
    if (this.#exited) return;
    const gone = new Promise((resolve) => this.#process.once('exit', resolve));
    const kill = setTimeout(() => this.#process.kill(), STOP_WAIT);
    try {
      await this.#connection.request('shutdown');
      this.#connection.notify('exit');
    } catch {
      this.#process.kill();
    }
    await gone;
    clearTimeout(kill);
  }

  async #ask(
    method: string,
    file: OpenFile,
    languageId: string,
    at: Located,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    await this.ready;
    this.sync(file, languageId);
    return this.#connection.request(method, {
      textDocument: { uri: uriOf(file.path) },
      position: { line: at.line, character: at.column },
      ...extra,
    });
  }
}

/** Resolves with what `promise` does, or with `undefined` after `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      resolve(undefined);
    }, ms);
  });
  return Promise.race([promise, late]).finally(() => {
    clearTimeout(timer);
  });
}

/** Whether one of `names` is in a file's folder or one above it, up to the worktree's. */
function inProject(worktree: string, path: string, names: readonly string[] | undefined): boolean {
  if (!names) return true;
  for (let folder = path.slice(0, path.lastIndexOf('/')); ;) {
    if (names.some((name) => existsSync(`${folder}/${name}`))) return true;
    if (folder.length <= worktree.length) return false;
    folder = folder.slice(0, folder.lastIndexOf('/'));
  }
}

/** The servers running, one per worktree and server, started as they're needed. */
export class LanguageServers {
  readonly #running = new Map<
    string,
    { server: LanguageServer; idle: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly specs: readonly ServerSpec[] = servers(),
    private readonly options: {
      run?: Run;
      idleAfter?: number;
      patience?: number;
      markersPatience?: number;
      problemsPatience?: number;
    } = {},
  ) {}

  /** How many are running. */
  get size(): number {
    return this.#running.size;
  }

  /**
   * The server for a file in a worktree, started if it isn't; none for a language without one, or
   * for a file outside any project its server needs.
   */
  serverFor(
    worktree: string,
    path: string,
  ): { server: LanguageServer; languageId: string } | undefined {
    const found = serverFor(path, this.specs);
    if (!found || !inProject(worktree, path, found.spec.projectFiles)) return undefined;
    const key = `${worktree}\u0000${found.spec.id}`;
    let entry = this.#running.get(key);
    if (!entry) {
      const server = new LanguageServer(
        found.spec,
        worktree,
        () => {
          this.#forget(key, server);
        },
        this.options.run,
      );
      entry = { server, idle: this.#idle(key) };
      this.#running.set(key, entry);
    } else {
      clearTimeout(entry.idle);
      entry.idle = this.#idle(key);
    }
    return { server: entry.server, languageId: found.languageId };
  }

  /** Starts the file's server and opens the file in it, so it's ready when asked. */
  open(worktree: string, file: OpenFile): void {
    const found = this.serverFor(worktree, file.path);
    if (!found) return;
    found.server.ready.then(
      () => {
        found.server.sync(file, found.languageId);
      },
      () => undefined,
    );
  }

  /** Where the symbol at a place is defined; null when no server answers in time. */
  definitions(worktree: string, file: OpenFile, at: Located): Promise<Located[] | null> {
    return this.#ask(worktree, file, (server, languageId) =>
      server.definitions(file, languageId, at),
    );
  }

  /** Where the symbol at a place is used; null when no server answers in time. */
  usages(worktree: string, file: OpenFile, at: Located): Promise<Located[] | null> {
    return this.#ask(worktree, file, (server, languageId) => server.usages(file, languageId, at));
  }

  /** Where the symbol at a place is in its file; null when no server answers in time. */
  highlights(worktree: string, file: OpenFile, at: Located): Promise<Highlight[] | null> {
    return this.#ask(worktree, file, (server, languageId) =>
      server.highlights(file, languageId, at),
    );
  }

  /** A file's problems, from its server; null when there's none, or no answer in time. */
  problems(worktree: string, file: OpenFile): Promise<Problem[] | null> {
    return this.#ask(
      worktree,
      file,
      (server, languageId) => server.problems(file, languageId),
      this.options.problemsPatience ?? PROBLEMS_PATIENCE,
    );
  }

  /** What Alt+Enter offers at a place; null when no server answers in time. */
  contextActions(worktree: string, file: OpenFile, at: Located): Promise<ContextAction[] | null> {
    return this.#ask(worktree, file, (server, languageId) =>
      server.contextActions(file, languageId, at),
    );
  }

  /**
   * A file's gutter markers: what its types and members implement or override, and what implements
   * or overrides them. Other files are read from disk, or as the server has them when open.
   */
  async markers(worktree: string, file: OpenFile): Promise<Marker[] | null> {
    const found = this.serverFor(worktree, file.path);
    if (!found) return null;
    const { server } = found;
    /** A file as the server has it, or as it is on disk, opened in the server. */
    const known = async (
      path: string,
    ): Promise<{ file: OpenFile; languageId: string } | undefined> => {
      const languageId = serverFor(path, this.specs)?.languageId ?? found.languageId;
      if (path === file.path) return { file, languageId };
      const open = server.opened(path);
      if (open) return { file: open, languageId };
      try {
        return { file: { path, text: await readFile(path, 'utf8') }, languageId };
      } catch {
        return undefined;
      }
    };
    // Asked only about places in files already read.
    const at = async (place: Located, question: 'definitions' | 'implementations') => {
      const k = (await known(place.path)) as { file: OpenFile; languageId: string };
      return server[question](k.file, k.languageId, place);
    };
    try {
      const answer = await within(
        markersOf(file.path, {
          symbols: async (path) => {
            const k = await known(path);
            return k ? server.symbols(k.file, k.languageId) : [];
          },
          definitions: (place) => at(place, 'definitions'),
          implementations: (place) => at(place, 'implementations'),
          text: async (path) => (await known(path))?.file.text,
        }),
        this.options.markersPatience ?? MARKERS_PATIENCE,
      );
      return answer ?? null;
    } catch {
      return null;
    }
  }

  /** Stops them all. */
  async dispose(): Promise<void> {
    const running = [...this.#running.values()];
    this.#running.clear();
    await Promise.all(
      running.map(({ server, idle }) => {
        clearTimeout(idle);
        return server.stop();
      }),
    );
  }

  async #ask<T>(
    worktree: string,
    file: OpenFile,
    question: (server: LanguageServer, languageId: string) => Promise<T[]>,
    patience = this.options.patience ?? PATIENCE,
  ): Promise<T[] | null> {
    const found = this.serverFor(worktree, file.path);
    if (!found) return null;
    try {
      const answer = await within(question(found.server, found.languageId), patience);
      return answer ?? null;
    } catch {
      return null;
    }
  }

  #idle(key: string): ReturnType<typeof setTimeout> {
    // Cleared whenever its server is forgotten, so the server is still there.
    const timer = setTimeout(() => {
      const entry = this.#running.get(key) as { server: LanguageServer };
      this.#running.delete(key);
      void entry.server.stop();
    }, this.options.idleAfter ?? IDLE_AFTER);
    timer.unref();
    return timer;
  }

  #forget(key: string, server: LanguageServer): void {
    const entry = this.#running.get(key);
    if (entry?.server !== server) return;
    clearTimeout(entry.idle);
    this.#running.delete(key);
  }
}
