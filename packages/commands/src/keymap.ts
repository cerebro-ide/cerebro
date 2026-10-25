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

/** Turns chords into commands, waiting for the rest of a sequence. */
export class KeyDispatcher {
  private pending: string | undefined;

  constructor(
    private readonly keymap: Keymap,
    private readonly commands: CommandRegistry,
  ) {}

  /** Whether a sequence has started and waits for its next chord. */
  get waiting(): boolean {
    return this.pending !== undefined;
  }

  /**
   * Handles one chord: runs the first enabled command bound to the sequence so far, or waits when
   * a longer binding could still match. A chord that breaks a started sequence is swallowed.
   */
  press(chord: string, context?: unknown): KeyResult {
    const started = this.pending !== undefined;
    const sequence = started ? `${this.pending as string} ${chord}` : chord;
    if (this.keymap.isPrefix(sequence)) {
      this.pending = sequence;
      return 'pending';
    }
    this.pending = undefined;
    for (const id of this.keymap.commandsFor(sequence)) {
      if (this.commands.execute(id, context)) return 'handled';
    }
    return started ? 'handled' : 'unhandled';
  }

  /** Abandons a started sequence, after a timeout or when focus moves. */
  cancel(): void {
    this.pending = undefined;
  }
}
