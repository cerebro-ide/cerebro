// IntelliJ's Keyboard Shortcut dialog: a field that takes the first stroke as it's pressed, a second
// stroke behind a checkbox, and the actions the shortcut is already assigned to. As IntelliJ's
// ShortcutTextField, a field takes every key but Tab, and Escape and Enter on their own (Enter once
// it has a stroke), which go to the dialog: cancel, and OK.

import { chordFromEvent, formatChord, type Platform } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';

export interface ShortcutDialogOptions {
  /** The commands a sequence would clash with, by name. Read reactively. */
  conflicts: (sequence: string) => string[];
  platform: Platform;
}

/** Asks for a shortcut: resolves with its sequence (`Ctrl+K Ctrl+T`), or undefined if cancelled. */
export function askShortcut(options: ShortcutDialogOptions): Promise<string | undefined> {
  const first = signal<string | undefined>(undefined);
  const second = signal<string | undefined>(undefined);
  const withSecond = signal(false);
  const sequence = () => {
    const one = first.get();
    const two = withSecond.get() ? second.get() : undefined;
    return one === undefined ? undefined : two === undefined ? one : `${one} ${two}`;
  };

  const Stroke = (p: { stroke: typeof first; label: string; disabled?: () => boolean }) => (
    <input
      class="cerebro-dialog-field__input cerebro-shortcut__stroke"
      type="text"
      readOnly
      aria-label={p.label}
      disabled={p.disabled ?? false}
      prop:value={() => {
        const chord = p.stroke.get();
        return chord === undefined ? '' : formatChord(chord, options.platform);
      }}
      on:keydown={(event) => {
        const bare = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
        if (event.key === 'Tab') return;
        if (bare && (event.key === 'Escape' || (event.key === 'Enter' && p.stroke.get()))) return;
        event.preventDefault();
        event.stopPropagation();
        const chord = chordFromEvent(event);
        if (chord !== undefined) p.stroke.set(chord);
      }}
    />
  );

  return openDialog<string>({
    title: 'Keyboard Shortcut',
    width: 400,
    platform: options.platform,
    ok: {
      enabled: () => sequence() !== undefined,
      accept: () => sequence() as string,
    },
    content: () => (
      <div class="cerebro-shortcut">
        <Stroke stroke={first} label="First stroke" />
        <div class="cerebro-shortcut__second">
          <label class="cerebro-shortcut__enable">
            <input
              type="checkbox"
              prop:checked={() => withSecond.get()}
              on:change={(event) => {
                const box = event.currentTarget as HTMLInputElement;
                withSecond.set(box.checked);
                // On to the stroke it enables, as IntelliJ.
                if (box.checked) {
                  const row = box.closest('.cerebro-shortcut__second') as HTMLElement;
                  (row.querySelector('.cerebro-shortcut__stroke') as HTMLInputElement).focus();
                }
              }}
            />
            Second stroke:
          </label>
          <Stroke stroke={second} label="Second stroke" disabled={() => !withSecond.get()} />
        </div>
        {() => {
          const keys = sequence();
          const names = keys === undefined ? [] : options.conflicts(keys);
          return names.length === 0 ? null : (
            <div class="cerebro-shortcut__conflicts" role="alert">
              <div>Already assigned to:</div>
              <ul class="cerebro-shortcut__list">
                {names.map((name) => (
                  <li>{name}</li>
                ))}
              </ul>
            </div>
          );
        }}
      </div>
    ),
  }).result;
}

export type ConflictChoice = 'remove' | 'keep';

/**
 * IntelliJ's warning when the shortcut is assigned elsewhere: Remove the other assignments, Keep
 * them, or Cancel (undefined).
 */
export function askConflict(platform: Platform): Promise<ConflictChoice | undefined> {
  return openDialog<ConflictChoice>({
    title: 'Warning',
    width: 420,
    platform,
    ok: { label: 'Remove', accept: () => 'remove' },
    choices: [{ label: 'Keep', accept: () => 'keep' }],
    content: () => (
      <p class="cerebro-shortcut__warning">
        This shortcut is already assigned to other actions. Do you want to remove the other
        assignments?
      </p>
    ),
  }).result;
}
