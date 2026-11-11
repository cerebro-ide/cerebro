// Git → Manage Remotes…, as IntelliJ's (`GitConfigureRemotesDialog`, its `ToolbarDecorator`, and
// their words in `GitBundle`, read from its source): the dialog "Git Remotes", the remotes in a
// table of Name and URL (origin first), with Add, Remove and Edit over it. Add and Edit ask with
// Define Remote (Push's); Remove asks first. A failure says so in a dialog, in IntelliJ's words.

import { formatSequence, type Platform } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { active, hostFor, showError, type Host } from './environments.js';
import { icon } from './icons.js';
import { askForRemote } from './push.js';

/** The host's `git.remotes`. */
interface Remote {
  name: string;
  url: string;
}

/** IntelliJ's Remove's question: Yes or No. */
async function confirmRemove(remote: Remote): Promise<boolean> {
  const yes = await openDialog<true>({
    title: 'Remove Remote',
    ok: { label: 'Yes', accept: () => true },
    cancelLabel: 'No',
    content: () => (
      <p class="cerebro-selectable">{`Remove remote ${remote.name} '${remote.url}'?`}</p>
    ),
  }).result;
  return yes === true;
}

/** The dialog, on the worktree's remotes: open until closed, each change made as it's asked. */
async function remotesDialog(host: Host, worktree: string, platform: Platform): Promise<void> {
  const remotes = signal<Remote[]>([]);
  const selected = signal<string | undefined>(undefined);
  const read = async () => {
    remotes.set((await host.request('git.remotes', { path: worktree })) as Remote[]);
  };
  await read();
  const chosen = () => remotes.get().find((r) => r.name === selected.get());
  /** Runs a change; IntelliJ's words in a dialog if git fails; the remotes read again. */
  const change = async (title: string, failure: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      showError(title, `${failure} in ${worktree}:\n${(error as Error).message}`);
    }
    await read();
  };
  const names = () => remotes.peek().map((r) => r.name);
  const add = async () => {
    // IntelliJ's: origin to start with, unless there's one.
    const name = names().includes('origin') ? '' : 'origin';
    const remote = await askForRemote(host, worktree, names(), { name, url: '' });
    if (!remote) return;
    await change('Add Remote', `Cannot add remote ${remote.name} '${remote.url}'`, () =>
      host.request('git.addRemote', { path: worktree, ...remote }),
    );
    selected.set(remote.name);
  };
  const edit = async () => {
    const from = chosen();
    if (!from) return;
    const to = await askForRemote(host, worktree, names(), from);
    // As IntelliJ's: nothing changed, nothing done, Fetch remote or not.
    if (!to || (to.name === from.name && to.url === from.url)) return;
    await change(
      'Change Remote',
      `Cannot change remote ${from.name} to ${to.name} '${to.url}'`,
      () =>
        host.request('git.changeRemote', {
          path: worktree,
          fromName: from.name,
          fromUrl: from.url,
          ...to,
        }),
    );
    selected.set(to.name);
  };
  const remove = async () => {
    const remote = chosen();
    if (!remote || !(await confirmRemove(remote))) return;
    await change('Remove Remote', `Cannot remove remote ${remote.name} '${remote.url}'`, () =>
      host.request('git.removeRemote', { path: worktree, name: remote.name }),
    );
  };
  // `ToolbarDecorator`'s keys: Add is New's for dialogs, Edit Enter, Remove Alt+Delete (⌘⌫).
  const mac = platform === 'mac';
  const keys = {
    add: mac ? 'Meta+N' : 'Alt+Insert',
    remove: mac ? 'Meta+Backspace' : 'Alt+Delete',
  };
  const button = (
    label: string,
    name: string,
    key: string,
    run: () => Promise<void>,
    on = true,
  ) => (
    <button
      type="button"
      class="cerebro-toolbar-button"
      aria-label={label}
      disabled={() => !on && chosen() === undefined}
      ref={tooltip({ text: () => label, shortcut: () => formatSequence(key, platform) })}
      on:click={() => void run()}
    >
      {icon(name)}
    </button>
  );
  const moveBy = (step: number) => {
    const list = remotes.peek();
    const at = list.findIndex((r) => r.name === selected.peek());
    const next = list[Math.min(Math.max(at + step, 0), list.length - 1)];
    if (next) selected.set(next.name);
  };
  await openDialog<never>({
    title: 'Git Remotes',
    width: 560,
    cancelLabel: 'OK',
    content: () => (
      <div class="playground-remotes">
        <div class="playground-remotes__toolbar" role="toolbar" aria-label="Remotes">
          {button('Add', 'add', keys.add, add, true)}
          {button('Remove', 'remove', keys.remove, remove, false)}
          {button('Edit', 'editSource', 'Enter', edit, false)}
        </div>
        <div class="playground-remotes__list">
          <table
            class="playground-remotes__table"
            tabIndex={0}
            ref={(table) => {
              queueMicrotask(() => {
                table.focus();
              });
            }}
            on:keydown={(event) => {
              const press = (run: () => Promise<void>) => {
                event.preventDefault();
                event.stopPropagation();
                void run();
              };
              const removing = mac
                ? event.metaKey && event.key === 'Backspace'
                : event.altKey && event.key === 'Delete';
              const adding = mac
                ? event.metaKey && event.key.toLowerCase() === 'n'
                : event.altKey && event.key === 'Insert';
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveBy(event.key === 'ArrowDown' ? 1 : -1);
              } else if (adding) press(add);
              else if (removing) press(remove);
              else if (event.key === 'Enter' && chosen()) press(edit);
            }}
          >
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {() =>
                remotes.get().map((remote) => (
                  <tr
                    class="playground-remotes__row"
                    aria-selected={() => String(selected.get() === remote.name)}
                    on:mousedown={() => {
                      selected.set(remote.name);
                    }}
                    on:dblclick={() => void edit()}
                  >
                    <td>{remote.name}</td>
                    <td class="cerebro-selectable">{remote.url}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>
    ),
  }).result;
}

/** Git → Manage Remotes…, as IntelliJ's, for the active worktree. */
export function setupRemotes(services: MenuServices): void {
  const { commands, menus } = services;
  const target = () => {
    const env = active();
    const host = env && hostFor(env.id);
    return env && host ? { worktree: env.id, host } : undefined;
  };
  commands.register({
    id: 'git.manageRemotes',
    label: 'Manage Remotes',
    dialog: true,
    enabled: () => target() !== undefined,
    run: async () => {
      const { worktree, host } = target() as { worktree: string; host: Host };
      try {
        await remotesDialog(host, worktree, services.keymap?.platform ?? 'other');
      } catch (error) {
        showError('Git Remotes', (error as Error).message);
      }
    },
  });
  // IntelliJ's: in a group of its own after Uncommitted Changes and Current File.
  menus.contribute({ menu: 'main/git', item: { command: 'git.manageRemotes' }, group: 'c' });
}
