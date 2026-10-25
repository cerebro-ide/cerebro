// Sample environments (worktrees, each on a branch) for the toolbar's selectors, until the host can
// list real ones.

import type { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';

export interface Environment {
  id: string;
  name: string;
  branch: string;
}

const environments = signal<Environment[]>([
  { id: 'cerebro', name: 'cerebro', branch: 'main' },
  { id: 'cerebro-status-bar', name: 'cerebro-status-bar', branch: 'feat/status-bar' },
  { id: 'cerebro-agent-1', name: 'cerebro-agent-1', branch: 'feat/agent-sessions' },
]);
const branches = signal(['main', 'feat/status-bar', 'feat/agent-sessions', 'fix/auto-actions']);
const currentId = signal('cerebro-status-bar');

export function current(): Environment {
  return environments.get().find((e) => e.id === currentId.get()) as Environment;
}

/** Menu labels mark mnemonics with &, so a literal & is doubled. */
const literal = (text: string) => text.replaceAll('&', '&&');

export function setupEnvironments(commands: CommandRegistry, menus: MenuRegistry): void {
  const addEnvironment = (env: Environment) => {
    commands.register({
      id: `env.switch.${env.id}`,
      label: literal(env.name),
      checked: () => currentId.get() === env.id,
      run: () => {
        currentId.set(env.id);
      },
    });
    menus.contribute({
      menu: 'toolbar/environments',
      item: { command: `env.switch.${env.id}` },
      group: 'a',
    });
  };
  const addBranch = (branch: string) => {
    commands.register({
      id: `branch.checkout.${branch}`,
      label: literal(branch),
      checked: () => current().branch === branch,
      run: () => {
        environments.set(
          environments.get().map((e) => (e.id === currentId.get() ? { ...e, branch } : e)),
        );
      },
    });
    menus.contribute({
      menu: 'toolbar/branches',
      item: { command: `branch.checkout.${branch}` },
      group: 'a',
    });
  };
  for (const env of environments.get()) addEnvironment(env);
  for (const branch of branches.get()) addBranch(branch);

  commands.register({
    id: 'env.new',
    label: 'New &Worktree',
    dialog: true,
    run: () => {
      const name = window.prompt('New worktree name');
      if (!name || environments.get().some((e) => e.id === name)) return;
      const env = { id: name, name, branch: current().branch };
      environments.set([...environments.get(), env]);
      addEnvironment(env);
      currentId.set(env.id);
    },
  });
  menus.contribute({ menu: 'toolbar/environments', item: { command: 'env.new' }, group: 'b' });

  commands.register({
    id: 'branch.new',
    label: 'New &Branch',
    dialog: true,
    run: () => {
      const name = window.prompt('New branch name');
      if (!name || branches.get().includes(name)) return;
      branches.set([...branches.get(), name]);
      addBranch(name);
      commands.execute(`branch.checkout.${name}`);
    },
  });
  menus.contribute({ menu: 'toolbar/branches', item: { command: 'branch.new' }, group: 'b' });
}
