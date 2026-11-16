import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { CodeEditor, EditorDocument } from '@cerebro-ide/ui-editor';
import { visibleEntries, type MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { notCommitted } from '../src/changes.js';
import { useProjects, workspace } from '../src/environments.js';
import type { LogCommit } from '../src/git-log.js';
import { notifications } from '../src/notifications.js';
import {
  filePage,
  gitHubRepositories,
  remoteHost,
  repositoryPath,
  setupOpenOnGitHub,
} from '../src/open-on-github.js';
import { projectTarget } from '../src/project.js';
import { readState } from '../src/repository-state.js';
import { closeAll, FakeHost, popupItems, project } from './fakes.js';

// What git hasn't committed, and the Project view's selection, as the test says.
vi.mock('../src/changes.js', { spy: true });
vi.mock('../src/project.js', { spy: true });

let remoteUrls: string[] = [];
let lastCommit: string | null = 'f00d';
const host = new FakeHost({
  'git.state': () => ({ conflicts: false, remoteUrls }),
  'git.lastCommit': ({ file }: { file: string }) => {
    if (file === 'broken') throw new Error('no');
    return lastCommit;
  },
});
let activeTab: string | undefined;

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };
const browse = vi.fn();

beforeAll(() => {
  useProjects([project('/r', host)]);
  vi.mocked(projectTarget).mockReturnValue(undefined);
  vi.mocked(notCommitted).mockReturnValue(false);
  setupOpenOnGitHub(services, { activeTab: () => activeTab });
  window.cerebro = { shell: { browse } } as unknown as NonNullable<Window['cerebro']>;
});

