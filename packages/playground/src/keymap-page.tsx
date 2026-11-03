// Settings → Keymap's editor: the user's changes to the keys, kept for each ready-made keymap on its
// own (IntelliJ makes a copy of a keymap the user changes; here each keeps its changes), in the
// browser's storage as the settings are.

import type { CommandRegistry, Keymap, MenuRegistry, UserBinding } from '@cerebro-ide/commands';
import { ObservableMap, signal } from '@cerebro-ide/reactive';
import { KeymapDraft, KeymapEditor } from '@cerebro-ide/ui-keymap';
import type { CustomPage } from '@cerebro-ide/ui-settings';
import { PRESETS } from './keymaps.js';

const STORAGE_KEY = 'cerebro.keymap.user';

type UserKeymaps = Readonly<Record<string, readonly UserBinding[]>>;

/** The user's bindings as saved, or none where they can't be read. */
export function loadUserKeymaps(): UserKeymaps {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as UserKeymaps;
  } catch {
    // Unreadable storage leaves the keymaps as they come.
  }
  return {};
}

/** The user's bindings, by keymap id. */
export const userKeymaps = signal<UserKeymaps>(loadUserKeymaps());

const presetOf = (id: string) => PRESETS.find((preset) => preset.id === id);

/** The Keymap page's editor, for the keymap chosen in the dialog's draft. */
export function keymapPage(
  keymap: Keymap,
  commands: CommandRegistry,
  menus: MenuRegistry,
): CustomPage {
  const drafts = new ObservableMap<string, KeymapDraft>();
  const draftFor = (id: string) => {
    let draft = drafts.get(id);
    if (!draft) {
      draft = new KeymapDraft(
        userKeymaps.get()[id] ?? [],
        (user) => keymap.bindingsWith(user, presetOf(id)),
        keymap.platform,
      );
      drafts.set(id, draft);
    }
    return draft;
  };
  const changed = () =>
    [...drafts].some(
      ([id, draft]) => JSON.stringify(draft.user) !== JSON.stringify(userKeymaps.get()[id] ?? []),
    );
  return {
    render: (value) => () => (
      <KeymapEditor
        draft={draftFor(String(value('keymap')))}
        commands={commands}
        menus={menus}
        platform={keymap.platform}
      />
    ),
    changed,
    apply: () => {
      const next = { ...userKeymaps.get() };
      for (const [id, draft] of drafts) next[id] = draft.user;
      userKeymaps.set(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage may be full or blocked; the keys still apply until reload.
      }
    },
  };
}
