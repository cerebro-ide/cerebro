// Local History, as IntelliJ's: File → Local History, and the editor's and its tabs' menus, have
// Show History, for the file's versions as the host recorded them (when, and what changed it),
// each compared with the file as it is, and Revert; and Put Label…, which records the files with a
// name to find them by. The host records what Cerebro changes; changes made outside it (an agent,
// git in a terminal) are recorded when the window gets the focus, and every half minute while it
// has it.

import type { MenuServices } from '@cerebro-ide/ui-menu';
import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { DiffEditor } from '@cerebro-ide/ui-editor';
import { diffPath } from './changes.js';
import type { TabContext } from './commands.js';
import { reloadAll } from './documents.js';
import { active, currentHost, gitRepository, hostFor } from './environments.js';
import { settingsFor } from './settings.js';

/** A file's version, as the host gives it. */
interface Revision {
  commit: string;
  time: number;
  label: string;
  put: boolean;
}

/** How often changes made outside Cerebro are recorded, while the window has the focus. */
const RECORD_EVERY = 30_000;

/** The file a command acts on: its tab's, or the active editor's; in the active worktree. */
function fileOf(tab: string | undefined): { worktree: string; path: string } | undefined {
  const env = active();
  if (!env || tab === undefined || !currentHost() || !gitRepository.get()) return undefined;
  const diff = diffPath(tab);
  if (diff !== undefined) return { worktree: env.id, path: diff };
  const prefix = `${env.id}/`;
  return tab.startsWith(prefix) ? { worktree: env.id, path: tab.slice(prefix.length) } : undefined;
}

/** When a version was recorded, as IntelliJ lists it: the date and time. */
const when = (time: number) =>
  new Date(time).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });

const fail = (title: string) => (error: unknown) => {
  openDialog({
    title,
    content: () => <p class="cerebro-selectable">{(error as Error).message}</p>,
  });
};

export interface HistorySetup {
  /** The active editor tab's id. */
  activeTab: () => string | undefined;
}

/** Local History's commands and menus, and recording changes made outside Cerebro. */
export function setupHistory(services: MenuServices, setup: HistorySetup): void {
  const { commands, menus } = services;
  const target = (c: unknown) => fileOf((c as TabContext | undefined)?.tab ?? setup.activeTab());

  commands.register({
    id: 'history.show',
    label: 'Show &History',
    enabled: (c) => target(c) !== undefined,
    run: (c) => {
      const file = target(c);
      if (file) showHistory(file.worktree, file.path).catch(fail('Couldn’t Read the History'));
    },
  });
  commands.register({
    id: 'history.putLabel',
    label: 'Put &Label',
    dialog: true,
    enabled: () => active() !== undefined && currentHost() !== undefined && gitRepository.get(),
    run: () => putLabel(),
  });

  // In the File menu before Settings and Exit, as IntelliJ's; last in the editor's menus.
  for (const [menu, group] of [
    ['main/file', 'b'],
    ['editor/content', 'h-history'],
    ['editor/tab', 'h-history'],
  ] as const) {
    menus.contribute({ menu, item: { submenu: 'localHistory', label: 'Local &History' }, group });
  }
  menus.contribute({ menu: 'localHistory', item: { command: 'history.show' }, group: 'a' });
  menus.contribute({ menu: 'localHistory', item: { command: 'history.putLabel' }, group: 'a' });

  // Changes made outside Cerebro: recorded when the window gets the focus, and now and then; not
  // again while a worktree's record is under way.
  const recording = new Set<string>();
  const record = () => {
    const env = active();
    if (!env || !currentHost() || !gitRepository.get() || recording.has(env.id)) return;
    recording.add(env.id);
    hostFor(env.id)
      ?.request('history.record', { path: env.id })
      .catch((error: unknown) => {
        console.error('Recording the Local History failed', error);
      })
      .finally(() => recording.delete(env.id));
  };
  window.addEventListener('focus', record);
  setInterval(() => {
    if (document.hasFocus()) record();
  }, RECORD_EVERY);
}

/**
 * IntelliJ's Local History window for a file, as a dialog: its versions, the latest first, and the
 * selected one compared with the file as it is. Revert puts the file back as it was then.
 */
