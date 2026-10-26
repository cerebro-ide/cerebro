// Plugins and their first contribution points: views (tool windows), commands, menu items and
// shortcuts. A plugin adds them through the context it's activated with, which records each one,
// so removing the plugin removes everything it added.
//
// The boundary is the DOM: a view is mounted into a container element the plugin fills however it
// likes, so plugins aren't tied to Cerebro's JSX or any framework.

import type {
  CommandRegistry,
  CommandSpec,
  Contribution,
  Keymap,
  MenuRegistry,
} from '@cerebro-ide/commands';
import type { ToolWindows, ToolWindowSpec } from '@cerebro-ide/layout';
import { makeObservable, ObservableMap, type Disposable } from '@cerebro-ide/reactive';

/** A tool window's view: its place, and how its content is drawn. */
export interface ViewContribution extends ToolWindowSpec {
  /** Fills `container`; may return a function that cleans up when the view goes away. */
  mount(container: HTMLElement): (() => void) | undefined;
}

/** Views by id, each with its tool window. */
export class ViewRegistry {
  readonly views = new ObservableMap<string, ViewContribution>();

  constructor(private readonly toolWindows: ToolWindows) {
    makeObservable(this);
  }

  /** Adds a view and its tool window; disposing removes both. */
  register(view: ViewContribution): Disposable {
    this.toolWindows.register(view);
    this.views.set(view.id, view);
    return {
      dispose: () => {
        if (this.views.get(view.id) !== view) return;
        this.views.delete(view.id);
        this.toolWindows.unregister(view.id);
      },
    };
  }

  get(id: string): ViewContribution | undefined {
    return this.views.get(id);
  }
}

/** What a plugin contributes through: each addition is undone when the plugin is removed. */
export interface PluginContext {
  /** The plugin's id. */
  readonly id: string;
  registerCommand<C>(spec: CommandSpec<C>): void;
  contributeMenu(contribution: Contribution): void;
  /** A default shortcut; the user's bindings come first, as for any default. */
  bindKey(key: string, command: string): void;
  registerView(view: ViewContribution): void;
  /** Runs `cleanup` when the plugin is removed. */
  onDispose(cleanup: () => void): void;
}

export interface Plugin {
  /** Unique, dotted by publisher: `cerebro.notes`. */
  id: string;
  name: string;
  activate(context: PluginContext): void | Promise<void>;
}

/** What plugins contribute to. */
export interface PluginServices {
  commands: CommandRegistry;
  menus: MenuRegistry;
  keymap: Keymap;
  views: ViewRegistry;
}

export type PluginState = 'activating' | 'active' | 'failed';

/** A plugin as the registry holds it. */
export class PluginEntry {
  state: PluginState = 'activating';
  /** Why activation failed. */
  error: string | undefined = undefined;

  constructor(readonly plugin: Plugin) {
    makeObservable(this);
  }
}

export class PluginRegistry {
  readonly plugins = new ObservableMap<string, PluginEntry>();
  /** What each plugin added, undone in reverse order on removal. */
  private readonly added = new Map<string, (() => void)[]>();

  constructor(private readonly services: PluginServices) {
    makeObservable(this);
  }

  /**
   * Adds and activates a plugin. Resolves when it's active; if activation fails, what it added so
   * far is removed, the entry records the error, and the promise rejects.
   */
  async add(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.id)) throw new Error(`Plugin "${plugin.id}" is already added`);
    const entry = new PluginEntry(plugin);
    this.plugins.set(plugin.id, entry);
    const cleanups: (() => void)[] = [];
    this.added.set(plugin.id, cleanups);
    const track = (disposable: Disposable) => {
      cleanups.push(() => {
        disposable.dispose();
      });
    };
    const { commands, menus, keymap, views } = this.services;
    const context: PluginContext = {
      id: plugin.id,
      registerCommand: (spec) => {
        track(commands.register(spec));
      },
      contributeMenu: (contribution) => {
        track(menus.contribute(contribution));
      },
      bindKey: (key, command) => {
        track(keymap.bindDefault(key, command));
      },
      registerView: (view) => {
        track(views.register(view));
      },
      onDispose: (cleanup) => {
        cleanups.push(cleanup);
      },
    };
    try {
      await plugin.activate(context);
      entry.state = 'active';
    } catch (error) {
      this.undo(plugin.id);
      entry.state = 'failed';
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /** Removes a plugin and everything it added. */
  remove(id: string): void {
    this.undo(id);
    this.plugins.delete(id);
  }

  private undo(id: string): void {
    const cleanups = this.added.get(id) ?? [];
    this.added.delete(id);
    for (const cleanup of cleanups.reverse()) cleanup();
  }
}
