// IntelliJ's Keyboard Shortcut dialog: a field that takes the first stroke as it's pressed, a second
// stroke behind a checkbox, and the actions the shortcut is already assigned to. As IntelliJ's
// ShortcutTextField, a field takes every key but Tab, and Escape and Enter on their own (Enter once
// it has a stroke), which go to the dialog: cancel, and OK. Its Mouse Shortcut dialog, a pad that
// takes a click or a turn of the wheel, lists them too.

import {
  chordFromEvent,
  chordFromMouse,
  chordFromWheel,
  formatChord,
  type Platform,
} from '@cerebro-ide/commands';
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
        <Conflicts sequence={sequence} options={options} />
      </div>
    ),
  }).result;
}

/** The commands the shortcut is already assigned to, as IntelliJ's dialogs list them. */
function Conflicts(p: { sequence: () => string | undefined; options: ShortcutDialogOptions }) {
  return () => {
    const keys = p.sequence();
    const names = keys === undefined ? [] : p.options.conflicts(keys);
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
  };
}

/**
 * IntelliJ's mouse icon (`platform/icons/src/general/mouse.svg`, Apache 2.0), in the theme's icon
 * colour.
 */
const MOUSE_ICON =
  'M8.5 1v5H13c0-2.6-2-4.69-4.5-5zM3 9.89C3 12.71 5.24 15 8 15s5-2.29 5-5.11V7H3zM7.5 1C5.03 1.31 3 3.4 3 6h4.5z';

/**
 * Asks for a mouse shortcut, as IntelliJ's Mouse Shortcut dialog (MouseShortcutPanel, read from
 * its source): a pad that takes a click once it's let go, with the modifiers it was pressed with,
 * a double click, or a turn of the wheel. A third click in a row keeps what the pad had. Resolves
 * with the chord (`Ctrl+Click`), or undefined if cancelled.
 */
export function askMouseShortcut(options: ShortcutDialogOptions): Promise<string | undefined> {
  const chord = signal<string | undefined>(undefined);
  let pressed: string | undefined;
  // The pad's own: no button or wheel does what it would elsewhere (Back, a menu, a scroll), and
  // the window's mouse shortcuts don't see them.
  const own = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return openDialog<string>({
    title: 'Mouse Shortcut',
    width: 400,
    platform: options.platform,
    ok: {
      enabled: () => chord.get() !== undefined,
      accept: () => chord.get() as string,
    },
    content: () => (
      <div class="cerebro-shortcut">
        <div
          class="cerebro-mouse-pad"
          role="application"
          aria-label="Mouse shortcut"
          on:mousedown={(event) => {
            own(event);
            pressed = chordFromMouse(event);
          }}
          on:mouseup={(event) => {
            own(event);
            if (pressed !== undefined) chord.set(pressed);
          }}
          on:wheel={(event) => {
            own(event);
            const turned = chordFromWheel(event);
            if (turned !== undefined) chord.set(turned);
          }}
          on:contextmenu={own}
          on:auxclick={own}
        >
          <svg class="cerebro-mouse-pad__icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d={MOUSE_ICON} />
          </svg>
          {() => {
            const shown = chord.get();
            return shown === undefined ? (
              <div class="cerebro-mouse-pad__hint">
                Enter a shortcut here:
                <br />
                single or double-click, scroll the wheel,
                <br />
                modify with Ctrl, Alt and Shift
              </div>
            ) : (
              <div class="cerebro-mouse-pad__chord">{formatChord(shown, options.platform)}</div>
            );
          }}
        </div>
        <Conflicts sequence={() => chord.get()} options={options} />
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
