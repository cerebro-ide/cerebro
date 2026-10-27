// Worktrees and branches for the toolbar's selectors and the environment tabs: a repository's real
// ones from the host in the desktop app, which also creates and removes worktrees; samples in a
// browser. Opening a worktree makes it an environment tab, with its own editor area.

import type { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import {
  Environments,
  type Environment,
  type EnvironmentSpec,
  type Tab,
} from '@cerebro-ide/layout';
import { signal, type Disposable } from '@cerebro-ide/reactive';
import { openDialog, prompt } from '@cerebro-ide/ui-dialog';
import { fuzzyFilter, openPicker, type PickerHandle, type PickerItem } from '@cerebro-ide/ui-popup';
import { icon } from './icons.js';
import { closeTerminals } from './terminals.js';

const worktrees = signal<EnvironmentSpec[]>([
  { id: 'cerebro', name: 'cerebro', branch: 'main' },
  { id: 'cerebro-status-bar', name: 'cerebro-status-bar', branch: 'feat/status-bar' },
  { id: 'cerebro-agent-1', name: 'cerebro-agent-1', branch: 'feat/agent-sessions' },
]);
/** A saved environment, if its worktree still exists. */
export function existingWorktree(spec: EnvironmentSpec): EnvironmentSpec | undefined {
  return worktrees.get().some((w) => w.id === spec.id) ? spec : undefined;
}

const branches = signal(['main', 'feat/status-bar', 'feat/agent-sessions', 'fix/auto-actions']);

/** A repository's worktree, as the host lists it. */
export interface HostWorktree {
  path: string;
  branch: string | undefined;
  main: boolean;
  bare: boolean;
}

/** The host, in the desktop app. */
export interface Host {
  request(method: string, params?: unknown): Promise<unknown>;
}

let host: Host | undefined;
/** The repository's main worktree, which can't be removed. */
let mainWorktree: string | undefined;

/** A worktree as an environment: known by its path, named after its folder. */
function toSpec(w: HostWorktree): EnvironmentSpec {
  return {
    id: w.path,
    name: w.path.split(/[\\/]/).at(-1) ?? w.path,
    branch: w.branch ?? 'detached',
  };
}

/**
 * Uses a repository's real worktrees instead of the samples, and their branches, with the host
 * that listed them for creating and removing others; call before `setupEnvironments`.
 */
export function useWorktrees(list: readonly HostWorktree[], from?: Host): void {
  const real = list.filter((w) => !w.bare);
  if (real.length === 0) return;
  host = from;
  mainWorktree = real.find((w) => w.main)?.path;
  const specs = real.map(toSpec);
  worktrees.set(specs);
  branches.set([...new Set(specs.map((s) => s.branch).filter((b) => b !== 'detached'))]);
}

/**
 * Whether the project is a git repository. A folder without git is one environment, with no
 * worktrees to add, no branches and no changes.
 */
export const gitRepository = signal(true);

/** Uses a folder that isn't a git repository: one environment, the folder itself. */
export function useFolder(path: string, from: Host): void {
  host = from;
  mainWorktree = path;
  gitRepository.set(false);
  worktrees.set([{ id: path, name: path.split(/[\\/]/).at(-1) || path, branch: '' }]);
  branches.set([]);
}

/** The host, when the page runs in the desktop app on a real repository. */
export function currentHost(): Host | undefined {
  return host;
}

/** Shows why something failed, in a dialog. */
function showError(title: string, message: string): void {
  openDialog({ title, content: () => <p class="cerebro-selectable">{message}</p> });
}

/** The worktree opened when nothing else is: the sample with files, or a repository's main one. */
export function firstWorktree(): string {
  const all = worktrees.get();
  // There's always one: the samples, or a list useWorktrees found non-empty.
  const first = all.find((w) => w.id === 'cerebro-status-bar') ?? all[0];
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
  pickWorktree: (button: HTMLElement) => PickerHandle<unknown>;
  pickBranch: (button: HTMLElement) => PickerHandle<unknown>;
} {
  const open = (id: string) => {
    const spec = worktrees.get().find((w) => w.id === id) as EnvironmentSpec;
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
  /** Takes the host's worktrees after a change: new ones are added, gone ones dropped. */
  const sync = (list: readonly HostWorktree[]) => {
    const specs = list.filter((w) => !w.bare).map(toSpec);
    for (const spec of specs) if (!registered.has(spec.id)) addWorktree(spec);
    for (const [id, disposables] of registered) {
      if (specs.some((s) => s.id === id)) continue;
      workspace.close(id);
      for (const d of disposables) d.dispose();
      registered.delete(id);
    }
    worktrees.set(specs);
    for (const spec of specs) {
      if (spec.branch !== 'detached' && !branches.get().includes(spec.branch)) {
        branches.set([...branches.get(), spec.branch]);
        addBranch(spec.branch);
      }
    }
    return specs;
  };
  const addBranch = (branch: string) => {
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
  for (const spec of worktrees.get()) addWorktree(spec);
  for (const branch of branches.get()) addBranch(branch);

  commands.register({
    id: 'env.new',
    label: 'New &Worktree',
    dialog: true,
    enabled: () => gitRepository.get(),
    run: async () => {
      const name = await prompt({
        title: 'New Worktree',
        label: 'Name:',
        ok: 'Create',
        validate: (text) =>
          worktrees.get().some((w) => w.name === text)
            ? `Worktree ${text} exists`
            : /^[\w.-]+$/.test(text)
              ? undefined
              : 'Letters, digits, dots, dashes and underscores only',
      });
      if (name === undefined) return;
      if (host && mainWorktree !== undefined) {
        // Beside the main worktree, on a new branch of the same name, from the active one's branch.
        const path = `${mainWorktree.slice(0, mainWorktree.search(/[\\/][^\\/]*$/))}/${name}`;
        try {
          const list = (await host.request('git.addWorktree', {
            path,
            branch: name,
            create: true,
            from: workspace.active?.branch,
          })) as HostWorktree[];
          const created = sync(list).find((s) => s.name === name);
          if (created) open(created.id);
        } catch (error) {
          showError('Couldn’t Create the Worktree', (error as Error).message);
        }
        return;
      }
      const spec = { id: name, name, branch: workspace.active?.branch ?? 'main' };
      worktrees.set([...worktrees.get(), spec]);
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
      const name = await prompt({
        title: 'New Branch',
        label: 'Name:',
        ok: 'Create',
        validate: (text) => (branches.get().includes(text) ? `Branch ${text} exists` : undefined),
      });
      if (name === undefined) return;
      branches.set([...branches.get(), name]);
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
    enabled: (env?: Environment) =>
      host !== undefined && env !== undefined && env.id !== mainWorktree,
    run: async (env) => {
      const remove = async (force: boolean) => {
        // Its terminals run in the folder that's going.
        closeTerminals(env.id);
        return (await host?.request('git.removeWorktree', {
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
        sync(await remove(false));
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
          sync(await remove(true));
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

  const pickWorktree = (button: HTMLElement) =>
    pick(button, 'Worktrees', (query) => [
      ...fuzzyFilter([command('env.new', 'New Worktree…')], query),
      ...fuzzyFilter(
        worktrees.get().map((w): Choice => ({
          label: w.name,
          detail: w.branch,
          // The repository's own folder (git lists it first), apart from the worktrees beside it.
          group: gitRepository.get() && w.id === mainWorktree ? 'Main Worktree' : 'Worktrees',
          ...current(workspace.activeId === w.id),
          run: () => {
            open(w.id);
          },
        })),
        query,
      ),
    ]);
  const pickBranch = (button: HTMLElement) =>
    pick(button, 'Branches', (query) => [
      ...fuzzyFilter([command('branch.new', 'New Branch…')], query),
      ...fuzzyFilter(
        branches.get().map((b): Choice => ({
          label: b,
          group: 'Local',
          ...current(workspace.active?.branch === b),
          run: () => commands.execute(`branch.checkout.${b}`),
        })),
        query,
      ),
    ]);

  return { open, pickWorktree, pickBranch };
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
