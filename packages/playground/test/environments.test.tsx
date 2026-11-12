import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import type { Environment } from '@cerebro-ide/layout';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  active,
  activeProject,
  currentHost,
  existingWorktree,
  firstWorktree,
  gitRepository,
  hostFor,
  worktreeHolding,
  loadProject,
  projectOf,
  projects,
  seedFiles,
  setupEnvironments,
  useProjects,
  workspace,
} from '../src/environments.js';
import {
  answer,
  closeAll,
  dialog,
  dialogText,
  FakeHost,
  popupItems,
  press,
  project,
  savedBefore,
  unsavedEdit,
  worktree,
} from './fakes.js';

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const seeded: string[] = [];
let envs: ReturnType<typeof setupEnvironments>;

/** The samples the window starts with, in a browser. */
const samples = projects.get();

beforeAll(() => {
  envs = setupEnvironments(commands, menus, (env) => seeded.push(env.id));
});

afterEach(async () => {
  await closeAll();
  vi.restoreAllMocks();
});

const open = () => workspace.open.map((e) => e.id);
const labels = (menu: string) =>
  menus.entries(menu).map((e) => ('command' in e ? commands.get(e.command)?.label : '—'));

describe('a project’s state, from its host', () => {
  it('is its worktrees, but bare ones, and their branches', async () => {
    const host = new FakeHost({
      'git.worktrees': () => [
        worktree('/r/app', 'main', true),
        { ...worktree('/r/bare'), bare: true },
        worktree('/r/feature', 'feat/x'),
        worktree('C:\\r\\other', 'main'),
        worktree('/r/detached'),
      ],
    });
    const state = await loadProject({ path: '/r/app', name: 'app' }, host);
    expect(state).toMatchObject({ path: '/r/app', name: 'app', host, main: '/r/app', git: true });
    expect(state.worktrees.get()).toEqual([
      { id: '/r/app', name: 'app', branch: 'main' },
      { id: '/r/feature', name: 'feature', branch: 'feat/x' },
      { id: 'C:\\r\\other', name: 'other', branch: 'main' },
      { id: '/r/detached', name: 'detached', branch: 'detached' },
    ]);
    expect(state.branches.get()).toEqual(['main', 'feat/x']);
  });

  it('is the folder alone without git', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    for (const host of [new FakeHost(), new FakeHost({ 'git.worktrees': () => [] })]) {
      const state = await loadProject({ path: '/plain', name: 'plain' }, host);
      expect(state).toMatchObject({ main: '/plain', git: false });
      expect(state.worktrees.get()).toEqual([{ id: '/plain', name: 'plain', branch: '' }]);
      expect(state.branches.get()).toEqual([]);
    }
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe('the window’s projects', () => {
  it('are the samples in a browser, with no host', () => {
    useProjects([]);
    expect(projects.get()).toBe(samples);
    expect(currentHost()).toBeUndefined();
    expect(gitRepository.get()).toBe(true);
    expect(firstWorktree()).toBe('cerebro-status-bar');
  });

  it('find the host of a worktree or a file, the deepest worktree holding it', () => {
    const outer = new FakeHost();
    const inner = new FakeHost();
    const a = project('/r/a', outer);
    const nested = project('/r/a/nested', inner);
    useProjects([a, nested]);
    expect(projectOf('/r/a/nested')).toBe(nested);
    expect(projectOf('/elsewhere')).toBeUndefined();
    expect(hostFor('/r/a/src/x.ts')).toBe(outer);
    expect(hostFor('/r/a/nested/x.ts')).toBe(inner);
    expect(hostFor('/r/a')).toBe(outer);
    // Not a worktree's: the active project's, the first with none active.
    expect(hostFor('/elsewhere/x.ts')).toBe(outer);
    // Its settings are its worktree's.
    expect(worktreeHolding('/r/a/nested/x.ts')).toBe('/r/a/nested');
    expect(worktreeHolding('/r/a/src/x.ts')).toBe('/r/a');
    expect(worktreeHolding('/elsewhere/x.ts')).toBeUndefined();
    expect(activeProject()).toBe(a);
    expect(existingWorktree({ id: '/r/a', name: 'a', branch: 'main' })).toBeDefined();
    expect(existingWorktree({ id: '/gone', name: 'gone', branch: 'main' })).toBeUndefined();
  });

  it('open on the main worktree, else the first; a project with none opens a sample’s', () => {
    const p = project('/r/p', undefined, [
      { id: '/r/w', branch: 'x' },
      { id: '/r/p', branch: 'main' },
    ]);
    expect(firstWorktree(p)).toBe('/r/p');
    p.main = undefined;
    expect(firstWorktree(p)).toBe('/r/w');
    p.worktrees.set([]);
    expect(firstWorktree(p)).toBe('cerebro');
    useProjects([]);
    projects.set([]);
    expect(firstWorktree()).toBe('cerebro');
    expect(activeProject()).toBeUndefined();
    expect(gitRepository.get()).toBe(true);
    projects.set(samples);
  });
});

describe('environments', () => {
  let host: FakeHost;
  let main: ReturnType<typeof project>;

  /** A project with a host, its main worktree open. */
  function start(answers: ConstructorParameters<typeof FakeHost>[0] = {}) {
    for (const id of open()) workspace.close(id);
    for (const p of projects.get()) envs.removeProject(p.path);
    host = new FakeHost(answers);
    main = project('/r/main', host, [
      { id: '/r/main', branch: 'main' },
      { id: '/r/feature', branch: 'feat/x' },
    ]);
    envs.addProject(main);
  }

  it('open as tabs, each seeded with files the first time', () => {
    start();
    expect(open()).toEqual(['/r/main']);
    expect(labels('toolbar/environments')).toEqual(['main', 'feature', '—', 'New &Worktree']);
    commands.execute('env.open./r/feature');
    expect(commands.isChecked('env.open./r/feature')).toBe(true);
    expect(active()?.id).toBe('/r/feature');
    commands.execute('env.open./r/main');
    expect(open()).toEqual(['/r/main', '/r/feature']);
    expect(seeded.slice(-2)).toEqual(['/r/main', '/r/feature']);
    expect(seeded.filter((id) => id === '/r/main')).toHaveLength(1);
  });

  it('check out a branch of the active environment', () => {
    start();
    expect(commands.isChecked('branch.checkout.main')).toBe(true);
    commands.execute('branch.checkout.feat/x');
    expect(workspace.active?.branch).toBe('feat/x');
    workspace.close('/r/main');
    expect(commands.isEnabled('branch.checkout.main')).toBe(false);
  });

  it('read their worktrees again, an open one’s branch checked out since followed', async () => {
    start({
      'git.worktrees': () => [worktree('/r/main', 'side', true), worktree('/r/feature', 'feat/x')],
    });
    await envs.readWorktrees('/r/main');
    expect(workspace.active?.branch).toBe('side');
    expect(main.branches.get()).toContain('side');
    // A project without a host: nothing to read.
    envs.addProject(project('/s', undefined));
    await envs.readWorktrees('/s');
    expect(host.params('git.worktrees')).toHaveLength(1);
  });

  it('take a project that joins the window, or one in another’s place and tab', () => {
    start();
    const other = project('/r/other', new FakeHost(), [{ id: '/r/other', branch: 'dev' }]);
    envs.addProject(other);
    expect(open()).toEqual(['/r/main', '/r/other']);
    // Again: nothing more.
    envs.addProject(other);
    expect(projects.get()).toHaveLength(2);
    // In the first's place, at its tab.
    const next = project('/r/next', new FakeHost());
    envs.addProject(next, '/r/main');
    expect(projects.get().map((p) => p.path)).toEqual(['/r/next', '/r/other']);
    expect(open()).toEqual(['/r/next', '/r/other']);
    expect(commands.get('env.open./r/main')).toBeUndefined();
  });

  it('show a project at its environment last active, else its main worktree', () => {
    start();
    commands.execute('env.open./r/feature');
    const other = project('/r/other', new FakeHost());
    envs.addProject(other);
    workspace.close('/r/main');
    envs.showProject('/r/main');
    expect(workspace.activeId).toBe('/r/feature');
    workspace.close('/r/other');
    envs.showProject('/r/other');
    expect(workspace.activeId).toBe('/r/other');
    envs.showProject('/r/unknown');
    expect(workspace.activeId).toBe('/r/other');
    envs.removeProject('/r/unknown');
    expect(projects.get()).toHaveLength(2);
  });

  it('close from a tab’s menu: it, or the others', () => {
    start();
    commands.execute('env.open./r/feature');
    const feature = workspace.active as Environment;
    expect(commands.isEnabled('env.closeOthers', feature)).toBe(true);
    commands.execute('env.closeOthers', feature);
    expect(open()).toEqual(['/r/feature']);
    expect(commands.isEnabled('env.closeOthers', feature)).toBe(false);
    commands.execute('env.close', feature);
    expect(open()).toEqual([]);
  });

  describe('New Worktree', () => {
    it('creates one beside the main worktree, on a new branch from the active one’s', async () => {
      start({
        'git.addWorktree': () => [
          worktree('/r/main', 'main', true),
          worktree('/r/feature', 'feat/x'),
          worktree('/r/fresh', 'fresh'),
        ],
      });
      commands.execute('env.new');
      const input = await answer('feature');
      expect(document.querySelector('[role="alert"]')?.textContent).toBe('Worktree feature exists');
      await answer('no spaces');
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        'Letters, digits, dots, dashes and underscores only',
      );
      await answer('fresh');
      expect(input.classList.contains('cerebro-dialog-field__input--invalid')).toBe(false);
      await press('Create');
      await expect.poll(open).toEqual(['/r/main', '/r/fresh']);
      expect(host.params('git.addWorktree')).toEqual([
        { path: '/r/fresh', branch: 'fresh', create: true, from: 'main' },
      ]);
      expect(main.branches.get()).toEqual(['main', 'feat/x', 'fresh']);
      expect(commands.get('branch.checkout.fresh')).toBeDefined();
    });

    it('saves the documents first, as IntelliJ’s `GitCreateWorkingTreeService`', async () => {
      start({ 'git.addWorktree': () => [worktree('/r/main', 'main', true)] });
      await unsavedEdit(host, '/r/main/a.ts');
      commands.execute('env.new');
      await answer('fresh');
      await press('Create');
      await expect.poll(() => host.params('git.addWorktree')).toHaveLength(1);
      expect(savedBefore(host, '/r/main/a.ts', 'git.addWorktree')).toBe(true);
    });

    it('shows why it couldn’t, and does nothing when cancelled', async () => {
      start({
        'git.addWorktree': () => {
          throw new Error('fatal: no room');
        },
      });
      commands.execute('env.new');
      await answer('fresh');
      await press('Create');
      expect(await dialogText()).toBe('fatal: no room');
      await press('Close');
      commands.execute('env.new');
      await dialog();
      await userEvent.keyboard('{Escape}');
      expect(host.params('git.addWorktree')).toHaveLength(1);
      expect(open()).toEqual(['/r/main']);
    });

    it('opens one it didn’t find in the host’s list: none', async () => {
      start({ 'git.addWorktree': () => [worktree('/r/main', 'main', true)] });
      commands.execute('env.new');
      await answer('lost');
      await press('Create');
      await expect.poll(() => host.params('git.addWorktree')).toHaveLength(1);
      // The host's list is all there is: feature went from it, so it's gone here too.
      await expect.poll(() => main.worktrees.get().map((w) => w.id)).toEqual(['/r/main']);
      expect(open()).toEqual(['/r/main']);
    });

    it('adds a sample in a browser, on the active branch', async () => {
      for (const p of projects.get()) envs.removeProject(p.path);
      const sample = project('cerebro', undefined);
      sample.main = undefined;
      envs.addProject(sample);
      commands.execute('env.new');
      await answer('trial');
      await press('Create');
      await expect.poll(open).toEqual(['cerebro', 'trial']);
      expect(workspace.active?.branch).toBe('main');
      workspace.close('trial');
      workspace.close('cerebro');
      commands.execute('env.new');
      await answer('bare');
      await press('Create');
      await expect.poll(open).toEqual(['bare']);
      expect(workspace.active?.branch).toBe('main');
    });

    it('does nothing without a project', async () => {
      const list = projects.get();
      projects.set([]);
      await commands.get('env.new')?.run(undefined);
      expect(document.querySelector('.cerebro-dialog')).toBeNull();
      await commands.get('branch.new')?.run(undefined);
      expect(document.querySelector('.cerebro-dialog')).toBeNull();
      projects.set(list);
    });

    it('isn’t offered for a folder without git', () => {
      start();
      main.git = false;
      expect(commands.isEnabled('env.new')).toBe(false);
      expect(commands.isEnabled('branch.new')).toBe(false);
    });
  });

  describe('New Branch', () => {
    it('makes one, unless it exists, and checks it out', async () => {
      start();
      commands.execute('branch.new');
      await answer('main');
      expect(document.querySelector('[role="alert"]')?.textContent).toBe('Branch main exists');
      await answer('topic');
      await press('Create');
      await expect.poll(() => workspace.active?.branch).toBe('topic');
      expect(labels('toolbar/branches')).toContain('topic');
      commands.execute('branch.new');
      await dialog();
      await userEvent.keyboard('{Escape}');
      expect(main.branches.get()).toEqual(['main', 'feat/x', 'topic']);
    });
  });

  describe('Remove Worktree', () => {
    const feature = () => workspace.open.find((e) => e.id === '/r/feature') as Environment;

    it('is only for real worktrees, never the main one', () => {
      start();
      commands.execute('env.open./r/feature');
      expect(commands.isEnabled('env.remove', feature())).toBe(true);
      expect(commands.isEnabled('env.remove', workspace.open[0])).toBe(false);
      expect(commands.isEnabled('env.remove')).toBe(false);
      main.host = undefined;
      expect(commands.isEnabled('env.remove', feature())).toBe(false);
      void commands.get('env.remove')?.run(feature());
      expect(document.querySelector('.cerebro-dialog')).toBeNull();
    });

    it('removes it once confirmed, its branch kept', async () => {
      start({ 'git.removeWorktree': () => [worktree('/r/main', 'main', true)] });
      commands.execute('env.open./r/feature');
      commands.execute('env.remove', feature());
      expect(await dialogText()).toBe(
        'Remove feature and delete its folder? Its branch, feat/x, stays.',
      );
      await press('Remove');
      await expect.poll(open).toEqual(['/r/main']);
      expect(host.params('git.removeWorktree')).toEqual([{ path: '/r/feature', force: false }]);
      expect(commands.get('env.open./r/feature')).toBeUndefined();
    });

    it('does nothing when not confirmed', async () => {
      start({ 'git.removeWorktree': () => [] });
      commands.execute('env.open./r/feature');
      commands.execute('env.remove', feature());
      await press('Cancel');
      expect(host.params('git.removeWorktree')).toEqual([]);
    });

    it('asks again for one with changes, then removes it anyway, or not', async () => {
      let forced = 0;
      start({
        'git.removeWorktree': (params: { force: boolean }) => {
          if (!params.force) throw new Error('contains modified or untracked files');
          forced++;
          return [worktree('/r/main', 'main', true)];
        },
      });
      commands.execute('env.open./r/feature');
      commands.execute('env.remove', feature());
      await press('Remove');
      expect(await dialogText()).toBe('feature has uncommitted changes, which would be lost.');
      await press('Cancel');
      expect(forced).toBe(0);
      commands.execute('env.remove', feature());
      await press('Remove');
      await press('Remove Anyway');
      await expect.poll(open).toEqual(['/r/main']);
      expect(forced).toBe(1);
    });

    it('shows why it couldn’t', async () => {
      let force = false;
      start({
        'git.removeWorktree': (params: { force: boolean }) => {
          if (params.force) throw new Error('still locked');
          throw new Error(force ? 'modified or untracked' : 'is locked');
        },
      });
      commands.execute('env.open./r/feature');
      commands.execute('env.remove', feature());
      await press('Remove');
      expect(await dialogText()).toBe('is locked');
      await press('Close');
      force = true;
      commands.execute('env.remove', feature());
      await press('Remove');
      await press('Remove Anyway');
      expect(await dialogText()).toBe('still locked');
      await press('Close');
      expect(open()).toEqual(['/r/main', '/r/feature']);
    });
  });

  describe('the toolbar’s popups', () => {
    it('list the active project’s worktrees, the main one apart, and open the one chosen', async () => {
      start();
      const button = document.body.appendChild(document.createElement('button'));
      envs.pickWorktree(button);
      expect(await popupItems()).toEqual(['New Worktree…', 'main', 'feature']);
      expect(
        [...document.querySelectorAll('.cerebro-popup__group')].map((g) => g.textContent),
      ).toEqual(['Main Worktree', 'Worktrees']);
      await userEvent.keyboard('feat');
      await expect.poll(popupItems).toEqual(['feature']);
      await userEvent.keyboard('{Enter}');
      await expect.poll(() => workspace.activeId).toBe('/r/feature');
      button.remove();
    });

    it('list the active project’s branches, and check out the one chosen', async () => {
      start();
      const button = document.body.appendChild(document.createElement('button'));
      envs.pickBranch(button);
      expect(await popupItems()).toEqual(['New Branch…', 'main', 'feat/x']);
      await userEvent.keyboard('feat{Enter}');
      await expect.poll(() => workspace.active?.branch).toBe('feat/x');
      envs.pickBranch(button);
      await popupItems();
      await userEvent.keyboard('{Enter}');
      expect(await dialog()).toBeDefined();
      await userEvent.keyboard('{Escape}');
      button.remove();
    });

    it('list nothing of a project without worktrees or branches', async () => {
      const list = projects.get();
      projects.set([]);
      const button = document.body.appendChild(document.createElement('button'));
      envs.pickWorktree(button);
      expect(await popupItems()).toEqual(['New Worktree…']);
      await userEvent.keyboard('{Escape}');
      envs.pickBranch(button);
      expect(await popupItems()).toEqual(['New Branch…']);
      await userEvent.keyboard('{Escape}');
      projects.set(list);
      button.remove();
    });
  });
});

describe('a sample environment’s files', () => {
  it('are its README and package.json, or the status bar’s sources, split', () => {
    const env = workspace.openOrActivate({ id: 'cerebro-status-bar', name: 's', branch: 'm' });
    seedFiles(env, (path) => ({ id: path, title: path }));
    expect(env.editor.groups.map((g) => g.tabs.map((t) => t.id))).toEqual([
      ['README.md', 'src/main.ts', 'src/shell.tsx'],
      ['src/styles.css'],
    ]);
    const other = workspace.openOrActivate({ id: 'cerebro', name: 'c', branch: 'm' });
    seedFiles(other, (path) => ({ id: path, title: path }));
    expect(other.editor.activeGroup.tabs.map((t) => t.id)).toEqual(['README.md', 'package.json']);
  });
});
