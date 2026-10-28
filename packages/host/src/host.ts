// The host's methods, on a connection to the UI.

import { chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Connection, ErrorCodes, LineReader, ResponseError } from '@cerebro-ide/protocol';
import { spawn as spawnPty } from 'node-pty';
import { Terminals, type SpawnPty } from './terminals.js';
import { hookSettings, listenForHooks, socketPath } from './agents.js';
import { listTurns, TurnRecorder } from './turns.js';
import { IndexService } from './index-service.js';
import { exists, listFolder, readTextFile, UnreadableFile, writeTextFile } from './files.js';
import { BadQuery, searchText } from './search.js';
import { LanguageServers } from './lsp.js';
import {
  addWorktree,
  committedText,
  git as runGit,
  listChanges,
  listChangesBetween,
  listIgnored,
  rollback,
  textAt,
  listFiles,
  listWorktrees,
  removeWorktree,
  type Git,
  ignoredAmong,
} from './git.js';

/** The protocol's version: the UI checks it on connecting. */
export const PROTOCOL_VERSION = 1;

export interface HostOptions {
  /** The repository opened when a request names none. */
  repo: string;
  git?: Git;
  pty?: SpawnPty;
  /** The command an agent's hooks run, the hook's name after it. Default: this host's entry. */
  hookCommand?: string;
  /** The language servers. Default: Cerebro's own, started as needed. */
  languageServers?: LanguageServers;
  /** ripgrep, for Find in Files. Default: @vscode/ripgrep's. */
  rg?: string;
}

