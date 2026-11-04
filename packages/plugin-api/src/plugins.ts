// Plugins and their contribution points: views (tool windows), commands, menu items, shortcuts,
// settings and their pages, and a step before files are saved. A plugin adds them through the
// context it's activated with, which records each one, so removing the plugin removes everything it
// added. It also reaches the editors (the focused one's file, formatting it) and a file's host.
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
import type { PageSpec, Settings, SettingSpec, SettingsRegistry } from '@cerebro-ide/settings';
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

/**
 * A file's text formatted, or the part of it from `from` to `to` (offsets into the text); or why it
 * can't be.
 */
export type Formatter = (file: {
  path: string;
  text: string;
  range?: { from: number; to: number };
}) => Promise<{ text: string } | { refused: string }>;

/** What a formatting is called, for undo, and what its hint says: the lines changed, or none. */
export interface FormatWords {
  name: string;
  formatted: (lines: number) => string;
  unchanged: string;
}

/**
 * Changes a file's text as it's saved: the text it becomes, and the change's name for undo; or
 * undefined, to leave it as it is.
 */
export type BeforeSave = (file: {
  path: string;
  text: string;
}) => Promise<{ text: string; name: string } | undefined>;

/** The app's code editors, as plugins reach them. */
export interface Editors {
  /** The file of the editor that has the focus, or had it before a menu took it, if it's editable. */
  focused(): string | undefined;
  /**
   * Formats that editor's text, or its selection, through `formatter`, as Reformat Code does: one
   * change undo takes back, and a hint at the caret in `words`.
   */
  format(formatter: Formatter, words: FormatWords): void;
  /** Calls `hook` before each file is saved, as IntelliJ's Actions on Save. */
  beforeSave(hook: BeforeSave): Disposable;
}

/** A host's requests: the process next to a project's files. */
export interface Host {
  request(method: string, params?: unknown): Promise<unknown>;
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
  /** A page in the Settings dialog. */
  registerSettingsPage(page: PageSpec): void;
  /** A setting, on a page. */
  registerSetting(spec: SettingSpec): void;
  /** The settings of the worktree a file is in. */
  settings(path: string): Settings;
  /** The host of the project a file is in; none in a plain browser. */
  host(path: string): Host | undefined;
  /** The code editors. */
  readonly editors: Pick<Editors, 'focused' | 'format'>;
  /** Calls `hook` before each file is saved, as IntelliJ's Actions on Save. */
  beforeSave(hook: BeforeSave): void;
  /** Runs `cleanup` when the plugin is removed. */
  onDispose(cleanup: () => void): void;
}

export interface Plugin {
  /** Unique, dotted by publisher: `cerebro.notes`. */
  id: string;
  name: string;
  /** What it does, in a sentence: the Plugins page shows it. */
  description?: string;
  activate(context: PluginContext): void | Promise<void>;
}

/** What plugins contribute to. */
export interface PluginServices {
  commands: CommandRegistry;
  menus: MenuRegistry;
  keymap: Keymap;
  views: ViewRegistry;
  settings: SettingsRegistry;
  /** The settings of the worktree a file is in. */
  settingsOf: (path: string) => Settings;
  /** The host of the project a file is in. */
  hostOf: (path: string) => Host | undefined;
  editors: Editors;
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
    const { commands, menus, keymap, views, settings, settingsOf, hostOf, editors } = this.services;
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
      registerSettingsPage: (page) => {
        track(settings.registerPage(page));
      },
      registerSetting: (spec) => {
        track(settings.register(spec));
      },
      settings: settingsOf,
      host: hostOf,
      editors: {
        focused: () => editors.focused(),
        format: (formatter, words) => {
          editors.format(formatter, words);
        },
      },
      beforeSave: (hook) => {
        track(editors.beforeSave(hook));
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
