// Git → New Tag…, as IntelliJ's (`GitTag`, `GitTagDialog` and its `GitReferenceValidator`, their
// words in `GitBundle`, read from its source): the dialog "Tag" with the current branch, Tag Name,
// Force (enabled only when a tag of that name exists), Commit (HEAD when empty) with Validate, and
// Message, which makes the tag annotated. The tags there are read before it opens. And the Log's
// commit menu's New Tag… (`GitCreateTagAction`): a name asked for, the commit tagged with it.

import { signal } from '@cerebro-ide/reactive';
import { openDialog, prompt } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { saveBeforeGit } from './documents.js';
import { active, hostFor, type Host } from './environments.js';
import type { LogCommitContext } from './git-log.js';
import { currentBranchRow, revisionField } from './git-fields.js';
import { notifications } from './notifications.js';
import { refreshAll } from './shelf.js';

interface NewTag {
  name: string;
  commit?: string;
  message?: string;
  force: boolean;
}

/** The dialog, given the worktree's tags; what it chose, or undefined if cancelled. */
function tagDialog(
  host: Host,
  worktree: string,
  tags: readonly string[],
): Promise<NewTag | undefined> {
  const name = signal('');
  const force = signal(false);
  const message = signal('');
  const commit = revisionField(host, worktree, 'Commit:', {
    field: 'Enter name of commit or object to tag or leave blank to use HEAD.',
    validate: 'Click this button to validate the commit to be tagged',
  });
  const exists = () => tags.includes(name.get());
  const error = () => {
    if (exists() && !force.get()) return 'The tag with the same name exists.';
    return commit.invalid() ? 'The commit or object name is invalid.' : undefined;
  };
  return openDialog<NewTag>({
    title: 'Tag',
    width: 500,
    ok: {
      label: 'Create Tag',
      enabled: () => name.get() !== '' && error() === undefined,
      accept: () => {
        const object = commit.value();
        const text = message.peek();
        return {
          name: name.peek(),
          ...(object === '' ? {} : { commit: object }),
          ...(text.trim() === '' ? {} : { message: text }),
          force: force.peek() && exists(),
        };
      },
    },
    content: () => (
      <div class="playground-form">
        {currentBranchRow(worktree)}
        <label class="playground-form__row">
          <span>Tag Name:</span>
          <input
            class="cerebro-dialog-field__input"
            type="text"
            spellcheck={false}
            title="Enter the new tag name here."
            ref={(input) => {
              queueMicrotask(() => {
                input.focus();
              });
            }}
            on:input={(event) => {
              name.set((event.currentTarget as HTMLInputElement).value);
              // As IntelliJ's: off whenever there's no tag to force over.
              if (!exists()) force.set(false);
            }}
          />
        </label>
        <label
          class="playground-form__check playground-tag__force"
          title="Force creation of the tag even if another tag with such name already exists."
        >
          <input
            type="checkbox"
            checked={() => force.get()}
            disabled={() => !exists()}
            on:change={(event) => {
              force.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Force
        </label>
        {commit.row()}
        <label class="playground-form__row playground-tag__message">
          <span>Message:</span>
          <textarea
            class="cerebro-dialog-field__input playground-git-command__message-field"
            title="If the message is not empty, an annotated tag is created."
            on:input={(event) => {
              message.set((event.currentTarget as HTMLTextAreaElement).value);
            }}
          />
        </label>
        <span class="cerebro-dialog-field__error playground-form__error" role="alert">
          {() => error() ?? ''}
        </span>
      </div>
    ),
  }).result;
}

/** Git → New Tag…: the dialog, then the tag made in the active worktree. */
export function setupTag(services: MenuServices): void {
  const { commands, menus } = services;
  const target = () => {
    const env = active();
    const host = env && hostFor(env.id);
    return env && host ? { worktree: env.id, host } : undefined;
  };
  const failed = (title: string, error: unknown) => {
    notifications.notify({
      title,
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  };
  commands.register({
    id: 'git.newTag',
    label: 'New Tag',
    dialog: true,
    enabled: () => target() !== undefined,
    run: async () => {
      const { worktree, host } = target() as { worktree: string; host: Host };
      let tags: string[];
      try {
        tags = (await host.request('git.tags', { path: worktree })) as string[];
      } catch (error) {
        failed('Getting Existing Tags…', error);
        return;
      }
      const tag = await tagDialog(host, worktree, tags);
      if (!tag) return;
      try {
        // Git → New Tag… is a `GitRepositoryAction`, which saves first; the Log's doesn't.
        await saveBeforeGit();
        await host.request('git.createTag', { path: worktree, ...tag });
        notifications.notify({ title: tag.name, content: `Created tag ${tag.name} successfully.` });
      } catch (error) {
        failed('Could not create tag', error);
      }
      await refreshAll(worktree).catch((error: unknown) => {
        console.error('Reading again after New Tag', error);
      });
    },
  });
  // IntelliJ's: after New Branch….
  menus.contribute({ menu: 'main/git', item: { command: 'git.newTag' }, group: 'an', order: 3 });

  // The Log's, on a commit: IntelliJ's input dialog, OK only while the name has no spaces, then
  // `git tag <name> <commit>`; nothing said when it's made, as IntelliJ's says nothing.
  commands.register<LogCommitContext>({
    id: 'log.newTag',
    label: 'New Tag',
    dialog: true,
    run: async ({ commit, worktree, host, refresh }) => {
      const name = await prompt({
        title: `Create New Tag On ${commit.hash}`,
        label: 'Enter the name of new tag',
        valid: (text) => !/\s/.test(text),
      });
      if (name === undefined) return;
      try {
        await host.request('git.createTag', { path: worktree, name, commit: commit.hash });
      } catch (error) {
        failed(`Could not create tag ${name}`, error);
      }
      await refresh();
    },
  });
  // Last in IntelliJ's Git group of the menu (Git.Log.ContextMenu), after the copy's group; its
  // items between (Reset first) take the orders before.
  menus.contribute({ menu: 'log/commit', item: { command: 'log.newTag' }, group: 'g', order: 10 });
}
