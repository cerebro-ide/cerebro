// Settings. Each is registered with a type, a default and the page it shows on; values are set in
// layers: global (the user's), repo (shared by a repo's worktrees) and worktree. An environment sees
// the narrowest layer that sets a value: worktree, then repo, then global, then the default.
// Everything is reactive, so what reads a setting follows it.
//
// Values from files are checked against the setting's type: unknown settings are kept as they are
// (a plugin may not be loaded yet), invalid values are dropped.

import { makeObservable, ObservableMap, type Disposable } from '@cerebro-ide/reactive';

export type Scope = 'global' | 'repo' | 'worktree';

/** From the narrowest scope to the widest: the order values are looked up in. */
export const SCOPES: readonly Scope[] = ['worktree', 'repo', 'global'];

interface Common {
  /** Dotted, by area: `editor.fontSize`. */
  id: string;
  title: string;
  description?: string;
  /** The page it shows on in the Settings dialog. */
  page: string;
  /** Where it may be set; default: everywhere. A theme, say, is only global. */
  scopes?: readonly Scope[];
  /**
   * Another setting on the same page, whose row this one shows on, after its control: IntelliJ's
   * "Sync with OS" beside its Theme.
   */
  beside?: string;
}

export type SettingSpec = Common &
  (
    | { type: 'boolean'; default: boolean }
    | { type: 'number'; default: number; min?: number; max?: number; integer?: boolean }
    | { type: 'string'; default: string }
    | { type: 'enum'; default: string; options: readonly { value: string; label: string }[] }
  );

export type SettingValue = boolean | number | string;

/** A page of the Settings dialog; pages nest by `parent`. */
export interface PageSpec {
  id: string;
  title: string;
  parent?: string;
  /** Orders a page among its siblings; default 0, then by title. */
  order?: number;
}

/** Whether `value` is a valid value for `spec`. */
export function isValid(spec: SettingSpec, value: unknown): boolean {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'enum':
      return spec.options.some((o) => o.value === value);
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (!spec.integer || Number.isInteger(value)) &&
        (spec.min === undefined || value >= spec.min) &&
        (spec.max === undefined || value <= spec.max)
      );
  }
}

/** Whether a setting may be set in `scope`. */
export function allows(spec: SettingSpec, scope: Scope): boolean {
  return spec.scopes?.includes(scope) ?? true;
}

/** The settings and pages there are. */
export class SettingsRegistry {
  readonly settings = new ObservableMap<string, SettingSpec>();
  readonly pages = new ObservableMap<string, PageSpec>();

  constructor() {
    makeObservable(this);
  }

  register(spec: SettingSpec): Disposable {
    if (this.settings.has(spec.id)) throw new Error(`Setting "${spec.id}" is already registered`);
    if (!isValid(spec, spec.default))
      throw new Error(`Setting "${spec.id}" has an invalid default`);
    this.settings.set(spec.id, spec);
    return {
      dispose: () => {
        if (this.settings.get(spec.id) === spec) this.settings.delete(spec.id);
      },
    };
  }

  registerPage(page: PageSpec): Disposable {
    if (this.pages.has(page.id)) throw new Error(`Page "${page.id}" is already registered`);
    this.pages.set(page.id, page);
    return {
      dispose: () => {
        if (this.pages.get(page.id) === page) this.pages.delete(page.id);
      },
    };
  }

  get(id: string): SettingSpec | undefined {
    return this.settings.get(id);
  }

  /** A page's child pages, in order; the top-level ones without a parent. */
  children(parent?: string): PageSpec[] {
    return [...this.pages.values()]
      .filter((p) => p.parent === parent)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  }

  /** The settings on a page, in registration order. */
  onPage(page: string): SettingSpec[] {
    return [...this.settings.values()].filter((s) => s.page === page);
  }
}

/** The values one layer sets: the global one, a repo's or a worktree's. */
export class SettingsLayer {
  readonly values = new ObservableMap<string, unknown>();

  constructor(
    private readonly registry: SettingsRegistry,
    readonly scope: Scope,
  ) {
    makeObservable(this);
  }

  /** Sets a value, if it's valid for the setting and may be set in this layer's scope. */
  set(id: string, value: unknown): boolean {
    const spec = this.registry.get(id);
    if (!spec || !allows(spec, this.scope) || !isValid(spec, value)) return false;
    this.values.set(id, value);
    return true;
  }

  /** Removes a value, so wider layers or the default show through. */
  reset(id: string): void {
    this.values.delete(id);
  }

  has(id: string): boolean {
    return this.values.has(id);
  }

  /** Replaces the values with ones read from a file: invalid ones for known settings are dropped. */
  load(values: Readonly<Record<string, unknown>>): void {
    this.values.clear();
    for (const [id, value] of Object.entries(values)) {
      const spec = this.registry.get(id);
      if (!spec || (allows(spec, this.scope) && isValid(spec, value))) this.values.set(id, value);
    }
  }

  /** The values, to save. */
  toJSON(): Record<string, unknown> {
    return Object.fromEntries(this.values);
  }
}

/** What an environment sees: its worktree's layer over its repo's over the global one. */
export class Settings {
  readonly layers: Readonly<Record<Scope, SettingsLayer>>;

  constructor(
    readonly registry: SettingsRegistry,
    layers: { global: SettingsLayer; repo: SettingsLayer; worktree: SettingsLayer },
  ) {
    for (const scope of SCOPES) {
      if (layers[scope].scope !== scope)
        throw new Error(`The ${scope} layer has scope ${layers[scope].scope}`);
    }
    this.layers = layers;
  }

  /** The narrowest scope that sets a valid value for a setting, if any does. */
  scopeOf(id: string): Scope | undefined {
    const spec = this.registry.get(id);
    if (!spec) return undefined;
    return SCOPES.find((scope) => {
      const layer = this.layers[scope];
      return layer.has(id) && allows(spec, scope) && isValid(spec, layer.values.get(id));
    });
  }

  /** A setting's value; throws for a setting that isn't registered. */
  get(id: string): SettingValue {
    const spec = this.registry.get(id);
    if (!spec) throw new Error(`Setting "${id}" is not registered`);
    const scope = this.scopeOf(id);
    return scope === undefined ? spec.default : (this.layers[scope].values.get(id) as SettingValue);
  }
}
