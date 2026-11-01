// The keymap editor, as IntelliJ's Keymap page: every command with its shortcuts, under the main
// menu's menus as they're nested and Other for the rest, with a search field over them. A command
// the user changed shows in the accent colour. Under the list, what can be done to the selected
// command, as IntelliJ's popup on an action offers it: Add Keyboard Shortcut, Remove each of its
// shortcuts, Reset Shortcuts. Enter or a double click adds a shortcut.

import {
  displayText,
  formatSequence,
  type CommandRegistry,
  type MenuRegistry,
  type Platform,
} from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import type { KeymapDraft } from './draft.js';
import { askConflict, askShortcut } from './shortcut-dialog.js';

export interface KeymapEditorProps {
  draft: KeymapDraft;
  commands: CommandRegistry;
  menus: MenuRegistry;
  platform: Platform;
}

export type KeymapRow =
  { group: string; depth: number } | { command: string; label: string; depth: number };

/** The rows of the commands under the main menu's menus, then Other; `query` keeps those matching. */
export function keymapRows(props: KeymapEditorProps, query = ''): KeymapRow[] {
  const { commands, menus, draft, platform } = props;
  const wanted = query.trim().toLowerCase();
  const seen = new Set<string>();
  const label = (id: string) => commandName(commands, id);
  const matches = (id: string) =>
    wanted === '' ||
    label(id).toLowerCase().includes(wanted) ||
    draft
      .shortcutsFor(id)
      .some((key) => formatSequence(key, platform).toLowerCase().includes(wanted));
  const command = (id: string, depth: number): KeymapRow[] =>
    matches(id) ? [{ command: id, label: label(id), depth }] : [];
  /** A group's heading and rows, or nothing if no command in it is shown. */
  const group = (name: string, depth: number, rows: KeymapRow[]): KeymapRow[] =>
    rows.length === 0 ? [] : [{ group: name, depth }, ...rows];
  const walk = (menu: string, depth: number): KeymapRow[] =>
    menus.entries(menu).flatMap((entry) => {
      if ('submenu' in entry) {
        return group(displayText(entry.label), depth, walk(entry.submenu, depth + 1));
      }
      if (!('command' in entry) || seen.has(entry.command) || !commands.get(entry.command)) {
        return [];
      }
      seen.add(entry.command);
      return command(entry.command, depth);
    });
  const main = group('Main Menu', 0, walk('main', 1));
  const others = [...commands.commands.keys()]
    .filter((id) => !seen.has(id))
    .sort((a, b) => label(a).localeCompare(label(b)))
    .flatMap((id) => command(id, 1));
  return [...main, ...group('Other', 0, others)];
}

/** A command's name as menus show it. */
function commandName(commands: CommandRegistry, id: string): string {
  const spec = commands.get(id);
  return spec ? displayText(spec.label, spec.dialog) : id;
}

export function KeymapEditor(props: KeymapEditorProps): Node {
  const { draft, commands, platform } = props;
  const query = signal('');
  const selected = signal<string | undefined>(undefined);
  const rows = () => keymapRows(props, query.get());

  const addShortcut = async (command: string) => {
    const sequence = await askShortcut({
      platform,
      conflicts: (keys) => draft.conflicts(keys, command).map((id) => commandName(commands, id)),
    });
    if (sequence === undefined) return;
    if (draft.conflicts(sequence, command).length > 0) {
      const choice = await askConflict(platform);
      if (choice === undefined) return;
      if (choice === 'remove') draft.removeFromOthers(sequence, command);
    }
    draft.add(command, sequence);
  };

  const Row = (p: { row: KeymapRow }) => {
    const { row } = p;
    const indent = { paddingLeft: `${String(8 + row.depth * 16)}px` };
    if ('group' in row) {
      return (
        <div class="cerebro-keymap__group" role="presentation" style={indent}>
          {row.group}
        </div>
      );
    }
    const id = row.command;
    return (
      <div
        class={() =>
          [
            'cerebro-keymap__row',
            selected.get() === id && 'cerebro-keymap__row--selected',
            draft.isModified(id) && 'cerebro-keymap__row--modified',
          ]
            .filter(Boolean)
            .join(' ')
        }
        role="option"
        aria-selected={() => String(selected.get() === id)}
        data-command={id}
        style={indent}
        on:click={() => {
          selected.set(id);
        }}
        on:dblclick={() => {
          void addShortcut(id);
        }}
      >
        <span class="cerebro-keymap__label">{row.label}</span>
        <span class="cerebro-keymap__keys">
          {() =>
            draft
              .shortcutsFor(id)
              .map((key) => formatSequence(key, platform))
              .join(', ')
          }
        </span>
      </div>
    );
  };

  return (
    <div class="cerebro-keymap">
      <input
        class="cerebro-keymap__search"
        type="text"
        placeholder="Search actions or shortcuts"
        aria-label="Search actions"
        spellcheck={false}
        on:input={(event) => {
          query.set((event.currentTarget as HTMLInputElement).value);
        }}
      />
      <div
        class="cerebro-keymap__list"
        role="listbox"
        aria-label="Actions"
        tabIndex={0}
        on:keydown={(event) => {
          const ids = rows().flatMap((r) => ('command' in r ? [r.command] : []));
          const current = selected.get();
          if (event.key === 'Enter' && current !== undefined) {
            // Not the dialog's OK.
            event.preventDefault();
            event.stopPropagation();
            void addShortcut(current);
            return;
          }
          const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
          if (step === 0) return;
          event.preventDefault();
          const index = current === undefined ? -1 : ids.indexOf(current);
          const next = ids[Math.min(Math.max(index + step, 0), ids.length - 1)];
          if (next !== undefined) {
            selected.set(next);
            (event.currentTarget as HTMLElement)
              .querySelector(`[data-command="${CSS.escape(next)}"]`)
              ?.scrollIntoView({ block: 'nearest' });
          }
        }}
      >
        {() => {
          const shown = rows();
          return shown.length === 0 ? (
            <div class="cerebro-keymap__empty">Nothing to show</div>
          ) : (
            shown.map((row) => <Row row={row} />)
          );
        }}
      </div>
      <div class="cerebro-keymap__actions">
        {() => {
          const id = selected.get();
          if (id === undefined) {
            return (
              <span class="cerebro-keymap__hint">Select an action to change its shortcuts</span>
            );
          }
          return [
            <button
              type="button"
              class="cerebro-keymap__action"
              on:click={() => {
                void addShortcut(id);
              }}
            >
              Add Keyboard Shortcut…
            </button>,
            ...draft.shortcutsFor(id).map((key) => (
              <button
                type="button"
                class="cerebro-keymap__action"
                on:click={() => {
                  draft.remove(id, key);
                }}
              >
                Remove {formatSequence(key, platform)}
              </button>
            )),
            <button
              type="button"
              class="cerebro-keymap__action"
              disabled={!draft.isModified(id)}
              on:click={() => {
                draft.reset(id);
              }}
            >
              Reset Shortcuts
            </button>,
          ];
        }}
      </div>
    </div>
  );
}
