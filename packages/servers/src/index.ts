// The language servers Cerebro runs, by language, and how each is started: the precise half of
// navigation (the index's name matches are the other). Each server is a dependency of this
// package, so it comes installed with Cerebro.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** A program to run, speaking LSP on its stdin and stdout. */
export interface ServerCommand {
  command: string;
  args: string[];
  /** Variables to set, over the host's own. */
  env?: Record<string, string>;
}

export interface ServerSpec {
  /** Names the server: one runs per worktree and server. */
  id: string;
  /** The LSP language id for a file it serves, or undefined for one it doesn't. */
  languageOf(path: string): string | undefined;
  /** How to start it. */
  command(): ServerCommand;
  /**
   * Files that make a project it sees whole, one of which must be in a file's folder or above
   * (within the worktree) for it to be asked: without one, it sees only the files it's shown.
   */
  projectFiles?: readonly string[];
  /**
   * A line it logs once it's read the project (`window/logMessage`), before which its answers miss
   * files: questions wait for it.
   */
  readyWhen?: RegExp;
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
    // Without one, TypeScript's server makes a project of the open files alone: no usages in the
    // others (measured: "No usages" where main.ts calls lib.ts's run, main.ts not open).
    projectFiles: ['tsconfig.json', 'jsconfig.json'],
    command: () => {
      const platformPackage = resolve(`@typescript/typescript-${platform}-${arch}/package.json`);
      const exe = join(dirname(platformPackage), 'lib', platform === 'win32' ? 'tsc.exe' : 'tsc');
      return { command: exe, args: ['--lsp', '--stdio'] };
    },
  };
}

/** Resolves from this package, where the servers written in JavaScript are installed. */
const fromHere: Resolve = (id) => createRequire(import.meta.url).resolve(id);

/**
 * basedpyright's language server, for Python: pyright's, with its fixes. JavaScript, run by the
 * Node the host runs in (Electron's own binary, as Node, in the app).
 */
export function pythonServer(
  node: string = process.execPath,
  resolve: Resolve = fromHere,
): ServerSpec {
  return {
    id: 'python',
    languageOf: (path) => {
      const ext = extension(path);
      return ext === '.py' || ext === '.pyi' ? 'python' : undefined;
    },
    // Asked before it's found the folder's files, it answers as if there were none but the open
    // ones (measured: no usages in an unopened file at once, found 3 s later). It logs this then.
    readyWhen: /^(Found \d+ source files?|No source files found)/,
    command: () => ({
      command: node,
      args: [resolve('basedpyright/langserver.index.js'), '--stdio'],
    }),
  };
}

/**
 * A PATH without the Windows folders WSL adds to it (`/mnt/c/...`): reading them is slow, and a
 * server that lists the PATH's programs waits on it (measured: bash-language-server started in
 * 5.8 s under WSL with them, 257 ms without).
 */
export function withoutWindowsFolders(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'linux') return path;
  return path
    .split(':')
    .filter((folder) => !/^\/mnt\/[a-z]\//i.test(folder))
    .join(':');
}

/**
 * bash-language-server, for shell scripts: tree-sitter's, run by the Node the host runs in. It lists
 * the PATH's programs (for completions) before it answers anything.
 */
export function bashServer(
  node: string = process.execPath,
  resolve: Resolve = fromHere,
  path: string = process.env['PATH'] ?? '',
): ServerSpec {
  return {
    id: 'bash',
    languageOf: (file) => {
      const ext = extension(file);
      return ext === '.sh' || ext === '.bash' ? 'shellscript' : undefined;
    },
    // Asked before it's read the folder's scripts, it finds no usages in the others (measured: none
    // at once, found 3 s later). It logs the end of that reading, however it ends.
    readyWhen: /BackgroundAnalysis: (Completed|skipping|stopped|failed resolving)/,
    command: () => ({
      command: node,
      args: [resolve('bash-language-server/out/cli.js'), 'start'],
      env: { PATH: withoutWindowsFolders(path) },
    }),
  };
}

/**
 * The servers that run, in the order they're asked whether they serve a file: every one, or those
 * named in `only` (ids, comma-separated; empty for none), as CEREBRO_LANGUAGE_SERVERS says, for
 * tests of what shows without them, and to rule a server out when something's wrong.
 */
export function servers(only?: string): ServerSpec[] {
  const all = [typescriptServer(), pythonServer(), bashServer()];
  if (only === undefined) return all;
  const ids = new Set(only.split(',').map((id) => id.trim()));
  return all.filter((spec) => ids.has(spec.id));
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
