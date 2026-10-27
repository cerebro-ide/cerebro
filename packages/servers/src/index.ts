// The language servers Cerebro runs, by language, and how each is started: the precise half of
// navigation (the index's name matches are the other). Each server is a dependency of this
// package, so it comes installed with Cerebro.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** A program to run, speaking LSP on its stdin and stdout. */
export interface ServerCommand {
  command: string;
  args: string[];
}

export interface ServerSpec {
  /** Names the server: one runs per worktree and server. */
  id: string;
  /** The LSP language id for a file it serves, or undefined for one it doesn't. */
  languageOf(path: string): string | undefined;
  /** How to start it. */
  command(): ServerCommand;
}

/** Resolves a module, as Node would: what tests replace. */
export type Resolve = (id: string) => string;

/** Resolves from TypeScript's own folder, where its platform packages are found. */
const fromTypescript: Resolve = (id) =>
  createRequire(createRequire(import.meta.url).resolve('typescript/package.json')).resolve(id);

const extension = (path: string) => /\.[^./\\]+$/.exec(path)?.[0].toLowerCase();

const TYPESCRIPT: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
};

/**
 * TypeScript 7's own language server (`tsc --lsp --stdio`): the native compiler, which serves
 * JavaScript too. Its executable comes in a package per platform, found as TypeScript's own
 * launcher finds it (lib/getExePath.js).
 */
export function typescriptServer(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  resolve: Resolve = fromTypescript,
): ServerSpec {
  return {
    id: 'typescript',
    languageOf: (path) => {
      const ext = extension(path);
      return ext === undefined ? undefined : TYPESCRIPT[ext];
    },
    command: () => {
      const platformPackage = resolve(`@typescript/typescript-${platform}-${arch}/package.json`);
      const exe = join(dirname(platformPackage), 'lib', platform === 'win32' ? 'tsc.exe' : 'tsc');
      return { command: exe, args: ['--lsp', '--stdio'] };
    },
  };
}

/** Every server, in the order they're asked whether they serve a file. */
export function servers(): ServerSpec[] {
  return [typescriptServer()];
}

/** The server for a file, and the file's language id, if one serves it. */
export function serverFor(
  path: string,
  specs: readonly ServerSpec[] = servers(),
): { spec: ServerSpec; languageId: string } | undefined {
  for (const spec of specs) {
    const languageId = spec.languageOf(path);
    if (languageId !== undefined) return { spec, languageId };
  }
  return undefined;
}
