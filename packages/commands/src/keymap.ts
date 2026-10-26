// The keymap: which key sequences run which commands. Defaults come from the commands' owners;
// the user's bindings come on top, and can also remove a default. A sequence of several chords
// waits for the next chord while a longer binding could still match.

import { makeObservable, ObservableArray, type Disposable } from '@cerebro-ide/reactive';
import type { CommandRegistry } from './commands.js';
import { normalizeSequence, type Platform } from './keys.js';

export interface Binding {
  /** A key sequence; normalized when stored. */
  key: string;
  command: string;
}

/** A user's binding: added, or removing a default one (`remove: true`). */
export interface UserBinding extends Binding {
  remove?: boolean;
}

export class Keymap {
  readonly platform: Platform;
  readonly defaults = new ObservableArray<Binding>();
  user: readonly UserBinding[] = [];

  constructor(platform: Platform) {
    this.platform = platform;
    makeObservable(this);
  }

  bindDefault(key: string, command: string): Disposable {
    const binding = { key: normalizeSequence(key, this.platform), command };
    this.defaults.push(binding);
    return {
      dispose: () => {
        const index = this.defaults.toArray().indexOf(binding);
        if (index >= 0) this.defaults.splice(index, 1);
      },
    };
  }

  /** Replaces the user's bindings, as loaded from their settings. */
  setUser(bindings: readonly UserBinding[]): void {
    this.user = bindings.map((b) => ({ ...b, key: normalizeSequence(b.key, this.platform) }));
  }

  /** The bindings in effect: the user's first, then the defaults they don't remove. */
  get bindings(): Binding[] {
    const removed = new Set(this.user.filter((b) => b.remove).map((b) => `${b.key}\n${b.command}`));
    const added = this.user.filter((b) => !b.remove).map(({ key, command }) => ({ key, command }));
    const defaults = this.defaults.toArray().filter((b) => !removed.has(`${b.key}\n${b.command}`));
    return [...added, ...defaults];
  }

  /** Commands bound to exactly this sequence, in priority order. */
  commandsFor(sequence: string): string[] {
    return this.bindings.filter((b) => b.key === sequence).map((b) => b.command);
  }

  /** Whether a longer binding starts with this sequence. */
  isPrefix(sequence: string): boolean {
    return this.bindings.some((b) => b.key.startsWith(`${sequence} `));
  }

  /** The sequences that run a command, the first being the one menus show. */
  shortcutsFor(command: string): string[] {
    return this.bindings.filter((b) => b.command === command).map((b) => b.key);
  }
}

export type KeyResult = 'handled' | 'pending' | 'unhandled';

/** How long a started sequence waits for its next chord, in milliseconds (as IntelliJ's default). */
export const SEQUENCE_TIMEOUT = 2000;

/**
 * Turns chords into commands, waiting for the rest of a sequence:
 * - a chord that starts a longer binding of an enabled command waits for the next chord;
 * - a chord bound on its own as well runs if no next chord continues the sequence: when the wait
 *   times out, or when a chord breaks the sequence;
 * - a chord that breaks a started sequence is swallowed, so it doesn't type or run something else;
 * - after the timeout, a started sequence is abandoned.
 */
export class KeyDispatcher {
  private pending: { sequence: string; context: unknown } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly keymap: Keymap,
    private readonly commands: CommandRegistry,
    private readonly timeout = SEQUENCE_TIMEOUT,
  ) {}

  /** Whether a sequence has started and waits for its next chord. */
  get waiting(): boolean {
    return this.pending !== undefined;
  }

  /** Handles one chord, with the context commands run in. */
  press(chord: string, context?: unknown): KeyResult {
    const pending = this.pending;
    this.clear();
    const sequence = pending ? `${pending.sequence} ${chord}` : chord;
    if (this.continues(sequence, context)) {
      this.wait(sequence, context);
      return 'pending';
    }
    if (this.run(sequence, context)) return 'handled';
    if (!pending) return 'unhandled';
    // The chord breaks the sequence: what came before runs if it's bound, and the chord is swallowed.
    this.run(pending.sequence, pending.context);
    return 'handled';
  }

  /** Abandons a started sequence, as when the window loses focus. */
  cancel(): void {
    this.clear();
  }

  /** Whether an enabled command is bound to a sequence longer than `sequence` that starts with it. */
  private continues(sequence: string, context: unknown): boolean {
    return this.keymap.bindings.some(
      (b) => b.key.startsWith(`${sequence} `) && this.commands.isEnabled(b.command, context),
    );
  }

  /** Runs the first enabled command bound to exactly `sequence`; returns whether one ran. */
  private run(sequence: string, context: unknown): boolean {
    return this.keymap.commandsFor(sequence).some((id) => this.commands.execute(id, context));
  }

  private wait(sequence: string, context: unknown): void {
    this.pending = { sequence, context };
    this.timer = setTimeout(() => {
      this.clear();
      this.run(sequence, context);
    }, this.timeout);
  }

  private clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
}
