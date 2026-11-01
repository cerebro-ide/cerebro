// The user's bindings being edited on the Keymap page, before Apply: what they'd give, and the
// edits IntelliJ's page makes (add a shortcut, remove one, reset a command to the keymap's keys).

import type { Binding, Platform, UserBinding } from '@cerebro-ide/commands';
import { normalizeSequence } from '@cerebro-ide/commands';
import { makeObservable } from '@cerebro-ide/reactive';

/** Whether two sequences can't both be bound: the same, or one starts the other. */
function clashes(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

export class KeymapDraft {
  /** The user's bindings as edited: added ones, and removals of the keymap's. */
  user: readonly UserBinding[];

  /**
   * `resolve` gives the bindings in effect with some user bindings (`Keymap.bindingsWith` and the
   * keymap chosen).
   */
  constructor(
    user: readonly UserBinding[],
    private readonly resolve: (user: readonly UserBinding[]) => Binding[],
    private readonly platform: Platform,
  ) {
    this.user = user.map((b) => ({ ...b, key: normalizeSequence(b.key, platform) }));
    makeObservable(this);
  }

  get bindings(): Binding[] {
    return this.resolve(this.user);
  }

  /** The sequences that run a command, in the order menus take them. */
  shortcutsFor(command: string): string[] {
    return this.bindings.filter((b) => b.command === command).map((b) => b.key);
  }

  /** The commands bound to a sequence, or to one it starts or that starts it, but `except`. */
  conflicts(sequence: string, except: string): string[] {
    const key = normalizeSequence(sequence, this.platform);
    const clashing = this.bindings.filter((b) => b.command !== except && clashes(b.key, key));
    return [...new Set(clashing.map((b) => b.command))];
  }

  /** Whether the user changed a command's keys, as IntelliJ shows such an action in blue. */
  isModified(command: string): boolean {
    return this.user.some((b) => b.command === command);
  }

  add(command: string, sequence: string): void {
    const key = normalizeSequence(sequence, this.platform);
    const rest = this.without(command, key);
    // Dropping a removal can give it back from the keymap.
    const bound = this.resolve(rest).some((b) => b.command === command && b.key === key);
    this.user = bound ? rest : [...rest, { key, command }];
  }

  remove(command: string, sequence: string): void {
    const key = normalizeSequence(sequence, this.platform);
    const rest = this.without(command, key);
    const bound = this.resolve(rest).some((b) => b.command === command && b.key === key);
    this.user = bound ? [...rest, { key, command, remove: true }] : rest;
  }

  /** Takes a sequence from every command but `except`, as IntelliJ's conflict warning's Remove. */
  removeFromOthers(sequence: string, except: string): void {
    const key = normalizeSequence(sequence, this.platform);
    for (const command of this.conflicts(key, except)) {
      for (const other of this.shortcutsFor(command)) {
        if (clashes(other, key)) this.remove(command, other);
      }
    }
  }

  /** Gives a command back the keymap's keys. */
  reset(command: string): void {
    this.user = this.user.filter((b) => b.command !== command);
  }

  /** The user's entries for anything but this command and key. */
  private without(command: string, key: string): UserBinding[] {
    return this.user.filter((b) => !(b.command === command && b.key === key));
  }
}
