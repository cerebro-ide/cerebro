// Sample worktrees and branches for the toolbar's selectors and the environment tabs, until the host
// can list real ones. Opening a worktree makes it an environment tab, with its own editor area.

import type { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import {
  Environments,
  type Environment,
  type EnvironmentSpec,
  type Tab,
} from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import { prompt } from '@cerebro-ide/ui-dialog';
import { fuzzyFilter, openPicker, type PickerHandle, type PickerItem } from '@cerebro-ide/ui-popup';
import { icon } from './icons.js';

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
  bare: boolean;
}

/**
 * Uses a repository's real worktrees instead of the samples, and their branches; call before
 * `setupEnvironments`. Each is known by its path, and named after its folder.
 */
export function useWorktrees(list: readonly HostWorktree[]): void {
  const specs = list
    .filter((w) => !w.bare)
    .map((w) => ({
      id: w.path,
      name: w.path.split(/[\\/]/).at(-1) ?? w.path,
      branch: w.branch ?? 'detached',
    }));
  if (specs.length === 0) return;
  worktrees.set(specs);
  branches.set([...new Set(specs.map((s) => s.branch).filter((b) => b !== 'detached'))]);
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
  const addWorktree = (spec: EnvironmentSpec) => {
    commands.register({
      id: `env.open.${spec.id}`,
      label: literal(spec.name),
      checked: () => workspace.activeId === spec.id,
      run: () => {
        open(spec.id);
      },
    });
    menus.contribute({
      menu: 'toolbar/environments',
      item: { command: `env.open.${spec.id}` },
      group: 'a',
    });
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
    run: async () => {
      const name = await prompt({
        title: 'New Worktree',
        label: 'Name:',
        ok: 'Create',
        validate: (text) =>
          worktrees.get().some((w) => w.id === text) ? `Worktree ${text} exists` : undefined,
      });
      if (name === undefined) return;
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
    enabled: () => workspace.active !== undefined,
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
  menus.contribute({ menu: 'env/tab', item: { command: 'env.close' } });
  menus.contribute({ menu: 'env/tab', item: { command: 'env.closeOthers' } });

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
          group: 'Worktrees',
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