/** A word for a POSIX shell: quoted, as it is. */
export function shellWord(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/** The hooks' command: this host's own entry point, run as Node, as a hook client. */
export function defaultHookCommand(
  execPath = process.execPath,
  entry = process.argv[1] ?? '',
): string {
  return `ELECTRON_RUN_AS_NODE=1 ${shellWord(execPath)} ${shellWord(entry)} hook`;
}

/**
 * Makes node-pty's macOS helper executable. node-pty 1.1.0 publishes it without the execute bit
 * (mode 0644 in the package's file list), and spawns through it from its prebuilds, so every spawn
 * fails with "posix_spawnp failed" until the bit is set.
 */
export function makeSpawnHelperExecutable(platform = process.platform, arch = process.arch): void {
  if (platform !== 'darwin') return;
  const root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  try {
    chmodSync(join(root, 'prebuilds', `darwin-${arch}`, 'spawn-helper'), 0o755);
  } catch {
    // No prebuild for this architecture: node-pty built its own, which is executable.
  }
}

/** node-pty's spawn, as terminals use it. */
export const nodePty: SpawnPty = (file, args, options) => {
  makeSpawnHelperExecutable();
  return spawnPty(file, args, { name: 'xterm-256color', ...options });
};

/** Registers the host's methods on `connection`; the function returned ends what they started. */
export function serveOn(connection: Connection, options: HostOptions): () => void {
  const git = options.git ?? runGit;
  connection.onRequest('host.ping', () => ({ version: PROTOCOL_VERSION }));
  /** The repository a request names, else the host's own. */
  const repoOf = (params: unknown): string => {
    const repo = (params as { repo?: unknown } | null)?.repo ?? options.repo;
    if (typeof repo !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'repo must be a path');
    }
    return repo;
  };
  const text = (params: unknown, key: string): string => {
    const value = (params as Record<string, unknown> | null)?.[key];
    if (typeof value !== 'string' || value === '') {
      throw new ResponseError(ErrorCodes.InvalidParams, `${key} must be a non-empty string`);
    }
    return value;
  };
  connection.onRequest('git.worktrees', (params) => listWorktrees(repoOf(params), git));
  // A folder's entries; those git ignores say so, for the Project tree to show them dimmed.
  connection.onRequest('fs.list', async (params) => {
    const folder = text(params, 'path');
    const entries = await listFolder(folder);
    const ignored = await ignoredAmong(
      folder,
      entries.map((e) => e.name),
      git,
    );
    return entries.map((e) => (ignored.has(e.name) ? { ...e, ignored: true } : e));
  });
  const index = new IndexService(git, Date.now, (worktree, done, total) => {
    connection.notify('index.progress', { worktree, done, total });
  });
  connection.onRequest('index.warm', (params) => {
    index.warm(text(params, 'worktree'));
    return null;
  });
  connection.onRequest('index.symbols', (params) => {
    // Only of these kinds, when given: Search Everywhere's Classes.
    const { kinds } = params as { kinds?: unknown };
    if (
      kinds !== undefined &&
      !(Array.isArray(kinds) && kinds.every((k) => typeof k === 'string'))
    ) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'kinds must be strings');
    }
    return index.symbols(text(params, 'worktree'), text(params, 'query'), kinds);
  });
  connection.onRequest('index.definitions', (params) =>
    index.definitions(text(params, 'worktree'), text(params, 'name')),
  );
  connection.onRequest('index.usages', (params) =>
    index.usages(text(params, 'worktree'), text(params, 'name')),
  );
  // Language servers: precise navigation, given the file as the UI has it, and a place in it.
  // null when no server answers (none for the language, or still loading): the UI falls back to
  // the index's name matches.
  const servers = options.languageServers ?? new LanguageServers();
  const fileOf = (params: unknown) => {
    const value = (params as { text?: unknown } | null)?.text;
    if (typeof value !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'text must be a string');
    }
    return { path: text(params, 'path'), text: value };
  };
  const placeOf = (params: unknown) => {
    const { line, column } = params as { line?: unknown; column?: unknown };
    if (!Number.isInteger(line) || !Number.isInteger(column)) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'line and column must be integers');
    }
    return { path: '', line: line as number, column: column as number };
  };
  connection.onRequest('lsp.open', (params) => {
    servers.open(text(params, 'worktree'), fileOf(params));
    return null;
  });
  connection.onRequest('lsp.definitions', (params) =>
    servers.definitions(text(params, 'worktree'), fileOf(params), placeOf(params)),
  );
  connection.onRequest('lsp.usages', (params) =>
    servers.usages(text(params, 'worktree'), fileOf(params), placeOf(params)),
  );
  connection.onRequest('lsp.highlights', (params) =>
    servers.highlights(text(params, 'worktree'), fileOf(params), placeOf(params)),
  );
  connection.onRequest('git.files', (params) => listFiles(text(params, 'path'), git));
  /** A file's text; binary and oversized files are refused with the reason, for the UI to show. */
  const read = async (path: string): Promise<string> => {
    try {
      return await readTextFile(path);
    } catch (error) {
      if (error instanceof UnreadableFile) {
        throw new ResponseError(ErrorCodes.InvalidParams, error.message, { reason: error.reason });
      }
      throw error;
    }
  };
  connection.onRequest('fs.read', async (params) => ({ text: await read(text(params, 'path')) }));
  // Whether a file that couldn't be read was deleted: the page closes its tabs, as IntelliJ.
  connection.onRequest('fs.exists', (params) => exists(text(params, 'path')));
  // Only the latest search's answer is used (the page searches as the user types): a new one stops
  // the one still running.
  let searching: AbortController | undefined;
  connection.onRequest('search.text', async (params) => {
    const p = params as {
      matchCase?: unknown;
      words?: unknown;
      regex?: unknown;
      masks?: unknown;
      replace?: unknown;
      limit?: unknown;
    };
    if (p.replace !== undefined && typeof p.replace !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'replace must be a string');
    }
    if (p.limit !== undefined && !(Number.isInteger(p.limit) && (p.limit as number) > 0)) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'limit must be a positive integer');
    }
    const masks = p.masks ?? [];
    if (!Array.isArray(masks) || masks.some((mask) => typeof mask !== 'string')) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'masks must be strings');
    }
    searching?.abort();
    const controller = new AbortController();
    searching = controller;
    try {
      return await searchText(
        text(params, 'path'),
        {
          query: text(params, 'query'),
          matchCase: p.matchCase === true,
          words: p.words === true,
          regex: p.regex === true,
          masks: masks as string[],
          ...(p.replace === undefined ? {} : { replace: p.replace }),
          ...(p.limit === undefined ? {} : { limit: p.limit as number }),
        },
        options.rg,
        controller.signal,
      );
    } catch (error) {
      if (error instanceof BadQuery)
        throw new ResponseError(ErrorCodes.InvalidParams, error.message);
      throw error;
    }
  });
  connection.onRequest('fs.write', async (params) => {
    const content = (params as { text?: unknown }).text;
    if (typeof content !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'text must be a string');
    }
    await writeTextFile(text(params, 'path'), content);
    return null;
  });
  /** A request's commits to compare (a turn's snapshots), if it names them. */
  const range = (params: unknown): { from: string; to: string } | undefined => {
    const p = params as { from?: unknown; to?: unknown };
    return typeof p.from === 'string' && typeof p.to === 'string'
      ? { from: p.from, to: p.to }
      : undefined;
  };
  // A worktree's changes since its last commit, or from one commit to another.
  connection.onRequest('git.changes', (params) => {
    const worktree = text(params, 'path');
    const between = range(params);
    return between
      ? listChangesBetween(worktree, between.from, between.to, git)
      : listChanges(worktree, git);
  });
  // A file's two sides for its diff: as last committed (where it was, if renamed), and as it is;
  // or at one commit and another.
  connection.onRequest('git.diff', async (params) => {
    const worktree = text(params, 'path');
    const file = text(params, 'file');
    const between = range(params);
    if (between) {
      const change = (await listChangesBetween(worktree, between.from, between.to, git)).find(
        (c) => c.path === file,
      );
      const [original, current] = await Promise.all([
        textAt(worktree, between.from, change?.from ?? file, git),
        textAt(worktree, between.to, file, git),
      ]);
      return { original, text: current };
    }
    const change = (await listChanges(worktree, git)).find((c) => c.path === file);
    const [original, current] = await Promise.all([
      committedText(worktree, change?.from ?? file, git),
      change?.status === 'deleted' ? '' : read(join(worktree, file)),
    ]);
    return { original, text: current };
  });
  connection.onRequest('git.ignored', (params) => listIgnored(text(params, 'path'), git));
  // Rolls back the files named, as they're changed now; gives the changes left.
  connection.onRequest('git.rollback', async (params) => {
    const worktree = text(params, 'path');
    const p = params as { files?: unknown; deleteAdded?: unknown };
    if (!Array.isArray(p.files) || !p.files.every((f) => typeof f === 'string')) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'files must be a list of paths');
    }
    const files = new Set(p.files);
    const changes = (await listChanges(worktree, git)).filter((c) => files.has(c.path));
    await rollback(worktree, changes, p.deleteAdded === true, git);
    return listChanges(worktree, git);
  });
  connection.onRequest('agent.turns', (params) => listTurns(text(params, 'path'), git));
  connection.onRequest('git.addWorktree', (params) => {
    const p = params as { create?: unknown; from?: unknown } | null;
    return addWorktree(
      repoOf(params),
      {
        path: text(params, 'path'),
        branch: text(params, 'branch'),
        create: p?.create === true,
        ...(typeof p?.from === 'string' ? { from: p.from } : {}),
      },
      git,
    );
  });
  connection.onRequest('git.removeWorktree', (params) =>
    removeWorktree(
      repoOf(params),
      text(params, 'path'),
      (params as { force?: unknown }).force === true,
      git,
    ),
  );
  const terminals = new Terminals(options.pty ?? nodePty, (method, params) => {
    connection.notify(method, params);
  });
  const id = (params: unknown): number => {
    const value = (params as { id?: unknown } | null)?.id;
    if (typeof value !== 'number') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'id must be a number');
    }
    return value;
  };
  const size = (params: unknown, key: 'cols' | 'rows'): number => {
    const value = (params as Record<string, unknown>)[key];
    return typeof value === 'number' && value > 0 ? Math.floor(value) : key === 'cols' ? 80 : 24;
  };
  // Agents report their status through hooks, to a socket of this host's.
  const hooks = socketPath();
  // Each agent's folder, and its turns' snapshots.
  const agents = new Map<string, string>();
  const turns = new TurnRecorder(git);
  const record = (snapshot: Promise<void>) =>
    snapshot.catch((error: unknown) => {
      console.error('A turn’s snapshot failed', error);
    });
  const hookServer = listenForHooks(hooks, (status) => {
    connection.notify('agent.status', status);
    const worktree = agents.get(status.key);
    // The agent waits for the snapshot before its turn, so the turn's changes come after it.
    if (status.event === 'UserPromptSubmit' && worktree !== undefined) {
      return record(turns.started(status.key, worktree, status.prompt ?? ''));
    }
    if (status.event === 'Stop') void record(turns.ended(status.key));
    return undefined;
  });
  const hookCommand = options.hookCommand ?? defaultHookCommand();
  connection.onRequest('terminal.open', (params) => {
    const p = params as { command?: unknown; args?: unknown; agent?: unknown };
    const key = text(params, 'key');
    const cwd = text(params, 'cwd');
    const args = Array.isArray(p.args) ? p.args.map(String) : [];
    if (p.agent === true) agents.set(key, cwd);
    // An agent (Claude Code) runs with Cerebro's hooks, which say which agent they're from.
    const agent =
      p.agent === true
        ? {
            args: ['--settings', hookSettings(hookCommand), ...args],
            env: { CEREBRO_HOOK_SOCKET: hooks, CEREBRO_AGENT_KEY: key },
          }
        : Array.isArray(p.args)
          ? { args }
          : {};
    return terminals.open({
      key,
      cwd,
      ...(typeof p.command === 'string' ? { command: p.command } : {}),
      ...agent,
      cols: size(params, 'cols'),
      rows: size(params, 'rows'),
    });
  });
  connection.onRequest('terminal.write', (params) => {
    terminals.write(id(params), text(params, 'data'));
    return null;
  });
  connection.onRequest('terminal.resize', (params) => {
    terminals.resize(id(params), size(params, 'cols'), size(params, 'rows'));
    return null;
  });
  connection.onRequest('terminal.close', (params) => {
    terminals.close(id(params));
    return null;
  });
  return () => {
    terminals.closeAll();
    hookServer.close();
    void servers.dispose();
  };
}

/** Serves the host over a pair of streams, as the UI's child process does over stdio. */
export function serve(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  options: HostOptions,
): Connection {
  const connection = new Connection((line) => {
    output.write(`${line}\n`);
  });
  const stop = serveOn(connection, options);
  const reader = new LineReader((line) => {
    connection.receive(line);
  });
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    reader.push(chunk);
  });
  input.on('end', () => {
    stop();
    connection.close();
  });
  return connection;
}
