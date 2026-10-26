// The host's methods, on a connection to the UI.

import { Connection, ErrorCodes, LineReader, ResponseError } from '@cerebro-ide/protocol';
import { git as runGit, listWorktrees, type Git } from './git.js';

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
  connection.onRequest('git.worktrees', async (params) => {
    const repo = (params as { repo?: unknown } | null)?.repo ?? options.repo;
    if (typeof repo !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'repo must be a path');
    }
    return listWorktrees(repo, git);
  });
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
