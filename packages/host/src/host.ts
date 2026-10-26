// The host's methods, on a connection to the UI.

import { Connection, ErrorCodes, LineReader, ResponseError } from '@cerebro-ide/protocol';
import { IndexService } from './index-service.js';
import { listFolder, readTextFile, UnreadableFile } from './files.js';
import {
  addWorktree,
  git as runGit,
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
}

/** Registers the host's methods on `connection`. */
export function serveOn(connection: Connection, options: HostOptions): void {
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
  const index = new IndexService(git);
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
  connection.onRequest('fs.read', async (params) => {
    try {
      return { text: await readTextFile(text(params, 'path')) };
    } catch (error) {
      // Binary and oversized files are refused with the reason, for the editor to show.
      if (error instanceof UnreadableFile) {
        throw new ResponseError(ErrorCodes.InvalidParams, error.message, { reason: error.reason });
      }
      throw error;
    }
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
  serveOn(connection, options);
  const reader = new LineReader((line) => {
    connection.receive(line);
  });
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    reader.push(chunk);
  });
  input.on('end', () => {
    connection.close();
  });
  return connection;
}
