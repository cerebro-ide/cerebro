// Language servers, for precise go to definition and find usages: the host's own LSP client over a
// server's stdin and stdout, and a lazy pool of servers, one per worktree and server, started on
// first use and stopped after a while unused (decision "Many worktrees must be proven solvable":
// agents don't use them, so only worktrees the human looks at have one).
//
// The UI sends a file's text with each request, so a file with unsaved edits is answered as it
// is. An answer that doesn't come in time (a server still loading its project) is given up on:
// the UI shows the index's name matches meanwhile.

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Connection } from '@cerebro-ide/protocol';
import { frame, FrameReader } from './framing.js';
import { serverFor, servers, type ServerSpec } from '@cerebro-ide/servers';

/** A place in a file, zero-based, its path with `/` on every OS. */
export interface Located {
  path: string;
  line: number;
  column: number;
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
/** How long a server is given to stop before it's killed. */
const STOP_WAIT = 2_000;

/** Starts a server's process: what tests replace. */
export type Run = (command: string, args: string[], cwd: string) => ChildProcess;

const runProcess: Run = (command, args, cwd) =>
  spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });

/** A path as a file URI. */
export function uriOf(path: string): string {
  return pathToFileURL(path).href;
}

/** A file URI as a path with `/`, a Windows drive in capitals, as git writes them. */
export function pathOf(uri: string, platform: NodeJS.Platform = process.platform): string {
  const path = fileURLToPath(uri, { windows: platform === 'win32' }).replaceAll('\\', '/');
  return path.replace(/^[a-z]:/, (drive) => drive.toUpperCase());
}

interface Range {
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

/** One server's process, for one worktree. */
export class LanguageServer {
  /** Resolves once the server has answered `initialize`. */
  readonly ready: Promise<void>;
  readonly #connection: Connection;
  readonly #process: ChildProcess;
  /** The files it has open, by URI: their version and text. */
  readonly #documents = new Map<string, { version: number; text: string }>();
  #exited = false;

  constructor(spec: ServerSpec, root: string, onExit: () => void, run: Run = runProcess) {
    const { command, args } = spec.command();
    this.#process = run(command, args, root);
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
    const folders = [{ uri: uriOf(root), name: root.slice(root.lastIndexOf('/') + 1) }];
    this.#connection.onRequest('workspace/workspaceFolders', () => folders);
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
          },
          workspace: { configuration: true, workspaceFolders: true },
        },
      })
      .then(() => {
        this.#connection.notify('initialized', {});
      });
    // A server that fails to start exits, and is forgotten then: no one need wait on it.
    this.ready.catch(() => undefined);
  }

  get exited(): boolean {
    return this.#exited;
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

  /** Asks it to stop, and kills it if it doesn't. */
  async stop(): Promise<void> {
    if (this.#exited) return;
    const kill = setTimeout(() => this.#process.kill(), STOP_WAIT);
    try {
      await this.#connection.request('shutdown');
      this.#connection.notify('exit');
    } catch {
      this.#process.kill();
    } finally {
      clearTimeout(kill);
    }
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

/** The servers running, one per worktree and server, started as they're needed. */
export class LanguageServers {
  readonly #running = new Map<
    string,
    { server: LanguageServer; idle: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly specs: readonly ServerSpec[] = servers(),
    private readonly options: { run?: Run; idleAfter?: number; patience?: number } = {},
  ) {}

  /** How many are running. */
  get size(): number {
    return this.#running.size;
  }

  /** The server for a file in a worktree, started if it isn't; none for a language without one. */
  serverFor(
    worktree: string,
    path: string,
  ): { server: LanguageServer; languageId: string } | undefined {
    const found = serverFor(path, this.specs);
    if (!found) return undefined;
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

  async #ask(
    worktree: string,
    file: OpenFile,
    question: (server: LanguageServer, languageId: string) => Promise<Located[]>,
  ): Promise<Located[] | null> {
    const found = this.serverFor(worktree, file.path);
    if (!found) return null;
    try {
      const answer = await within(
        question(found.server, found.languageId),
        this.options.patience ?? PATIENCE,
      );
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
