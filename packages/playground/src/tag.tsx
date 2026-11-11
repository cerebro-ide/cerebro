// Git → New Tag…, as IntelliJ's (`GitTag`, `GitTagDialog` and its `GitReferenceValidator`, their
// words in `GitBundle`, read from its source): the dialog "Tag" with the current branch, Tag Name,
// Force (enabled only when a tag of that name exists), Commit (HEAD when empty) with Validate, and
// Message, which makes the tag annotated. The tags there are read before it opens.

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { active, hostFor, projectOf, type Host } from './environments.js';
import { notifications } from './notifications.js';
import { refreshAll } from './shelf.js';

interface NewTag {
  name: string;
  commit?: string;
  message?: string;
  force: boolean;
}

/** The dialog, given the worktree's tags and branch; what it chose, or undefined if cancelled. */
function tagDialog(
  host: Host,
  worktree: string,
  tags: readonly string[],
  branch: string | undefined,
): Promise<NewTag | undefined> {
  const name = signal('');
  const force = signal(false);
  const commit = signal('');
  const message = signal('');
  /** The commit last validated, and whether git knew it. */
  const validated = signal<{ text: string; valid: boolean } | undefined>(undefined);
  const exists = () => tags.includes(name.get());
  // As IntelliJ's: invalid only while it's the text that was validated.
  const invalid = () => {
    const last = validated.get();
    return last !== undefined && last.text === commit.get() && !last.valid;
  };
  const error = () => {
    if (exists() && !force.get()) return 'The tag with the same name exists.';
    return invalid() ? 'The commit or object name is invalid.' : undefined;
  };
  const validate = async () => {
    const text = commit.peek();
    const valid = (await host.request('git.validRevision', {
      path: worktree,
      revision: text.trim(),
    })) as boolean;
    validated.set({ text, valid });
  };
  return openDialog<NewTag>({
    title: 'Tag',
    width: 500,
    ok: {
      label: 'Create Tag',
      enabled: () => name.get() !== '' && error() === undefined,
      accept: () => {
        const object = commit.peek().trim();
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
        <div class="playground-form__row">
          <span>Current Branch:</span>
          <span title="The currently checked-out branch.">{branch ?? '<no active branch>'}</span>
        </div>
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
        <label class="playground-form__row">
          <span>Commit:</span>
          <span class="playground-tag__commit">
            <input
              class="cerebro-dialog-field__input"
              type="text"
              spellcheck={false}
              title="Enter name of commit or object to tag or leave blank to use HEAD."
              on:input={(event) => {
                commit.set((event.currentTarget as HTMLInputElement).value);
              }}
            />
            <button
              type="button"
              class="cerebro-dialog__button"
              title="Click this button to validate the commit to be tagged"
              disabled={() => commit.get().trim() === ''}
              on:click={() => {
                validate().catch((failure: unknown) => {
                  console.error('Validating the commit to tag failed', failure);
                });
              }}
            >
              Validate
            </button>
          </span>
        </label>
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
      const branch = projectOf(worktree)
        ?.worktrees.get()
        .find((w) => w.id === worktree)?.branch;
      const tag = await tagDialog(host, worktree, tags, branch);
      if (!tag) return;
      try {
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
}
