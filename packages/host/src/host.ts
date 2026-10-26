// The host's methods, on a connection to the UI.

import { chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Connection, ErrorCodes, LineReader, ResponseError } from '@cerebro-ide/protocol';
import { spawn as spawnPty } from 'node-pty';
import { Terminals, type SpawnPty } from './terminals.js';
import { IndexService } from './index-service.js';
import { listFolder, readTextFile, UnreadableFile } from './files.js';
import {
  addWorktree,
  committedText,
  git as runGit,
  listChanges,
  listFiles,
  listWorktrees,
  removeWorktree,
  type Git,
} from './git.js';

/** The protocol's version: the UI checks it on connecting. */
export const PROTOCOL_VERSION = 1;

export interface HostOptions {
  /** The repository opened when a request names none. */
  repo: string;
  git?: Git;
  pty?: SpawnPty;
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
  connection.onRequest('fs.list', (params) => listFolder(text(params, 'path')));
  const index = new IndexService(git, Date.now, (worktree, done, total) => {
    connection.notify('index.progress', { worktree, done, total });
  });
  connection.onRequest('index.warm', (params) => {
    index.warm(text(params, 'worktree'));
    return null;
  });
  connection.onRequest('index.symbols', (params) =>
    index.symbols(text(params, 'worktree'), text(params, 'query')),
  );
  connection.onRequest('index.definitions', (params) =>
    index.definitions(text(params, 'worktree'), text(params, 'name')),
  );
  connection.onRequest('index.usages', (params) =>
    index.usages(text(params, 'worktree'), text(params, 'name')),
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
  connection.onRequest('git.changes', (params) => listChanges(text(params, 'path'), git));
  // A file's two sides for its diff: as last committed (where it was, if renamed), and as it is.
  connection.onRequest('git.diff', async (params) => {
    const worktree = text(params, 'path');
    const file = text(params, 'file');
    const change = (await listChanges(worktree, git)).find((c) => c.path === file);
    const [original, current] = await Promise.all([
      committedText(worktree, change?.from ?? file, git),
      change?.status === 'deleted' ? '' : read(join(worktree, file)),
    ]);
    return { original, text: current };
  });
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
  connection.onRequest('terminal.open', (params) => {
    const p = params as { command?: unknown; args?: unknown };
    return terminals.open({
      key: text(params, 'key'),
      cwd: text(params, 'cwd'),
      ...(typeof p.command === 'string' ? { command: p.command } : {}),
      ...(Array.isArray(p.args) ? { args: p.args.map(String) } : {}),
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
