// Commands: everything menus, context menus, toolbars and shortcuts can trigger. Plugins register
// them; the views only refer to them by id.

import { makeObservable, ObservableMap, type Disposable } from '@cerebro-ide/reactive';

export interface CommandSpec<C = unknown> {
  /** Unique, dotted by area: `file.open`, `view.toggleMenuBar`. */
  id: string;
  /** With `&` before the mnemonic letter. */
  label: string;
  /** Opens a dialog, so menus show the label with an ellipsis. */
  dialog?: boolean;
  /** For context menus, the thing the menu was opened on. */
  run: (context: C) => unknown;
  /** Read reactively: views update when what it reads changes. */
  enabled?: (context: C) => boolean;
  /** For toggles, such as "Show Menu Bar": shown as a check mark. */
  checked?: (context: C) => boolean;
}

export class CommandRegistry {
  readonly commands = new ObservableMap<string, CommandSpec>();

  constructor() {
    makeObservable(this);
  }

  register<C>(spec: CommandSpec<C>): Disposable {
    if (this.commands.has(spec.id)) throw new Error(`Command "${spec.id}" is already registered`);
    this.commands.set(spec.id, spec as CommandSpec);
    return {
      dispose: () => {
        if (this.commands.get(spec.id) === spec) this.commands.delete(spec.id);
      },
    };
  }

  get(id: string): CommandSpec | undefined {
    return this.commands.get(id);
  }

  isEnabled(id: string, context?: unknown): boolean {
    const command = this.commands.get(id);
    return command !== undefined && (command.enabled?.(context) ?? true);
  }

  isChecked(id: string, context?: unknown): boolean | undefined {
    return this.commands.get(id)?.checked?.(context);
  }

  /** Runs a command if it exists and is enabled; returns whether it ran. */
  execute(id: string, context?: unknown): boolean {
    const command = this.commands.get(id);
    if (!command || !this.isEnabled(id, context)) return false;
    command.run(context);
    return true;
  }
}
