// The host's methods, on a connection to the UI.

import { createHash } from 'node:crypto';
import { chmodSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { Connection, ErrorCodes, LineReader, ResponseError } from '@cerebro-ide/protocol';
import { TimedConnection } from './slow.js';
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
  isBinary,
  decodeText,
  readTextFile,
  UnreadableFile,
  writeTextFile,
} from './files.js';
import { BadQuery, searchText } from './search.js';
import { LanguageServers } from './lsp.js';
import { formatWithPrettier } from './prettier.js';
import {
  continueUpdate,
  update,
  type Resume,
  type SaveChanges,
  type UpdateMethod,
} from './update.js';
import { blame, MOVEMENTS, type BlameOptions } from './blame.js';
import { fetchAll, merge, MERGE_OPTIONS, pull, PULL_OPTIONS, unmerged } from './pull.js';
import {
  checkout,
  checkoutDetached,
  createBranch,
  deleteBranch,
  deleteRemoteBranch,
  mergeBranch,
  rebase,
  rebaseOnto,
  REBASE_OPTIONS,
  renameBranch,
  restoreBranch,
  type NewBranch,
  type RebaseParams,
} from './branches.js';
import { createTag, listTags, resolveRevision, validRevision, type NewTag } from './tags.js';
import { applyCommit, continueApplying } from './apply-changes.js';
import { protectedBranchHolding } from './protected-branches.js';
import { resetHead, undoCommit } from './reset.js';
import {
  abortOperation,
  acceptSide,
  continueOperation,
  listConflicts,
  mergeRevisions,
  repositoryState,
  resolveWith,
  skipCommit,
} from './conflicts.js';
import {
  addWorktree,
  commit,
  git as runGit,
  gitBytes as runGitBytes,
  type GitBytes,
  bytesAt,
  listChanges,
  listChangesBetween,
  listIgnored,
  lastMessage,
  listBranches,
  addRemote,
  changeRemote,
  checkRemote,
  listRemotes,
  removeRemote,
  divergence,
  fetchTarget,
  outgoing,
  push,
  tracking,
  listAuthors,
  log,
  rollback,
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
  /** Git giving bytes: a file at a commit, for its diff. */
  gitBytes?: GitBytes;
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
  const gitBytes = options.gitBytes ?? runGitBytes;
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
  // Git → Fetch: every remote, pruned.
  // Every remote; or one, the Pull dialog's.
  connection.onRequest('git.fetch', (params) => {
    const only = (params as { remote?: unknown }).remote;
    return fetchAll(text(params, 'path'), git, remote, typeof only === 'string' ? only : undefined);
  });
  // Where a pull comes from: the branch, the remotes and the upstream.
  connection.onRequest('git.tracking', (params) => tracking(text(params, 'path'), git));
  /** A dialog's options, each among those it has. */
  const chosen = (params: unknown, known: readonly string[]): string[] => {
    const options = (params as { options?: unknown }).options ?? [];
    if (
      !Array.isArray(options) ||
      !options.every((o) => typeof o === 'string' && known.includes(o))
    ) {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        `options must be among ${known.join(', ')}`,
      );
    }
    return options as string[];
  };
  // Git → Pull…: a remote's branch merged, with the dialog's options.
  connection.onRequest('git.pull', (params) => {
    const worktree = text(params, 'path');
    const from = {
      remote: text(params, 'remote'),
      branch: text(params, 'branch'),
      options: chosen(params, PULL_OPTIONS),
    };
    return recording(worktree, 'Pull', git, () => pull(worktree, from, git, remote));
  });
  // Git → Merge…: a branch merged, with the dialog's options and its commit's message, if any.
  connection.onRequest('git.merge', (params) => {
    const worktree = text(params, 'path');
    const message = (params as { message?: unknown }).message;
    if (message !== undefined && typeof message !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'message must be a string');
    }
    const what = {
      branch: text(params, 'branch'),
      options: chosen(params, MERGE_OPTIONS),
      ...(message === undefined ? {} : { message }),
    };
    return recording(worktree, `Merge ${what.branch}`, git, () => merge(worktree, what, git));
  });
  // The branches not merged yet: the Merge dialog's.
  connection.onRequest('git.unmerged', (params) => unmerged(text(params, 'path'), git));
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
    // Pull's with --rebase: from the remote branch chosen.
    const from = (params as { from?: unknown }).from as
      { remote?: unknown; branch?: unknown } | undefined;
    if (
      from !== undefined &&
      (typeof from.remote !== 'string' || typeof from.branch !== 'string')
    ) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'from must name a remote and a branch');
    }
    const method: UpdateMethod = p.method;
    const save: SaveChanges = p.save;
    const options = {
      method,
      save,
      ...(from ? { from: { remote: from.remote as string, branch: from.branch as string } } : {}),
    };
    return recording(worktree, from ? 'Pull' : 'Update Project', git, () =>
      update(worktree, options, git, remote),
    );
  });
  // Carries on with an update stopped at conflicts, once they're resolved: given back what it gave.
  connection.onRequest('git.continueUpdate', (params) => {
    const worktree = text(params, 'path');
    const resume = (params as { resume?: unknown }).resume as Partial<Resume> | undefined;
    const saved = resume?.saved as { how?: unknown; id?: unknown } | undefined;
    if (
      (resume?.method !== 'merge' && resume?.method !== 'rebase') ||
      typeof resume.before !== 'string' ||
      !COMMIT.test(resume.before) ||
      !Number.isInteger(resume.commits) ||
      (saved !== undefined &&
        saved.how !== 'stash' &&
        !(saved.how === 'shelve' && typeof saved.id === 'string' && SHELF_ID.test(saved.id)))
    ) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'resume must be what the update gave');
    }
    const given = resume as Resume;
    return recording(worktree, 'Update Project', git, () => continueUpdate(worktree, given, git));
  });
  // Merge conflicts: the files, their versions, resolving them, and carrying on after.
  // Who last changed each line of a file, given its text as the editor has it: IntelliJ's Annotate.
  connection.onRequest('git.blame', (params) => {
    const { contents } = params as { contents?: unknown };
    if (typeof contents !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'contents must be a string');
    }
    // IntelliJ's Options on an annotation; its defaults when not given.
    const { ignoreWhitespace = true, movements = 'none' } = params as {
      ignoreWhitespace?: unknown;
      movements?: unknown;
    };
    if (
      typeof ignoreWhitespace !== 'boolean' ||
      !MOVEMENTS.includes(movements as BlameOptions['movements'])
    ) {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        `ignoreWhitespace must be a boolean, movements among ${MOVEMENTS.join(', ')}`,
      );
    }
    return blame(text(params, 'path'), text(params, 'file'), contents, git, {
      ignoreWhitespace,
      movements: movements as BlameOptions['movements'],
    });
  });
  connection.onRequest('git.conflicts', (params) => listConflicts(text(params, 'path'), git));
  connection.onRequest('git.state', (params) => repositoryState(text(params, 'path'), git));
  // The Git menu's, during a merge or a rebase: Commit Merge and Continue Rebase, Skip Commit,
  // Abort Merge and Abort Rebase.
  connection.onRequest('git.continue', (params) => {
    const worktree = text(params, 'path');
    return recording(worktree, 'Continue', git, () => continueOperation(worktree, git));
  });
  connection.onRequest('git.skipCommit', (params) => {
    const worktree = text(params, 'path');
    return recording(worktree, 'Skip Commit', git, () => skipCommit(worktree, git));
  });
  connection.onRequest('git.abort', async (params) => {
    const worktree = text(params, 'path');
    const op = (params as { operation?: unknown }).operation;
    const named = {
      merge: 'Abort Merge',
      rebase: 'Abort Rebase',
      'cherry-pick': 'Abort Cherry-Pick',
      revert: 'Abort Revert',
    };
    if (op !== 'merge' && op !== 'rebase' && op !== 'cherry-pick' && op !== 'revert') {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        'operation must be merge, rebase, cherry-pick or revert',
      );
    }
    await recording(worktree, named[op], git, () => abortOperation(worktree, op, git));
    return null;
  });
  /** A commit's hash, as the Log gives it: never an option. */
  const hashOf = (params: unknown) => {
    const hash = text(params, 'hash');
    if (!/^[0-9a-f]{4,64}$/i.test(hash)) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'hash must be a commit hash');
    }
    return hash;
  };
  /** The branches whose name on a remote makes a commit there published: `protected`. */
  const protectedOf = (params: unknown) => {
    const named = (params as { protected?: unknown }).protected;
    if (!Array.isArray(named) || !named.every((n) => typeof n === 'string')) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'protected must be a list of names');
    }
    return (name: string) => named.includes(name);
  };
  // The Log's Undo Commit…: the branch on a remote it's published on, if it is, nothing done.
  connection.onRequest('git.undoCommit', async (params) => {
    const worktree = text(params, 'path');
    const hash = hashOf(params);
    const named = protectedOf(params);
    return recording(worktree, 'Git undo commit', git, () =>
      undoCommit(worktree, hash, named, git),
    );
  });
  // The Log's Cherry-Pick: `protected` names the branches on a remote that make a commit
  // published, its message then saying where it's from.
  connection.onRequest('git.cherryPick', async (params) => {
    const worktree = text(params, 'path');
    const hash = hashOf(params);
    const named = protectedOf(params);
    const published = await protectedBranchHolding(worktree, hash, named, git);
    return recording(worktree, 'Cherry-Pick', git, () =>
      applyCommit(worktree, 'cherry-pick', hash, published !== undefined, git),
    );
  });
  // The Log's Revert Commit.
  connection.onRequest('git.revert', (params) => {
    const worktree = text(params, 'path');
    const hash = hashOf(params);
    return recording(worktree, 'Revert', git, () =>
      applyCommit(worktree, 'revert', hash, false, git),
    );
  });
  // Continue Cherry-Pick, and either carried on once its conflicts are resolved.
  connection.onRequest('git.continueApplying', (params) => {
    const worktree = text(params, 'path');
    const how = (params as { operation?: unknown }).operation;
    if (how !== 'cherry-pick' && how !== 'revert') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'operation must be cherry-pick or revert');
    }
    return recording(worktree, how === 'revert' ? 'Revert' : 'Continue Cherry-Pick', git, () =>
      continueApplying(worktree, how, git),
    );
  });
  // The branches popup's, as IntelliJ's: each that changes files recorded in the Local History.
  connection.onRequest('git.checkout', async (params) => {
    const worktree = text(params, 'path');
    const branch = text(params, 'branch');
    const remote = (params as { remote?: unknown }).remote === true;
    await recording(worktree, `Checkout ${branch}`, git, () =>
      checkout(worktree, branch, remote, git),
    );
    return null;
  });
  connection.onRequest('git.checkoutRevision', async (params) => {
    const worktree = text(params, 'path');
    const reference = text(params, 'reference');
    await recording(worktree, `Checkout ${reference}`, git, () =>
      checkoutDetached(worktree, reference, git),
    );
    return null;
  });
  connection.onRequest('git.createBranch', async (params) => {
    const worktree = text(params, 'path');
    const p = params as { from?: unknown; checkout?: unknown; overwrite?: unknown };
    const branch: NewBranch = {
      name: text(params, 'name'),
      ...(typeof p.from === 'string' ? { from: p.from } : {}),
      checkout: p.checkout === true,
      overwrite: p.overwrite === true,
    };
    await recording(worktree, `New Branch ${branch.name}`, git, () =>
      createBranch(worktree, branch, git),
    );
    return null;
  });
  // Git → New Tag…'s.
  connection.onRequest('git.tags', (params) => listTags(text(params, 'path'), git));
  connection.onRequest(
    'git.resolveRevision',
    async (params) =>
      (await resolveRevision(text(params, 'path'), text(params, 'revision'), git)) ?? null,
  );
  connection.onRequest('git.validRevision', (params) =>
    validRevision(text(params, 'path'), text(params, 'revision'), git),
  );
  connection.onRequest('git.createTag', async (params) => {
    const p = params as { commit?: unknown; message?: unknown; force?: unknown };
    const tag: NewTag = {
      name: text(params, 'name'),
      ...(typeof p.commit === 'string' ? { commit: p.commit } : {}),
      ...(typeof p.message === 'string' ? { message: p.message } : {}),
      force: p.force === true,
    };
    await createTag(text(params, 'path'), tag, git);
    return null;
  });
  // Git → Reset HEAD…'s and the Log's reset, recorded in Local History as IntelliJ's ("Git reset").
  connection.onRequest('git.reset', async (params) => {
    const worktree = text(params, 'path');
    const p = params as { mode?: unknown; commit?: unknown };
    if (p.mode !== 'mixed' && p.mode !== 'soft' && p.mode !== 'hard' && p.mode !== 'keep') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'mode must be mixed, soft, hard or keep');
    }
    const mode = p.mode;
    const commit = typeof p.commit === 'string' ? p.commit : undefined;
    await recording(worktree, 'Git reset', git, () => resetHead(worktree, mode, commit, git));
    return null;
  });
  connection.onRequest('git.renameBranch', async (params) => {
    await renameBranch(text(params, 'path'), text(params, 'from'), text(params, 'to'), git);
    return null;
  });
  connection.onRequest('git.deleteBranch', (params) =>
    deleteBranch(text(params, 'path'), text(params, 'name'), git),
  );
  connection.onRequest('git.deleteRemoteBranch', async (params) => {
    const name = text(params, 'name');
    if (!/^[^/]+\/./.test(name)) {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        'name must be a remote branch: remote/branch',
      );
    }
    await deleteRemoteBranch(text(params, 'path'), name, remote);
    return null;
  });
  connection.onRequest('git.restoreBranch', async (params) => {
    await restoreBranch(text(params, 'path'), text(params, 'name'), text(params, 'hash'), git);
    return null;
  });
  connection.onRequest('git.mergeBranch', (params) => {
    const worktree = text(params, 'path');
    const branch = text(params, 'branch');
    return recording(worktree, `Merge ${branch}`, git, () => mergeBranch(worktree, branch, git));
  });
  connection.onRequest('git.rebaseOnto', (params) => {
    const worktree = text(params, 'path');
    const onto = text(params, 'onto');
    return recording(worktree, `Rebase onto ${onto}`, git, () => rebaseOnto(worktree, onto, git));
  });
  // Git → Rebase…, recorded as IntelliJ's Rebase onto.
  connection.onRequest('git.rebase', (params) => {
    const worktree = text(params, 'path');
    const p = params as { onto?: unknown; upstream?: unknown; branch?: unknown };
    const given = (value: unknown) =>
      typeof value === 'string' && value !== '' ? value : undefined;
    const onto = given(p.onto);
    const upstream = given(p.upstream);
    const branch = given(p.branch);
    const rebaseParams = {
      options: chosen(params, REBASE_OPTIONS) as RebaseParams['options'],
      ...(onto === undefined ? {} : { onto }),
      ...(upstream === undefined ? {} : { upstream }),
      ...(branch === undefined ? {} : { branch }),
    };
    const base = onto ?? upstream ?? 'its root';
    return recording(worktree, `Rebase onto ${base}`, git, () =>
      rebase(worktree, rebaseParams, git),
    );
  });
  connection.onRequest('git.mergeRevisions', (params) =>
    mergeRevisions(text(params, 'path'), text(params, 'file'), git),
  );
  connection.onRequest('git.acceptSide', async (params) => {
    const worktree = text(params, 'path');
    const side = (params as { side?: unknown }).side;
    if (side !== 'yours' && side !== 'theirs') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'side must be yours or theirs');
    }
    const named = [...files(params)];
    await recording(worktree, side === 'yours' ? 'Accept Yours' : 'Accept Theirs', git, () =>
      acceptSide(worktree, named, side, git),
    );
    return null;
  });
  connection.onRequest('git.resolve', async (params) => {
    const worktree = text(params, 'path');
    const file = text(params, 'file');
    const merged = (params as { text?: unknown }).text;
    if (typeof merged !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'text must be a string');
    }
    await recording(worktree, 'Merge', git, () => resolveWith(worktree, file, merged, git));
    return null;
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
  // Manage Remotes: the remotes, removing one, and changing one's name or URL.
  connection.onRequest('git.remotes', (params) => listRemotes(text(params, 'path'), git));
  connection.onRequest('git.removeRemote', async (params) => {
    await removeRemote(text(params, 'path'), text(params, 'name'), git);
    return null;
  });
  connection.onRequest('git.changeRemote', async (params) => {
    await changeRemote(
      text(params, 'path'),
      { name: text(params, 'fromName'), url: text(params, 'fromUrl') },
      {
        name: text(params, 'name'),
        url: text(params, 'url'),
        fetch: (params as { fetch?: unknown }).fetch === true,
      },
      remote,
    );
    return null;
  });
  connection.onRequest('git.changes', (params) => {
    const worktree = text(params, 'path');
    const between = range(params);
    return between
      ? listChangesBetween(worktree, between.from, between.to, git)
      : listChanges(worktree, git);
  });
  // A file's two sides for its diff: as last committed (where it was, if renamed), and as it is;
  // or at one commit and another. Binary, if either side is, in base64: JSON carries no bytes.
  connection.onRequest('git.diff', async (params) => {
    const worktree = text(params, 'path');
    const file = text(params, 'file');
    const between = range(params);
    let sides: (Uint8Array | undefined)[];
    if (between) {
      const change = (await listChangesBetween(worktree, between.from, between.to, git)).find(
        (c) => c.path === file,
      );
      sides = await Promise.all([
        bytesAt(worktree, between.from, change?.from ?? file, gitBytes),
        bytesAt(worktree, between.to, file, gitBytes),
      ]);
    } else {
      const change = (await listChanges(worktree, git)).find((c) => c.path === file);
      sides = await Promise.all([
        bytesAt(worktree, 'HEAD', change?.from ?? file, gitBytes),
        change?.status === 'deleted' ? undefined : refusing(readFileBytes(join(worktree, file))),
      ]);
    }
    const [original, current] = sides;
    if (sides.some((side) => side !== undefined && isBinary(side))) {
      const base64 = (side: Uint8Array | undefined) =>
        side === undefined ? null : Buffer.from(side).toString('base64');
      return { binary: true, original: base64(original), text: base64(current) };
    }
    const decode = (side: Uint8Array | undefined) => (side === undefined ? '' : decodeText(side));
    return { original: decode(original), text: decode(current) };
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
  // Each request that's slow reported (`slow.ts`).
  const connection = new TimedConnection((line) => {
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
