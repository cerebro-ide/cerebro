// Open on GitHub, as IntelliJ's GitHub plugin (`GHOpenInBrowserActionGroup`,
// `HostedGitRepositoryReferenceActionGroup`, `GitRemoteUrlUtil`, `GithubUrlUtil`, read from its
// source), in a commit's menu in the Log, last (`Git.Hosting.Open.In.Browser.Group`): the commit's
// page on GitHub, for each of the repository's remotes on github.com. Shown only with one; with
// several, which one is asked.

import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openPicker } from '@cerebro-ide/ui-popup';
import { commitAt } from './git-log.js';
import { browse } from './markdown.js';
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

/** A commit's pages on GitHub (`GHPathUtil.getWebURI`), for the worktree's remotes. */
function commitPages(worktree: string, hash: string): string[] {
  return gitHubRepositories(stateOf(worktree).remoteUrls ?? []).map(
    (repository) => `${repository}/commit/${hash}`,
  );
}

export function setupOpenOnGitHub({ commands, menus }: MenuServices): void {
  const pages = (context: unknown) => {
    const at = commitAt(context);
    return at ? commitPages(at.worktree, at.commit.hash) : [];
  };
  commands.register({
    id: 'log.openOnGitHub',
    // Its text in Find Action (GithubBundle's `group.Github.Open.In.Browser.GoToAction.text`).
    label: 'Open on GitHub',
    visible: (context) => pages(context).length > 0,
    run: async (context) => {
      const all = pages(context);
      // IntelliJ's lists several in a submenu, each by its address (Claude's choice, open to
      // change: a list to choose from, as Cerebro's menus have no items made as they open).
      const page =
        all.length === 1
          ? all[0]
          : (
              await openPicker({
                label: 'View in browser',
                position: 'top',
                items: () => all.map((label) => ({ label })),
              }).result
            )?.label;
      if (page !== undefined) browse(page);
    },
  });
  // In a commit's menu, its text there (GithubBundle's `open.on.github.action`), in a group of its
  // own, last.
  menus.contribute({
    menu: 'log/commit',
    item: { command: 'log.openOnGitHub', label: 'View in browser' },
    group: 'zz-hosting',
  });
}
