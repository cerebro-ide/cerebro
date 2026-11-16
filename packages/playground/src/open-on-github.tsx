// Open on GitHub, as IntelliJ's GitHub plugin (`GHOpenInBrowserActionGroup`,
// `HostedGitRepositoryReferenceActionGroup`, `HostedGitRepositoryReferenceUtil`,
// `GitRemoteUrlUtil`, `GithubUrlUtil`, read from its source), for each of the repository's remotes
// on github.com: a commit's page, in its menu in the Log, last (`Git.Hosting.Open.In.Browser.Group`);
// a file's, at its last commit and the lines selected, in the editor's and the Project view's Open
// In (`RevealGroup`). Shown only with one; with several, which one is asked.

import type { MenuServices } from '@cerebro-ide/ui-menu';
import { selectedLines } from '@cerebro-ide/ui-editor';
import { openPicker } from '@cerebro-ide/ui-popup';
import { notCommitted } from './changes.js';
import { target } from './edit.js';
import { active, hostFor } from './environments.js';
import { commitAt } from './git-log.js';
import { browse } from './markdown.js';
import { notifications } from './notifications.js';
import { projectTarget } from './project.js';
import { stateOf } from './repository-state.js';

/** IntelliJ's `removeProtocolPrefix`: what follows the user's `@`, else the scheme's `://`. */
function removeProtocolPrefix(url: string): string {
  const at = url.indexOf('@');
  if (at !== -1) return url.slice(at + 1);
  const scheme = url.indexOf('://');
  return scheme === -1 ? url : url.slice(scheme + 3);
}

/**
 * The host a remote's URL names, lower-cased (`getUriFromRemoteUrl`): an scp-like one (`git@host:o/r`)
 * read as `https://host/o/r`. None for a path.
 */