async function showHistory(worktree: string, path: string): Promise<void> {
  const host = hostFor(worktree);
  if (!host) return;
  // What's changed outside Cerebro since: recorded first, so it's listed.
  await host.request('history.record', { path: worktree });
  const revisions = (await host.request('history.file', {
    path: worktree,
    file: path,
  })) as Revision[];
  const now = await host.request('fs.read', { path: `${worktree}/${path}` }).then(
    (result) => (result as { text: string }).text,
    () => '',
  );
  const selected = signal<Revision | undefined>(revisions[0]);
  /** Each version's text, once read: undefined where the file wasn't. */
  const texts = new Map<string, Promise<string | null>>();
  const textOf = (revision: Revision) => {
    let text = texts.get(revision.commit);
    if (!text) {
      text = host
        .request('history.text', { path: worktree, file: path, commit: revision.commit })
        .then((result) => (result as { text: string | null }).text);
      texts.set(revision.commit, text);
    }
    return text;
  };
  const settings = settingsFor(worktree);
  const name = path.slice(path.lastIndexOf('/') + 1);
  const revert = await openDialog<Revision>({
    title: `Local History: ${name}`,
    width: 1100,
    ok: {
      label: 'Revert',
      enabled: () => selected.get() !== undefined,
      accept: () => selected.peek() as Revision,
    },
    cancelLabel: 'Close',
    content: () => (
      <div class="playground-history">
        <ul class="playground-history__revisions" role="listbox" aria-label="Versions">
          {revisions.length === 0 ? (
            <li class="playground-history__none">No local history yet</li>
          ) : null}
          {revisions.map((revision) => (
            <li
              role="option"
              class={() =>
                selected.get() === revision
                  ? 'playground-history__revision playground-history__revision--selected'
                  : 'playground-history__revision'
              }
              aria-selected={() => String(selected.get() === revision)}
              data-commit={revision.commit}
              on:click={() => {
                selected.set(revision);
              }}
            >
              <span class="playground-history__time">{when(revision.time)}</span>
              <span
                class={
                  revision.put
                    ? 'playground-history__label playground-history__label--put'
                    : 'playground-history__label'
                }
              >
                {revision.label}
              </span>
            </li>
          ))}
        </ul>
        <div class="playground-history__diff">
          {() => {
            const revision = selected.get();
            if (!revision) return null;
            const shown = signal<string | null | undefined>(undefined);
            void textOf(revision).then(
              (text) => {
                shown.set(text);
              },
              () => {
                shown.set(null);
              },
            );
            return () => {
              const text = shown.get();
              if (text === undefined) return <p class="playground-code__note">Loading…</p>;
              return (
                <DiffEditor
                  path={path}
                  original={text ?? ''}
                  text={now}
                  fontSize={() => settings.get('editor.fontSize') as number}
                  tabSize={() => settings.get('editor.tabSize') as number}
                />
              );
            };
          }}
        </div>
      </div>
    ),
  }).result;
  if (!revert) return;
  try {
    await host.request('history.revert', { path: worktree, file: path, commit: revert.commit });
    await reloadAll();
  } catch (error) {
    fail('Couldn’t Revert')(error);
  }
}

/** IntelliJ's Put Label dialog: the files recorded as they are, under a name. */
async function putLabel(): Promise<void> {
  const env = active();
  if (!env) return;
  const label = signal('');
  const name = await openDialog<string>({
    title: 'Put Label',
    width: 400,
    ok: { enabled: () => label.get().trim() !== '', accept: () => label.peek().trim() },
    content: () => (
      <label class="playground-shelf__field">
        Label name:
        <input
          type="text"
          class="playground-shelf__message-field"
          ref={(field) => {
            requestAnimationFrame(() => {
              field.focus();
            });
          }}
          on:input={(event) => {
            label.set((event.currentTarget as HTMLInputElement).value);
          }}
        />
      </label>
    ),
  }).result;
  if (name === undefined) return;
  await hostFor(env.id)
    ?.request('history.label', { path: env.id, label: name })
    .catch(fail('Couldn’t Put the Label'));
}
