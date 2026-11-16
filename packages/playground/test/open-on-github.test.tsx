import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { visibleEntries, type MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects } from '../src/environments.js';
import type { LogCommit } from '../src/git-log.js';
import {
  gitHubRepositories,
  remoteHost,
  repositoryPath,
  setupOpenOnGitHub,
} from '../src/open-on-github.js';
import { readState } from '../src/repository-state.js';
import { closeAll, FakeHost, popupItems, project } from './fakes.js';

let remoteUrls: string[] = [];
const host = new FakeHost({ 'git.state': () => ({ conflicts: false, remoteUrls }) });

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };
const browse = vi.fn();

beforeAll(() => {
  useProjects([project('/r', host)]);
  setupOpenOnGitHub(services);
  window.cerebro = { shell: { browse } } as unknown as NonNullable<Window['cerebro']>;
});

afterEach(async () => {
  await closeAll();
  browse.mockClear();
});

const commit = { hash: 'abc1234567890def', parents: [] } as unknown as LogCommit;
const context = { commit, worktree: '/r', host };
const withRemotes = async (urls: string[]) => {
  remoteUrls = urls;
  await readState('/r');
};

describe('Open on GitHub, as IntelliJ’s GitHub plugin', () => {
  it('reads a remote’s host and repository as IntelliJ’s does', () => {
    expect(remoteHost('git@GitHub.com:o/r.git')).toBe('github.com');
    expect(remoteHost('https://github.com/o/r/')).toBe('github.com');
    expect(remoteHost('ssh://git@github.com:22/o/r.git')).toBe('github.com');
    expect(remoteHost('github.com:/o/r')).toBe('github.com');
    // A path names no host; nor does what can't be read as an address.
    expect(remoteHost('/srv/repos/r.git')).toBeUndefined();
    expect(remoteHost('git@[::1:o/r')).toBeUndefined();
    expect(remoteHost('foo://?')).toBeUndefined();
    expect(repositoryPath('git@github.com:o/r.git')).toBe('o/r');
    expect(repositoryPath('https://github.com/o/r/')).toBe('o/r');
    expect(repositoryPath('r')).toBeUndefined();
    expect(repositoryPath('github.com/r')).toBeUndefined();
    expect(repositoryPath('https://github.com/o/')).toBeUndefined();
    expect(repositoryPath('https://github.com//r')).toBeUndefined();
    // github.com's only, each once.
    expect(
      gitHubRepositories([
        'git@github.com:o/r.git',
        'https://github.com/o/r',
        'https://gitlab.com/o/r',
        'https://github.com/',
        'https://github.com/p/q',
      ]),
    ).toEqual(['https://github.com/o/r', 'https://github.com/p/q']);
  });

  it('shows last in a commit’s menu with a remote on GitHub, and opens the commit’s page', async () => {
    expect(commands.get('log.openOnGitHub')).toMatchObject({ label: 'Open on GitHub' });
    expect(menus.entries('log/commit')).toEqual([
      { command: 'log.openOnGitHub', label: 'View in browser' },
    ]);
    // Unknown until the state's read; none without a remote on GitHub.
    expect(visibleEntries(services, 'log/commit', context)).toEqual([]);
    await withRemotes(['https://gitlab.com/o/r.git']);
    expect(visibleEntries(services, 'log/commit', context)).toEqual([]);
    await withRemotes(['git@github.com:o/r.git', 'https://github.com/o/r']);
    expect(visibleEntries(services, 'log/commit', context)).toHaveLength(1);
    // Nor without a commit.
    expect(commands.get('log.openOnGitHub')?.visible?.({})).toBe(false);
    await commands.get('log.openOnGitHub')?.run(context);
    expect(browse).toHaveBeenCalledWith('https://github.com/o/r/commit/abc1234567890def');
  });

  it('asks which, with several', async () => {
    await withRemotes(['git@github.com:o/r.git', 'https://github.com/fork/r.git']);
    const run = commands.get('log.openOnGitHub')?.run(context);
    expect(await popupItems()).toEqual([
      'https://github.com/o/r/commit/abc1234567890def',
      'https://github.com/fork/r/commit/abc1234567890def',
    ]);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await run;
    expect(browse).toHaveBeenCalledWith('https://github.com/fork/r/commit/abc1234567890def');
    // Closed without a choice: nothing opens.
    const again = commands.get('log.openOnGitHub')?.run(context);
    await popupItems();
    await userEvent.keyboard('{Escape}');
    await again;
    expect(browse).toHaveBeenCalledTimes(1);
  });
});