export function remoteHost(remoteUrl: string): string | undefined {
  const fixed = remoteUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  const address = fixed.includes('://')
    ? fixed
    : `https://${removeProtocolPrefix(fixed).replaceAll(':/', '/').replaceAll(':', '/')}`;
  // Java's URI has no host where nothing comes between `//` and the path; the browser's URL skips
  // to the next part for one.
  if (/^[^:]*:\/\/\//.test(address)) return undefined;
  try {
    return new URL(address).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The owner and repository a remote's URL ends with, as `owner/repository`
 * (`getUserAndRepositoryFromRemoteUrl`): its last two parts, with `.git` taken off.
 */
export function repositoryPath(remoteUrl: string): string | undefined {
  const url = removeProtocolPrefix(remoteUrl.replace(/\/$/, '').replace(/\.git$/, ''));
  const last = url.lastIndexOf('/');
  if (last === -1) return undefined;
  const before = url.slice(0, last);
  const separator = Math.max(before.lastIndexOf('/'), before.lastIndexOf(':'));
  if (separator === -1) return undefined;
  const owner = url.slice(separator + 1, last);
  const repository = url.slice(last + 1);
  return owner === '' || repository === '' ? undefined : `${owner}/${repository}`;
}

/**
 * The repositories' pages on github.com the remotes' URLs name, each once, as IntelliJ's known
 * repositories: on github.com only, as Cerebro has no GitHub accounts, which add their servers in
 * IntelliJ, nor its `github.aliases` setting.
 */
export function gitHubRepositories(remoteUrls: readonly string[]): string[] {
  const pages = remoteUrls.flatMap((url) => {
    const path = remoteHost(url) === 'github.com' ? repositoryPath(url) : undefined;
    return path === undefined ? [] : [`https://github.com/${path}`];
  });
  return [...new Set(pages)];
}

/** What a page is for: a commit, or a file (or folder) with the lines selected in its editor. */
type Reference =
  | { worktree: string; hash: string }
  | { worktree: string; path: string; lines?: { first: number; last: number } };

/** The file's page (`GHPathUtil.getWebURI`): each part of its path encoded, its lines from 1. */
export function filePage(
  repository: string,
  hash: string,
  path: string,
  lines?: { first: number; last: number },
): string {
  const page = `${repository}/blob/${hash}/${path.split('/').map(encodeURIComponent).join('/')}`;
  if (!lines) return page;
  const { first, last } = lines;
  return `${page}#L${String(first + 1)}${last === first ? '' : `-L${String(last + 1)}`}`;
}

export interface OpenOnGitHubSetup {
  /** The active editor's tab: its file's path where it's one. */
  activeTab: () => string | undefined;
}

export function setupOpenOnGitHub(
  { commands, menus }: MenuServices,
  setup: OpenOnGitHubSetup,
): void {
  /**
   * What the command's for (`findReferences`): the Log's commit; else the Project view's selected
   * file or folder; else the active editor's file, with the lines selected while it has the
   * keyboard. None for what git hasn't committed, as IntelliJ's leaves out an added or unknown file.
   */
  const reference = (context: unknown): Reference | undefined => {
    const at = commitAt(context);
    if (at) return { worktree: at.worktree, hash: at.commit.hash };
    const env = active();
    if (!env) return undefined;
    const node = projectTarget(context as { tabMenu?: true } | undefined);
    const file = node === undefined ? setup.activeTab() : node?.path;
    const prefix = `${env.id}/`;
    if (!file?.startsWith(prefix)) return undefined;
    const path = file.slice(prefix.length);
    if (notCommitted(env.id, path)) return undefined;
    const editor = node === undefined ? target() : undefined;
    const lines = editor && selectedLines(editor);
    return { worktree: env.id, path, ...(lines && { lines }) };
  };
  const repositories = (at: Reference | undefined) =>
    at ? gitHubRepositories(stateOf(at.worktree).remoteUrls ?? []) : [];
  /** Its page on `repository`: a file's at the last commit that changed it (`getCurrentRevision`). */
  const page = async (at: Reference, repository: string) => {
    if ('hash' in at) return `${repository}/commit/${at.hash}`;
    const hash = await hostFor(at.worktree)
      ?.request('git.lastCommit', { path: at.worktree, file: at.path })
      .catch(() => null);
    if (typeof hash === 'string') return filePage(repository, hash, at.path, at.lines);
    // GitBundle's `open.in.browser.error` and `open.in.browser.getting.revision.error`.
    notifications.notify({
      title: 'Cannot open in browser',
      content: 'Cannot retrieve latest revision for file',
      type: 'error',
    });
    return undefined;
  };
  commands.register({
    id: 'github.openInBrowser',
    // Its text in Find Action (GithubBundle's `group.Github.Open.In.Browser.GoToAction.text`).
    label: 'Open on GitHub',
    visible: (context) => repositories(reference(context)).length > 0,
    run: async (context) => {
      const at = reference(context) as Reference;
      const all = repositories(at);
      // Nothing to open (`actionPerformed` without a reference): none without what it's for.
      if (all.length === 0) return;
      // IntelliJ's lists several in a submenu, each by its name: a commit's page, or the repository
      // for a file's (`HostedGitRepositoryReference.getName`). Claude's choice, open to change: a
      // list to choose from, as Cerebro's menus have no items made as they open.
      const name = (repository: string) =>
        'hash' in at ? `${repository}/commit/${at.hash}` : repository;
      const repository =
        all.length === 1
          ? all[0]
          : (
              await openPicker({
                label: 'View in browser',
                position: 'top',
                items: () => all.map((repository) => ({ label: name(repository), repository })),
              }).result
            )?.repository;
      const address = repository === undefined ? undefined : await page(at, repository);
      if (address !== undefined) browse(address);
    },
  });
  // In a commit's menu, its text there (GithubBundle's `open.on.github.action`), in a group of its
  // own, last.
  menus.contribute({
    menu: 'log/commit',
    item: { command: 'github.openInBrowser', label: 'View in browser' },
    group: 'zz-hosting',
  });
  // Last in Open In (`RevealGroup`), its text there (`EditorTabPopup`'s, "View in Browser"). The
  // editor's Open In comes before its Local History and Git (`SplitRevealGroup`, before
  // `VersionControlsGroup`).
  const item = { command: 'github.openInBrowser', label: 'View in Browser' };
  menus.contribute({ menu: 'project/node/openIn', item, group: 'z-hosting' });
  menus.contribute({
    menu: 'editor/content',
    item: { submenu: 'editor/content/openIn', label: 'Open In' },
    group: 'g-reveal',
  });
  menus.contribute({ menu: 'editor/content/openIn', item, group: 'z-hosting' });
}