afterEach(async () => {
  await closeAll();
  browse.mockClear();
  activeTab = undefined;
  lastCommit = 'f00d';
  vi.mocked(projectTarget).mockReturnValue(undefined);
  vi.mocked(notCommitted).mockReturnValue(false);
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
    expect(commands.get('github.openInBrowser')).toMatchObject({ label: 'Open on GitHub' });
    expect(menus.entries('log/commit')).toEqual([
      { command: 'github.openInBrowser', label: 'View in browser' },
    ]);
    // Unknown until the state's read; none without a remote on GitHub.
    expect(visibleEntries(services, 'log/commit', context)).toEqual([]);
    await withRemotes(['https://gitlab.com/o/r.git']);
    expect(visibleEntries(services, 'log/commit', context)).toEqual([]);
    await withRemotes(['git@github.com:o/r.git', 'https://github.com/o/r']);
    expect(visibleEntries(services, 'log/commit', context)).toHaveLength(1);
    // Nor without a commit.
    expect(commands.get('github.openInBrowser')?.visible?.({})).toBe(false);
    await commands.get('github.openInBrowser')?.run(context);
    expect(browse).toHaveBeenCalledWith('https://github.com/o/r/commit/abc1234567890def');
  });

  it('asks which, with several', async () => {
    await withRemotes(['git@github.com:o/r.git', 'https://github.com/fork/r.git']);
    const run = commands.get('github.openInBrowser')?.run(context);
    expect(await popupItems()).toEqual([
      'https://github.com/o/r/commit/abc1234567890def',
      'https://github.com/fork/r/commit/abc1234567890def',
    ]);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await run;
    expect(browse).toHaveBeenCalledWith('https://github.com/fork/r/commit/abc1234567890def');
    // Closed without a choice: nothing opens.
    const again = commands.get('github.openInBrowser')?.run(context);
    await popupItems();
    await userEvent.keyboard('{Escape}');
    await again;
    expect(browse).toHaveBeenCalledTimes(1);
  });

  it('makes a file’s page as GHPathUtil does', () => {
    expect(filePage('https://github.com/o/r', 'h', 'a b/c#.ts')).toBe(
      'https://github.com/o/r/blob/h/a%20b/c%23.ts',
    );
    expect(filePage('https://github.com/o/r', 'h', 'a.ts', { first: 2, last: 2 })).toBe(
      'https://github.com/o/r/blob/h/a.ts#L3',
    );
    expect(filePage('https://github.com/o/r', 'h', 'a.ts', { first: 0, last: 4 })).toBe(
      'https://github.com/o/r/blob/h/a.ts#L1-L5',
    );
  });

  it('shows last in the editor’s and the Project view’s Open In', () => {
    const item = { command: 'github.openInBrowser', label: 'View in Browser' };
    expect(menus.entries('editor/content')).toEqual([
      { submenu: 'editor/content/openIn', label: 'Open In' },
    ]);
    expect(menus.entries('editor/content/openIn')).toEqual([item]);
    expect(menus.entries('project/node/openIn')).toEqual([item]);
  });

  it('opens the active editor’s file at its last commit, with the lines selected', async () => {
    await withRemotes(['git@github.com:o/r.git']);
    const run = commands.get('github.openInBrowser') as NonNullable<
      ReturnType<typeof commands.get>
    >;
    // No worktree: nothing, and nothing opens.
    activeTab = '/r/a.ts';
    expect(run.visible?.(undefined)).toBe(false);
    await run.run(undefined);
    expect(browse).not.toHaveBeenCalled();
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    // No editor's file: nothing; nor a tab that isn't one of the worktree's files.
    activeTab = undefined;
    expect(run.visible?.(undefined)).toBe(false);
    activeTab = 'diff:/r/a.ts';
    expect(run.visible?.(undefined)).toBe(false);
    // Nor one git hasn't committed.
    activeTab = '/r/src/a.ts';
    vi.mocked(notCommitted).mockReturnValue(true);
    expect(run.visible?.(undefined)).toBe(false);
    vi.mocked(notCommitted).mockReturnValue(false);
    // The keyboard elsewhere: the file, no lines.
    await run.run(undefined);
    expect(browse).toHaveBeenLastCalledWith('https://github.com/o/r/blob/f00d/src/a.ts');
    // In its editor: the lines selected, the last left out where the selection ends at its start.
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(
      () => <CodeEditor path="a.ts" document={new EditorDocument('a\nb\nc\nd\n')} />,
      container,
    );
    try {
      const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
        .shadowRoot as ShadowRoot;
      await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
      await userEvent.keyboard('{Home}{ArrowDown}{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
      await run.run(undefined);
      expect(browse).toHaveBeenLastCalledWith('https://github.com/o/r/blob/f00d/src/a.ts#L2-L3');
      await userEvent.keyboard('{ArrowLeft}');
      await run.run(undefined);
      expect(browse).toHaveBeenLastCalledWith('https://github.com/o/r/blob/f00d/src/a.ts#L2');
    } finally {
      handle.dispose();
      container.remove();
    }
  });

  it('opens the Project view’s file or folder; the root has no page', async () => {
    await withRemotes(['git@github.com:o/r.git']);
    const run = commands.get('github.openInBrowser') as NonNullable<
      ReturnType<typeof commands.get>
    >;
    activeTab = '/r/a.ts';
    vi.mocked(projectTarget).mockReturnValue({
      path: '/r/src',
      name: 'r',
      kind: 'directory',
    });
    await run.run(undefined);
    expect(browse).toHaveBeenLastCalledWith('https://github.com/o/r/blob/f00d/src');
    // Several: asked which repository, by its address.
    await withRemotes(['git@github.com:o/r.git', 'https://github.com/fork/r.git']);
    const asked = run.run(undefined);
    expect(await popupItems()).toEqual(['https://github.com/o/r', 'https://github.com/fork/r']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await asked;
    expect(browse).toHaveBeenLastCalledWith('https://github.com/fork/r/blob/f00d/src');
    vi.mocked(projectTarget).mockReturnValue({
      path: '/r',
      name: 'r',
      kind: 'directory',
    });
    expect(run.visible?.(undefined)).toBe(false);
    // Nothing selected there.
    vi.mocked(projectTarget).mockReturnValue(null);
    expect(run.visible?.(undefined)).toBe(false);
  });

  it('says so where the last commit can’t be read', async () => {
    await withRemotes(['git@github.com:o/r.git']);
    const notify = vi.spyOn(notifications, 'notify');
    const run = commands.get('github.openInBrowser') as NonNullable<
      ReturnType<typeof commands.get>
    >;
    for (const tab of ['/r/broken', '/r/new.ts']) {
      lastCommit = null;
      activeTab = tab;
      await run.run(undefined);
    }
    expect(browse).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith({
      title: 'Cannot open in browser',
      content: 'Cannot retrieve latest revision for file',
      type: 'error',
    });
    notify.mockRestore();
  });
});
