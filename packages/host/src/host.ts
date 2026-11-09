// The host's methods, on a connection to the UI.

import { createHash } from 'node:crypto';
import { chmodSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { Connection, ErrorCodes, LineReader, ResponseError } from '@cerebro-ide/protocol';
import { spawn as spawnPty } from 'node-pty';
import { Terminals, type SpawnPty } from './terminals.js';
import { hookSettings, listenForHooks, socketPath } from './agents.js';
import { AskPass, listenForAskPass, writeAskPassScripts, type Answer } from './askpass.js';
import { listTurns, TurnRecorder } from './turns.js';
import {
  fileHistory,
  record as recordHistory,
  recordSave,
  recording,
  revert,
  textIn,
} from './history.js';
import {
  clearStashes,
  deleteShelf,
  dropStash,
  listShelves,
  listStashes,
  shelve,
  stash,
  unshelve,
  unstash,
} from './shelf.js';
import { IndexService } from './index-service.js';
import { filesByRipgrep, folderFiles } from './folder-files.js';
import {
  exists,
  listFolder,
  readFileBytes,
  readTextFile,
  UnreadableFile,
  writeTextFile,
} from './files.js';
import { BadQuery, searchText } from './search.js';
import { LanguageServers } from './lsp.js';
import { formatWithPrettier } from './prettier.js';
import { update, type SaveChanges, type UpdateMethod } from './update.js';
import {
  addWorktree,
  commit,
  committedText,
  git as runGit,
  listChanges,
  listChangesBetween,
  listIgnored,
  lastMessage,
  listBranches,
  addRemote,
  checkRemote,
  divergence,
  fetchTarget,
  outgoing,
  push,
  listAuthors,
  log,
  rollback,
  textAt,
  listWorktrees,
  removeWorktree,
  type Git,
  type LogFilter,
  type PushTags,
  type TextFilter,
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
  /** The program and arguments git's askpass scripts run, `askpass` and more after them. */
  askPassCommand?: readonly string[];
  /** The language servers. Default: Cerebro's own, started as needed. */
  languageServers?: LanguageServers;
  /** ripgrep, for Find in Files. Default: @vscode/ripgrep's. */
  rg?: string;
  /** A folder to keep the index in between runs, a file per repository; without it, none is kept. */
  indexCache?: string;
}

/** Whether a request's `filter` is a log filter: its text, authors and dates, as given. */
function isLogFilter(filter: Partial<Record<keyof LogFilter, unknown>>): boolean {
  const { text, authors, after, before, paths } = filter as {
    text?: Partial<Record<keyof TextFilter, unknown>>;
    authors?: unknown;
    after?: unknown;
    before?: unknown;
    paths?: unknown;
  };
  const time = (value: unknown) => value === undefined || Number.isInteger(value);
  const strings = (value: unknown) =>
    value === undefined ||
    (Array.isArray(value) && value.every((v) => typeof v === 'string' && v !== ''));
  return (
    (text === undefined ||
      (typeof text.text === 'string' &&
        text.text.trim() !== '' &&
        typeof text.regex === 'boolean' &&
        typeof text.matchCase === 'boolean')) &&
    strings(authors) &&
    time(after) &&
    time(before) &&
    strings(paths)
  );
}

/** The repository's index file in the cache folder: named by a hash of its path. */
export function indexCacheFile(folder: string, repo: string): string {
  return join(folder, `${createHash('sha256').update(repo).digest('hex').slice(0, 16)}.json`);
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
  const index = new IndexService(
    git,
    Date.now,
    (worktree, done, total) => {
      connection.notify('index.progress', { worktree, done, total });
    },
    options.indexCache === undefined ? undefined : indexCacheFile(options.indexCache, options.repo),
    (folder) => filesByRipgrep(folder, options.rg),
  );
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
  /** How to format, and the part to: all of it unless `from` and `to` are given. */
  const formatOf = (params: unknown) => {
    const { tabSize, insertSpaces, from, to } = params as Record<string, unknown>;
    if (!Number.isInteger(tabSize) || typeof insertSpaces !== 'boolean') {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        'tabSize must be an integer, insertSpaces a boolean',
      );
    }
    const options = { tabSize: tabSize as number, insertSpaces };
    if (from === undefined && to === undefined) return { options };
    // Both, or neither.
    const [start, end] = [placeOf(from ?? {}), placeOf(to ?? {})];
    return {
      options,
      range: {
        from: { line: start.line, column: start.column },
        to: { line: end.line, column: end.column },
      },
    };
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
  connection.onRequest('lsp.problems', (params) =>
    servers.problems(text(params, 'worktree'), fileOf(params)),
  );
  connection.onRequest('lsp.hover', (params) =>
    servers.hover(text(params, 'worktree'), fileOf(params), placeOf(params)),
  );
  connection.onRequest('lsp.signatures', (params) =>
    servers.signatures(text(params, 'worktree'), fileOf(params), placeOf(params)),
  );
  connection.onRequest('lsp.renaming', (params) =>
    servers.renaming(text(params, 'worktree'), fileOf(params), placeOf(params)),
  );
  connection.onRequest('lsp.rename', (params) =>
    servers.rename(text(params, 'worktree'), fileOf(params), placeOf(params), text(params, 'name')),
  );
  connection.onRequest('lsp.format', (params) => {
    const { options, range } = formatOf(params);
    return servers.format(text(params, 'worktree'), fileOf(params), options, range);
  });
  connection.onRequest('lsp.completions', (params) =>
    servers.completions(text(params, 'worktree'), fileOf(params), placeOf(params)),
  );
  // The item as the server gave it, kept by the UI: only the server reads it.
  connection.onRequest('lsp.completionEdits', (params) =>
    servers.completionEdits(
      text(params, 'worktree'),
      text(params, 'path'),
      (params as { item?: unknown }).item,
    ),
  );
  connection.onRequest('lsp.contextActions', (params) =>
    servers.contextActions(text(params, 'worktree'), fileOf(params), placeOf(params)),
  );
  connection.onRequest('lsp.structure', (params) =>
    servers.structure(text(params, 'worktree'), fileOf(params)),
  );
  connection.onRequest('lsp.folds', (params) =>
    servers.folds(text(params, 'worktree'), fileOf(params)),
  );
  // Prettier, for its plugin: the file as the UI has it, or the part from `from` to `to` (offsets).
  connection.onRequest('prettier.format', (params) => {
    const { from, to, package: folder } = params as Record<string, unknown>;
    const range = from === undefined && to === undefined ? undefined : { from, to };
    if (range && !(Number.isInteger(range.from) && Number.isInteger(range.to))) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'from and to must be integers');
    }
    if (folder !== undefined && typeof folder !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'package must be a path');
    }
    return formatWithPrettier({
      ...fileOf(params),
      ...(range ? { range: range as { from: number; to: number } } : {}),
      ...(folder ? { package: folder } : {}),
    });
  });
  connection.onRequest('lsp.markers', (params) =>
    servers.markers(text(params, 'worktree'), fileOf(params)),
  );
  connection.onRequest('git.files', (params) => folderFiles(text(params, 'path'), git, options.rg));
  /** A file's text or bytes; binary (for text) and oversized files are refused with the reason. */
  const refusing = async <T>(reading: Promise<T>): Promise<T> => {
    try {
      return await reading;
    } catch (error) {
      if (error instanceof UnreadableFile) {
        throw new ResponseError(ErrorCodes.InvalidParams, error.message, { reason: error.reason });
      }
      throw error;
    }
  };
  const read = (path: string) => refusing(readTextFile(path));
  connection.onRequest('fs.read', async (params) => ({ text: await read(text(params, 'path')) }));
  // An image's bytes, in base64: JSON carries no bytes.
  connection.onRequest('fs.readBytes', async (params) => ({
    data: Buffer.from(await refusing(readFileBytes(text(params, 'path')))).toString('base64'),
  }));
  // Whether a file that couldn't be read was deleted: the page closes its tabs, as IntelliJ.
  connection.onRequest('fs.exists', (params) => exists(text(params, 'path')));
  // Only the latest search's answer is used (the page searches as the user types): a new one stops
  // the one still running.
  let searching: AbortController | undefined;

  /** Saves under way and their records, made after their answers, one after another. */
  let saves: Promise<void> = Promise.resolve();
  const recordSaved = async (
    path: string,
    texts: { before: string; after: string },
    label: string,
  ) => {
    try {
      const worktree = (await git(dirname(path), ['rev-parse', '--show-toplevel'])).trim();
      const file = relative(worktree, path).split(sep).join('/');
      await recordSave(worktree, file, texts, label, git);
    } catch {
      // Not in a git repository, or the record failed: the file's saved all the same.
    }
  };
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
    const path = text(params, 'path');
    // What made the change, for the Local History: Replace in Files; a plain save has none.
    const label = (params as { label?: unknown }).label;
    if (label !== undefined && typeof label !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'label must be a string');
    }
    const write = (async () => {
      const before = await readFile(path, 'utf8');
      await writeTextFile(path, content);
      return before;
    })();
    // Recorded after the answer: a record of the whole worktree takes a dozen git processes, over
    // a second for a save on Windows (CI). Records wait for the write too: git reading a file as
    // it's written over fails ("mmap failed", measured on Windows).
    saves = saves.then(() =>
      write.then(
        (before) => recordSaved(path, { before, after: content }, label ?? ''),
        () => undefined,
      ),
    );
    await write;
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
  // The Git tool window's Log: a page of commits, `max` after the first `skip`; of the branches
  // given, or of all; those a filter matches, if it's given.
  connection.onRequest('git.log', (params) => {
    const { skip, max, branches } = params as { skip?: unknown; max?: unknown; branches?: unknown };
    if (!Number.isInteger(skip) || !Number.isInteger(max)) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'skip and max must be integers');
    }
    if (
      branches !== undefined &&
      !(Array.isArray(branches) && branches.every((b) => typeof b === 'string' && b !== ''))
    ) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'branches must be names');
    }
    const { filter } = params as { filter?: Partial<Record<keyof LogFilter, unknown>> };
    if (filter !== undefined && !isLogFilter(filter)) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'filter must be a log filter');
    }
    return log(
      text(params, 'worktree'),
      skip as number,
      max as number,
      git,
      branches as string[] | undefined,
      filter as LogFilter | undefined,
    );
  });
  // The User filter's choices: the commits' authors, and who "me" is.
  connection.onRequest('git.authors', (params) => listAuthors(text(params, 'worktree'), git));
  // The Log's branches pane: the local and remote branches.
  connection.onRequest('git.branches', (params) => listBranches(text(params, 'worktree'), git));
  /** Where a request's push goes, if it says: a remote and a branch there. */
  const destination = (params: unknown) => {
    const p = params as { remote?: unknown; target?: unknown };
    return typeof p.remote === 'string' && typeof p.target === 'string'
      ? { remote: p.remote, target: p.target }
      : undefined;
  };
  // Credentials for git's remote commands: asked of the page, which answers with `askpass.answer`.
  const askSocket = socketPath();
  const scripts = writeAskPassScripts(
    options.askPassCommand ?? [process.execPath, process.argv[1] ?? ''],
  );
  const answers = new Map<string, (answer: Answer) => void>();
  let asked = 0;
  const askPass = new AskPass({
    socket: askSocket,
    scripts,
    display: process.env['DISPLAY'],
    prompt: (prompt) =>
      new Promise((resolve) => {
        const id = String(++asked);
        answers.set(id, resolve);
        connection.notify('askpass.prompt', { id, ...prompt });
      }),
    done: (session, failed) => {
      connection.notify('askpass.done', { session, failed });
    },
  });
  const askServer = listenForAskPass(askSocket, (message) => askPass.ask(message, git));
  connection.onRequest('askpass.answer', (params) => {
    const p = params as { answer?: unknown; useCredentialHelper?: unknown };
    const id = text(params, 'id');
    if (p.answer !== null && typeof p.answer !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'answer must be a string or null');
    }
    answers.get(id)?.({ answer: p.answer, useCredentialHelper: p.useCredentialHelper === true });
    answers.delete(id);
    return null;
  });
  // IntelliJ's "Use credential helper", as the page keeps it.
  connection.onRequest('askpass.configure', (params) => {
    askPass.useCredentialHelper =
      (params as { useCredentialHelper?: unknown }).useCredentialHelper === true;
    return null;
  });
  /** Git for remote commands, asking for credentials; silently, only what the page keeps. */
  const remote = askPass.git(git);
  const silentRemote = askPass.git(git, true);
  // What a push would send, and the push, of the checked-out branch: where it says, or by default.
  connection.onRequest('git.outgoing', (params) =>
    outgoing(text(params, 'path'), git, destination(params)),
  );
  connection.onRequest('git.push', (params) => {
    const to = destination(params);
    const p = params as { setUpstream?: unknown; tags?: unknown; force?: unknown; lease?: unknown };
    const setUpstream = p.setUpstream === true;
    if (p.tags !== undefined && p.tags !== 'all' && p.tags !== 'follow') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'tags must be all or follow');
    }
    const tags: { tags?: PushTags } = p.tags === undefined ? {} : { tags: p.tags };
    // A force push, expecting the remote's branch at `lease` when given.
    const force =
      p.force === true ? { force: typeof p.lease === 'string' ? { lease: p.lease } : {} } : {};
    return push(text(params, 'path'), remote, to && { ...to, setUpstream, ...tags, ...force });
  });
  // IntelliJ's check for a diverged remote, and its Fetch of the target to count what it has.
  connection.onRequest('git.divergence', (params) =>
    divergence(
      text(params, 'path'),
      { remote: text(params, 'remote'), target: text(params, 'target') },
      (params as { checkRemote?: unknown }).checkRemote === true,
      // As IntelliJ's check of the remote: without asking (`AuthenticationMode.SILENT`).
      silentRemote,
    ),
  );
  connection.onRequest('git.fetchTarget', (params) =>
    fetchTarget(
      text(params, 'path'),
      { remote: text(params, 'remote'), target: text(params, 'target') },
      remote,
    ),
  );
  // Update Project: the branch from its upstream, merged or rebased, local changes in the way saved
  // meanwhile (shelved or stashed).
  connection.onRequest('git.update', (params) => {
    const worktree = text(params, 'path');
    const p = params as { method?: unknown; save?: unknown };
    if (p.method !== 'merge' && p.method !== 'rebase') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'method must be merge or rebase');
    }
    if (p.save !== 'shelve' && p.save !== 'stash') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'save must be shelve or stash');
    }
    const options = { method: p.method as UpdateMethod, save: p.save as SaveChanges };
    return recording(worktree, 'Update Project', git, () => update(worktree, options, git, remote));
  });
  // Define Remote: whether its URL answers, and adding it.
  connection.onRequest('git.checkRemote', (params) =>
    checkRemote(text(params, 'path'), text(params, 'url'), remote),
  );
  connection.onRequest('git.addRemote', (params) =>
    addRemote(
      text(params, 'path'),
      {
        name: text(params, 'name'),
        url: text(params, 'url'),
        fetch: (params as { fetch?: unknown }).fetch === true,
      },
      remote,
    ),
  );
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
    await recording(worktree, 'Rollback', git, () =>
      rollback(worktree, changes, p.deleteAdded === true, git),
    );
    return listChanges(worktree, git);
  });
  // Commits the files named, as changed now, with the message given; gives the changes left.
  connection.onRequest('git.commit', async (params) => {
    const worktree = text(params, 'path');
    const message = text(params, 'message');
    const p = params as { files?: unknown; amend?: unknown };
    if (!Array.isArray(p.files) || !p.files.every((f) => typeof f === 'string')) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'files must be a list of paths');
    }
    const files = new Set(p.files);
    const changes = (await listChanges(worktree, git)).filter((c) => files.has(c.path));
    await commit(worktree, changes, message, p.amend === true, git);
    return listChanges(worktree, git);
  });
  /** A request's list of files, by path. */
  const files = (params: unknown): Set<string> => {
    const p = params as { files?: unknown };
    if (!Array.isArray(p.files) || !p.files.every((f) => typeof f === 'string')) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'files must be a list of paths');
    }
    return new Set(p.files);
  };
  /** A request's shelved list, stash or record, as the lists name them. */
  const named = (params: unknown, key: 'id' | 'ref' | 'commit', pattern: RegExp): string => {
    const value = text(params, key);
    if (!pattern.test(value)) throw new ResponseError(ErrorCodes.InvalidParams, `bad ${key}`);
    return value;
  };
  const SHELF_ID = /^\d+-\d+$/;
  /** A commit's full hash: the Local History's records. */
  const COMMIT = /^[0-9a-f]{40,64}$/;
  const STASH_REF = /^stash@\{\d+\}$/;
  const flag = (params: unknown, key: string) => (params as Record<string, unknown>)[key] === true;
  // Shelves the files named, as changed now, under the message given; gives the changes left.
  connection.onRequest('git.shelve', async (params) => {
    const worktree = text(params, 'path');
    const message = text(params, 'message');
    const named = files(params);
    const changes = (await listChanges(worktree, git)).filter((c) => named.has(c.path));
    await recording(worktree, 'Shelve Changes', git, () => shelve(worktree, changes, message, git));
    return listChanges(worktree, git);
  });
  connection.onRequest('git.shelves', (params) => listShelves(text(params, 'path'), git));
  connection.onRequest('git.unshelve', async (params) => {
    const worktree = text(params, 'path');
    const id = named(params, 'id', SHELF_ID);
    await recording(worktree, 'Unshelve', git, () => unshelve(worktree, id, git));
    return null;
  });
  connection.onRequest('git.deleteShelf', (params) =>
    deleteShelf(text(params, 'path'), named(params, 'id', SHELF_ID), git).then(() => null),
  );
  connection.onRequest('git.stashes', (params) => listStashes(text(params, 'path'), git));
  connection.onRequest('git.stash', (params) =>
    recording(text(params, 'path'), 'Stash Changes', git, () =>
      stash(
        text(params, 'path'),
        // A stash may have no message: git names it after the last commit.
        typeof (params as { message?: unknown }).message === 'string'
          ? (params as { message: string }).message
          : '',
        {
          keepIndex: flag(params, 'keepIndex'),
          includeUntracked: flag(params, 'includeUntracked'),
        },
        git,
      ),
    ).then(() => null),
  );
  connection.onRequest('git.unstash', async (params) => {
    const worktree = text(params, 'path');
    const ref = named(params, 'ref', STASH_REF);
    const options = { pop: flag(params, 'pop'), reinstateIndex: flag(params, 'reinstateIndex') };
    await recording(worktree, 'Unstash Changes', git, () => unstash(worktree, ref, options, git));
    return null;
  });
  // Local History: a worktree's records, a file's versions in them, and reverting to one.
  // After the saves' records: in the order they were asked for.
  connection.onRequest('history.record', async (params) => {
    await saves;
    await recordHistory(text(params, 'path'), 'External change', git);
    return null;
  });
  connection.onRequest('history.label', async (params) => {
    await saves;
    await recordHistory(text(params, 'path'), text(params, 'label'), git, { always: true });
    return null;
  });
  connection.onRequest('history.file', async (params) => {
    await saves;
    return fileHistory(text(params, 'path'), text(params, 'file'), git);
  });
  connection.onRequest('history.text', async (params) => ({
    text:
      (await textIn(
        text(params, 'path'),
        named(params, 'commit', COMMIT),
        text(params, 'file'),
        git,
      )) ?? null,
  }));
  connection.onRequest('history.revert', async (params) => {
    const worktree = text(params, 'path');
    const file = text(params, 'file');
    const commit = named(params, 'commit', COMMIT);
    await saves;
    await recording(worktree, 'Revert', git, () => revert(worktree, file, commit, git));
    return null;
  });
  connection.onRequest('git.dropStash', (params) =>
    dropStash(text(params, 'path'), named(params, 'ref', STASH_REF), git).then(() => null),
  );
  connection.onRequest('git.clearStashes', (params) =>
    clearStashes(text(params, 'path'), git).then(() => null),
  );
  connection.onRequest('git.lastMessage', (params) => lastMessage(text(params, 'path'), git));
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
    askServer.close();
    rmSync(scripts.folder, { recursive: true, force: true });
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
