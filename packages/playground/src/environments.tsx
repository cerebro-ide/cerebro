// Projects' worktrees and branches, for the toolbar's selectors and the environment tabs: in the
// desktop app, each project's real ones from its own host, which also creates and removes
// worktrees; samples in a browser. A window may show several projects: their worktrees share the
// one strip of environment tabs. Opening a worktree makes it an environment tab, with its own editor
// area.

import type { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import {
  Environments,
  type Environment,
  type EnvironmentSpec,
  type Tab,
} from '@cerebro-ide/layout';
import { signal, type Disposable, type Signal } from '@cerebro-ide/reactive';
import { openDialog, prompt } from '@cerebro-ide/ui-dialog';
import { fuzzyFilter, openPicker, type PickerHandle, type PickerItem } from '@cerebro-ide/ui-popup';
import type { Project } from './bridge.js';
import { icon } from './icons.js';
import { closeTerminals, setTerminalProject } from './terminals.js';

/** A repository's worktree, as the host lists it. */
export interface HostWorktree {
  path: string;
  branch: string | undefined;
  main: boolean;
  bare: boolean;
}

/** A project's host, in the desktop app. */
export interface Host {
  request(method: string, params?: unknown): Promise<unknown>;
}

/** A project open in this window: its worktrees and branches, and the host that lists them. */
export interface ProjectState {
  path: string;
  name: string;
  /** Undefined for the samples, in a browser. */
  host: Host | undefined;
  /** The repository's main worktree, which can't be removed. */
  main: string | undefined;
  /**
   * Whether it's a git repository. A folder without git is one environment, with no worktrees to
   * add, no branches and no changes.
   */
  git: boolean;
  worktrees: Signal<EnvironmentSpec[]>;
  branches: Signal<string[]>;
}

/** The samples, in a browser. */
const SAMPLES: ProjectState = {
  path: '',
  name: 'cerebro',
  host: undefined,
  main: undefined,
  git: true,
  worktrees: signal<EnvironmentSpec[]>([
    { id: 'cerebro', name: 'cerebro', branch: 'main' },
    { id: 'cerebro-status-bar', name: 'cerebro-status-bar', branch: 'feat/status-bar' },
    { id: 'cerebro-agent-1', name: 'cerebro-agent-1', branch: 'feat/agent-sessions' },
  ]),
  branches: signal(['main', 'feat/status-bar', 'feat/agent-sessions', 'fix/auto-actions']),
};

/** The window's projects, in the order they were opened: the samples until one is added. */
export const projects = signal<ProjectState[]>([SAMPLES]);

/** A worktree as an environment: known by its path, named after its folder. */
function toSpec(w: HostWorktree): EnvironmentSpec {
  return {
    id: w.path,
    name: w.path.split(/[\\/]/).at(-1) ?? w.path,
    branch: w.branch ?? 'detached',
  };
}

/**
 * A project's state, through its host: its real worktrees and their branches, or, for a folder
 * that isn't a git repository, the folder alone.
 */
export async function loadProject(project: Project, host: Host): Promise<ProjectState> {
  const base = { path: project.path, name: project.name, host };
  try {
    const real = ((await host.request('git.worktrees')) as HostWorktree[]).filter((w) => !w.bare);
    if (real.length > 0) {
      const specs = real.map(toSpec);
      return {
        ...base,
        main: real.find((w) => w.main)?.path,
        git: true,
        worktrees: signal(specs),
        branches: signal([...new Set(specs.map((s) => s.branch).filter((b) => b !== 'detached'))]),
      };
    }
  } catch (error) {
    console.info(`${project.path} opens without git:`, error);
  }
  return {
    ...base,
    main: project.path,
    git: false,
    worktrees: signal([{ id: project.path, name: project.name, branch: '' }]),
    branches: signal<string[]>([]),
  };
}

/** Uses the window's real projects instead of the samples; call before `setupEnvironments`. */
export function useProjects(list: ProjectState[]): void {
  if (list.length > 0) projects.set(list);
}

/** The project a worktree belongs to. */
export function projectOf(worktree: string): ProjectState | undefined {
  return projects.get().find((p) => p.worktrees.get().some((w) => w.id === worktree));
}

/** The project a file is in: the one with the worktree holding it (the deepest, if nested). */
function projectHolding(path: string): ProjectState | undefined {
  let found: { project: ProjectState; length: number } | undefined;
  for (const project of projects.get()) {
    for (const w of project.worktrees.get()) {
      const holds = path === w.id || path.startsWith(`${w.id}/`);
      if (holds && w.id.length > (found?.length ?? -1)) found = { project, length: w.id.length };
    }
  }
  return found?.project;
}

/** The active environment's project, else the first. */
export function activeProject(): ProjectState | undefined {
  const env = workspace.active;
  return (env && projectOf(env.id)) ?? projects.get()[0];
}

/** Whether the active project is a git repository. */
export const gitRepository = { get: (): boolean => activeProject()?.git ?? true };

/** The active project's host, in the desktop app. */
export function currentHost(): Host | undefined {
  return activeProject()?.host;
}

/** The host of the project holding a worktree or a file; the active one's when none does. */
export function hostFor(path: string): Host | undefined {
  return (projectHolding(path) ?? activeProject())?.host;
}

// A worktree's terminals run on its project's host.
setTerminalProject((worktree) => projectOf(worktree)?.path);

/** A saved environment, if its worktree still exists. */
export function existingWorktree(spec: EnvironmentSpec): EnvironmentSpec | undefined {
  return projectOf(spec.id) ? spec : undefined;
}

/** Shows why something failed, in a dialog. */
function showError(title: string, message: string): void {
  openDialog({ title, content: () => <p class="cerebro-selectable">{message}</p> });
}

/**
 * The worktree opened when nothing else is: the sample with files, or a project's main one (the
 * first project's, by default).
 */
export function firstWorktree(project = projects.get()[0]): string {
  const all = project?.worktrees.get() ?? [];
  const first =
    all.find((w) => w.id === 'cerebro-status-bar') ??
    all.find((w) => w.id === project?.main) ??
    all[0];
  return first ? first.id : 'cerebro';
}

/** The open environments, as tabs. */
export const workspace = new Environments();

export function active(): Environment | undefined {
  return workspace.active;
}

/** Menu labels mark mnemonics with &, so a literal & is doubled. */
const literal = (text: string) => text.replaceAll('&', '&&');

export function setupEnvironments(
  commands: CommandRegistry,
  menus: MenuRegistry,
  /** Called for a worktree's first opening, to put some files in its editor. */
  seed: (env: Environment) => void,
): {
  open: (id: string) => void;
  /** Takes a project that joined the window, and shows its main worktree. */
  addProject: (project: ProjectState) => void;
  /** Shows a project: its environment last active, else its main worktree. */
  showProject: (path: string) => void;
  /** Closes a project's environments and drops its worktrees: before its host stops. */
  removeProject: (path: string) => void;
  pickWorktree: (button: HTMLElement) => PickerHandle<unknown>;
  pickBranch: (button: HTMLElement) => PickerHandle<unknown>;
} {
  const open = (id: string) => {
    const spec = projectOf(id)
      ?.worktrees.get()
      .find((w) => w.id === id) as EnvironmentSpec;
    const isNew = !workspace.open.some((e) => e.id === id);
    const env = workspace.openOrActivate(spec);
    if (isNew) seed(env);
  };
  /** Each worktree's command and menu item, to remove with the worktree. */
  const registered = new Map<string, Disposable[]>();
  const addWorktree = (spec: EnvironmentSpec) => {
    const command = commands.register({
      id: `env.open.${spec.id}`,
      label: literal(spec.name),
      checked: () => workspace.activeId === spec.id,
      run: () => {
        open(spec.id);
      },
    });
    const item = menus.contribute({
      menu: 'toolbar/environments',
      item: { command: `env.open.${spec.id}` },
      group: 'a',
    });
    registered.set(spec.id, [command, item]);
  };
  const dropWorktree = (id: string) => {
    workspace.close(id);
    for (const d of registered.get(id) ?? []) d.dispose();
    registered.delete(id);
  };
  /** Takes a project's worktrees from its host after a change: new ones added, gone ones dropped. */
  const sync = (project: ProjectState, list: readonly HostWorktree[]) => {
    const specs = list.filter((w) => !w.bare).map(toSpec);
    for (const spec of specs) if (!registered.has(spec.id)) addWorktree(spec);
    for (const w of project.worktrees.get()) {
      if (!specs.some((s) => s.id === w.id)) dropWorktree(w.id);
    }
    project.worktrees.set(specs);
    for (const spec of specs) {
      if (spec.branch !== 'detached' && !project.branches.get().includes(spec.branch)) {
        project.branches.set([...project.branches.get(), spec.branch]);
        addBranch(spec.branch);
      }
    }
    return specs;
  };
  /** Branch commands, by name: one for a name any project has. */
  const branchCommands = new Set<string>();
  const addBranch = (branch: string) => {
    if (branchCommands.has(branch)) return;
    branchCommands.add(branch);
    commands.register({
      id: `branch.checkout.${branch}`,
      label: literal(branch),
      enabled: () => workspace.active !== undefined,
      checked: () => workspace.active?.branch === branch,
      run: () => {
        const env = workspace.active as Environment;
        env.branch = branch;
      },
    });
    menus.contribute({
      menu: 'toolbar/branches',
      item: { command: `branch.checkout.${branch}` },
      group: 'a',
    });
  };
  const register = (project: ProjectState) => {
    for (const spec of project.worktrees.get()) addWorktree(spec);
    for (const branch of project.branches.get()) addBranch(branch);
  };
  for (const project of projects.get()) register(project);

  const addProject = (project: ProjectState) => {
    if (projects.get().some((p) => p.path === project.path)) return;
    projects.set([...projects.get(), project]);
    register(project);
    open(firstWorktree(project));
  };
  const showProject = (path: string) => {
    const project = projects.get().find((p) => p.path === path);
    if (!project) return;
    const ids = project.worktrees.get().map((w) => w.id);
    const env = workspace.open.find((e) => ids.includes(e.id));
    if (env) workspace.activate(env.id);
    else open(firstWorktree(project));
  };
  const removeProject = (path: string) => {
    const project = projects.get().find((p) => p.path === path);
    if (!project) return;
    for (const w of project.worktrees.get()) {
      closeTerminals(w.id);
      dropWorktree(w.id);
    }
    projects.set(projects.get().filter((p) => p !== project));
  };

  commands.register({
    id: 'env.new',
    label: 'New &Worktree',
    dialog: true,
    enabled: () => gitRepository.get(),
    run: async () => {
      const project = activeProject();
      if (!project) return;
      const name = await prompt({
        title: 'New Worktree',
        label: 'Name:',
        ok: 'Create',
        validate: (text) =>
          project.worktrees.get().some((w) => w.name === text)
            ? `Worktree ${text} exists`
            : /^[\w.-]+$/.test(text)
              ? undefined
              : 'Letters, digits, dots, dashes and underscores only',
      });
      if (name === undefined) return;
      const { host, main } = project;
      if (host && main !== undefined) {
        // Beside the main worktree, on a new branch of the same name, from the active one's branch.
        const path = `${main.slice(0, main.search(/[\\/][^\\/]*$/))}/${name}`;
        try {
          const list = (await host.request('git.addWorktree', {
            path,
            branch: name,
            create: true,
            from: workspace.active?.branch,
          })) as HostWorktree[];
          const created = sync(project, list).find((s) => s.name === name);
          if (created) open(created.id);
        } catch (error) {
          showError('Couldn’t Create the Worktree', (error as Error).message);
        }
        return;
      }
      const spec = { id: name, name, branch: workspace.active?.branch ?? 'main' };
      project.worktrees.set([...project.worktrees.get(), spec]);
      addWorktree(spec);
      open(spec.id);
    },
  });
  menus.contribute({ menu: 'toolbar/environments', item: { command: 'env.new' }, group: 'b' });

  commands.register({
    id: 'branch.new',
    label: 'New &Branch',
    dialog: true,
    enabled: () => workspace.active !== undefined && gitRepository.get(),
    run: async () => {
      const project = activeProject();
      if (!project) return;
      const name = await prompt({
        title: 'New Branch',
        label: 'Name:',
        ok: 'Create',
        validate: (text) =>
          project.branches.get().includes(text) ? `Branch ${text} exists` : undefined,
      });
      if (name === undefined) return;
      project.branches.set([...project.branches.get(), name]);
      addBranch(name);
      commands.execute(`branch.checkout.${name}`);
    },
  });
  menus.contribute({ menu: 'toolbar/branches', item: { command: 'branch.new' }, group: 'b' });

  // Environment tab context menu.
  commands.register<Environment>({
    id: 'env.close',
    label: '&Close',
    run: (env) => {
      workspace.close(env.id);
    },
  });
  commands.register<Environment>({
    id: 'env.closeOthers',
    label: 'Close &Others',
    enabled: () => workspace.open.length > 1,
    run: (env) => {
      for (const other of workspace.open) if (other.id !== env.id) workspace.close(other.id);
    },
  });
  commands.register<Environment>({
    id: 'env.remove',
    label: '&Remove Worktree',
    dialog: true,
    // Only real worktrees, and never the repository's main one.
    enabled: (env?: Environment) => {
      const project = env && projectOf(env.id);
      return project?.host !== undefined && env?.id !== project.main;
    },
    run: async (env) => {
      const project = projectOf(env.id);
      if (!project?.host) return;
      const { host } = project;
      const remove = async (force: boolean) => {
        // Its terminals run in the folder that's going.
        closeTerminals(env.id);
        return (await host.request('git.removeWorktree', {
          path: env.id,
          force,
        })) as HostWorktree[];
      };
      const confirmed = await openDialog<true>({
        title: 'Remove Worktree',
        ok: { label: 'Remove', accept: () => true },
        content: () => (
          <p>
            Remove {env.name} and delete its folder? Its branch, {env.branch}, stays.
          </p>
        ),
      }).result;
      if (!confirmed) return;
      try {
        sync(project, await remove(false));
      } catch (error) {
        const message = (error as Error).message;
        if (!/modified or untracked/.test(message)) {
          showError('Couldn’t Remove the Worktree', message);
          return;
        }
        const anyway = await openDialog<true>({
          title: 'Remove Worktree',
          ok: { label: 'Remove Anyway', accept: () => true },
          content: () => <p>{env.name} has uncommitted changes, which would be lost.</p>,
        }).result;
        if (!anyway) return;
        try {
          sync(project, await remove(true));
        } catch (forced) {
          showError('Couldn’t Remove the Worktree', (forced as Error).message);
        }
      }
    },
  });
  menus.contribute({ menu: 'env/tab', item: { command: 'env.close' } });
  menus.contribute({ menu: 'env/tab', item: { command: 'env.closeOthers' } });
  menus.contribute({ menu: 'env/tab', item: { command: 'env.remove' }, group: 'z' });

  type Choice = PickerItem & { run: () => void };
  const command = (id: string, label: string): Choice => ({
    label,
    run: () => commands.execute(id),
  });
  /** A searchable popup below a toolbar button, as IntelliJ's branch popup. */
  const pick = (button: HTMLElement, label: string, items: (query: string) => Choice[]) => {
    const handle = openPicker<Choice>({
      label,
      placeholder: 'Search',
      position: { below: button },
      owner: button,
      items,
    });
    void handle.result.then((choice) => choice?.run());
    return handle;
  };
  const current = (yes: boolean) => (yes ? { icon: () => icon('check') } : {});

  /** The active project's worktrees. */
  const pickWorktree = (button: HTMLElement) =>
    pick(button, 'Worktrees', (query) => {
      const project = activeProject();
      return [
        ...fuzzyFilter([command('env.new', 'New Worktree…')], query),
        ...fuzzyFilter(
          (project?.worktrees.get() ?? []).map((w): Choice => ({
            label: w.name,
            detail: w.branch,
            // The repository's own folder (git lists it first), apart from the worktrees beside it.
            group: project?.git && w.id === project.main ? 'Main Worktree' : 'Worktrees',
            ...current(workspace.activeId === w.id),
            run: () => {
              open(w.id);
            },
          })),
          query,
        ),
      ];
    });
  /** The active project's branches. */
  const pickBranch = (button: HTMLElement) =>
    pick(button, 'Branches', (query) => [
      ...fuzzyFilter([command('branch.new', 'New Branch…')], query),
      ...fuzzyFilter(
        (activeProject()?.branches.get() ?? []).map((b): Choice => ({
          label: b,
          group: 'Local',
          ...current(workspace.active?.branch === b),
          run: () => commands.execute(`branch.checkout.${b}`),
        })),
        query,
      ),
    ]);

  return { open, addProject, showProject, removeProject, pickWorktree, pickBranch };
}

/** Files for a sample environment's first opening. */
export function seedFiles(env: Environment, tabOf: (path: string) => Tab): void {
  const files =
    env.id === 'cerebro-status-bar'
      ? ['README.md', 'src/main.ts', 'src/shell.tsx', 'src/styles.css']
      : ['README.md', 'package.json'];
  for (const path of files) env.editor.open(tabOf(path));
  if (env.id === 'cerebro-status-bar') {
    const group = env.editor.activeGroupId;
    env.editor.moveToSplit('src/styles.css', group, group, 'right');
  }
}
