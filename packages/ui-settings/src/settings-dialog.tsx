// The Settings dialog, as IntelliJ's: a search field over a tree of pages on the left, the chosen
// page's settings on the right. Above the page, the scope being edited: Global, the Repository or
// the Worktree, since settings are layered (worktree over repo over global).
//
// Edits are a draft until Apply or OK; Cancel drops them. Each setting shows the value it has at
// the scope being edited, which is inherited from a wider scope unless set there; one set there
// can be reset. A setting set in a narrower scope says so, since that's the value the environment
// sees. Settings that can't be set in the scope (a theme is global only) are disabled there.

import { makeObservable, ObservableMap } from '@cerebro-ide/reactive';
import {
  allows,
  isValid,
  SCOPES,
  type PageSpec,
  type Scope,
  type Settings,
  type SettingSpec,
  type SettingValue,
} from '@cerebro-ide/settings';
import { openDialog, type DialogHandle } from '@cerebro-ide/ui-dialog';

export interface SettingsDialogOptions {
  /** The active environment's settings. */
  settings: Settings;
  /** How each scope is named: Repository and Worktree are better with their names. */
  scopeLabels?: Partial<Record<Scope, string>>;
  /** The scopes that can be edited; without an environment open, only global. Default: all. */
  scopes?: readonly Scope[];
  /** The scope to edit first. Default: global. */
  scope?: Scope;
  /** The page to show first. Default: the first. */
  page?: string;
  /** Called after changes are applied, with the scopes they changed, to save those layers. */
  onApply?: (scopes: Scope[]) => void;
  platform?: 'mac' | 'other';
}

const SCOPE_NAMES: Record<Scope, string> = {
  global: 'Global',
  repo: 'Repository',
  worktree: 'Worktree',
};

/** Marks a draft entry that resets a setting in its scope. */
const RESET = Symbol('reset');

class DialogState {
  scope: Scope;
  page: string | undefined;
  query = '';

  constructor(scope: Scope, page: string | undefined) {
    this.scope = scope;
    this.page = page;
    makeObservable(this);
  }
}

/** Edits not yet applied, by scope and setting. */
class Draft {
  readonly entries = new ObservableMap<string, SettingValue | typeof RESET>();

  constructor(private readonly settings: Settings) {
    makeObservable(this);
  }

  private static key(scope: Scope, id: string): string {
    return `${scope}\u0000${id}`;
  }

  /** Whether a scope sets a setting, counting the draft. */
  isSet(scope: Scope, id: string): boolean {
    const entry = this.entries.get(Draft.key(scope, id));
    if (entry !== undefined) return entry !== RESET;
    return this.settings.layers[scope].has(id);
  }

  /** The value a setting has at `scope`: set there, or inherited from wider scopes, or the default. */
  valueAt(spec: SettingSpec, scope: Scope): SettingValue {
    for (const s of SCOPES.slice(SCOPES.indexOf(scope))) {
      const entry = this.entries.get(Draft.key(s, spec.id));
      if (entry === RESET) continue;
      if (entry !== undefined) return entry;
      const value = this.settings.layers[s].values.get(spec.id);
      if (this.settings.layers[s].has(spec.id) && allows(spec, s) && isValid(spec, value)) {
        return value as SettingValue;
      }
    }
    return spec.default;
  }

  /** The narrowest scope, narrower than `scope`, that sets a setting. */
  overriddenIn(id: string, scope: Scope): Scope | undefined {
    return SCOPES.slice(0, SCOPES.indexOf(scope)).find((s) => this.isSet(s, id));
  }

  set(scope: Scope, id: string, value: SettingValue): void {
    this.entries.set(Draft.key(scope, id), value);
  }

  reset(scope: Scope, id: string): void {
    this.entries.set(Draft.key(scope, id), RESET);
  }

  /** Writes the draft to the layers; returns the scopes it changed. */
  apply(): Scope[] {
    const changed = new Set<Scope>();
    for (const [key, entry] of this.entries) {
      const [scope, id] = key.split('\u0000') as [Scope, string];
      const layer = this.settings.layers[scope];
      if (entry === RESET) layer.reset(id);
      else layer.set(id, entry);
      changed.add(scope);
    }
    this.entries.clear();
    return SCOPES.filter((s) => changed.has(s));
  }
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** Opens the Settings dialog. */
export function openSettings(options: SettingsDialogOptions): DialogHandle<true> {
  const { settings } = options;
  const { registry } = settings;
  const draft = new Draft(settings);
  const first = registry.children()[0]?.id;
  const state = new DialogState(options.scope ?? 'global', options.page ?? first);
  const scopeName = (scope: Scope) => options.scopeLabels?.[scope] ?? SCOPE_NAMES[scope];

  /** Whether a page, or one under it, has a setting or title matching the search. */
  const matches = (page: PageSpec): boolean => {
    const query = state.query.trim().toLowerCase();
    if (query === '') return true;
    return (
      page.title.toLowerCase().includes(query) ||
      registry.onPage(page.id).some((s) => s.title.toLowerCase().includes(query)) ||
      registry.children(page.id).some(matches)
    );
  };

  /** The pages shown in the tree, in order, with their depth. */
  const visiblePages = (): { page: PageSpec; depth: number }[] => {
    const walk = (parent: string | undefined, depth: number): { page: PageSpec; depth: number }[] =>
      registry
        .children(parent)
        .filter(matches)
        .flatMap((page) => [{ page, depth }, ...walk(page.id, depth + 1)]);
    return walk(undefined, 0);
  };

  const Control = (p: { spec: SettingSpec }) => {
    const { spec } = p;
    const disabled = () => !allows(spec, state.scope);
    const value = () => draft.valueAt(spec, state.scope);
    const set = (next: unknown) => {
      if (isValid(spec, next)) draft.set(state.scope, spec.id, next as SettingValue);
    };
    switch (spec.type) {
      case 'boolean':
        return (
          <input
            type="checkbox"
            class="cerebro-setting__checkbox"
            prop:checked={() => value() === true}
            disabled={disabled}
            aria-label={spec.title}
            on:change={(event) => {
              set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
        );
      case 'enum':
        return (
          <select
            class="cerebro-setting__input"
            disabled={disabled}
            aria-label={spec.title}
            prop:value={() => value()}
            on:change={(event) => {
              set((event.currentTarget as HTMLSelectElement).value);
            }}
          >
            {spec.options.map((o) => (
              <option value={o.value}>{o.label}</option>
            ))}
          </select>
        );
      case 'number':
      case 'string': {
        const isNumber = spec.type === 'number';
        return (
          <input
            type={isNumber ? 'number' : 'text'}
            class="cerebro-setting__input"
            spellcheck={false}
            disabled={disabled}
            aria-label={spec.title}
            prop:value={() => String(value())}
            min={spec.type === 'number' && spec.min !== undefined ? String(spec.min) : null}
            max={spec.type === 'number' && spec.max !== undefined ? String(spec.max) : null}
            on:input={(event) => {
              const input = event.currentTarget as HTMLInputElement;
              const next = isNumber ? input.valueAsNumber : input.value;
              const valid = isValid(spec, next);
              input.classList.toggle('cerebro-setting__input--invalid', !valid);
              set(next);
            }}
          />
        );
      }
    }
  };

  const Reset = (p: { spec: SettingSpec }) => () =>
    draft.isSet(state.scope, p.spec.id) ? (
      <button
        type="button"
        class="cerebro-setting__reset"
        on:click={() => {
          draft.reset(state.scope, p.spec.id);
        }}
      >
        Reset
      </button>
    ) : null;

  /** A setting shown on another's row: its control, then its title, as a checkbox's label. */
  const Beside = (p: { spec: SettingSpec }) => (
    <span
      class={() =>
        cls(
          'cerebro-setting__beside',
          draft.isSet(state.scope, p.spec.id) && 'cerebro-setting__beside--set',
        )
      }
      data-setting={p.spec.id}
    >
      <label class="cerebro-setting__beside-label">
        <Control spec={p.spec} />
        <span class="cerebro-setting__beside-title">{p.spec.title}</span>
      </label>
      <Reset spec={p.spec} />
    </span>
  );

  const Setting = (p: { spec: SettingSpec }) => {
    const { spec } = p;
    const isSet = () => draft.isSet(state.scope, spec.id);
    return (
      <div
        class={() => cls('cerebro-setting', isSet() && 'cerebro-setting--set')}
        data-setting={spec.id}
      >
        <div class="cerebro-setting__row">
          <span class="cerebro-setting__title">{spec.title}</span>
          <Control spec={spec} />
          <Reset spec={spec} />
          {registry
            .onPage(spec.page)
            .filter((other) => other.beside === spec.id)
            .map((other) => (
              <Beside spec={other} />
            ))}
        </div>
        {spec.description === undefined ? null : (
          <div class="cerebro-setting__note">{spec.description}</div>
        )}
        {() => {
          if (!allows(spec, state.scope)) {
            // Only a setting that names its scopes is disallowed in one.
            const where = (spec.scopes as readonly Scope[]).map(scopeName).join(', ');
            return <div class="cerebro-setting__note">{where} only</div>;
          }
          const over = draft.overriddenIn(spec.id, state.scope);
          return over === undefined ? null : (
            <div class="cerebro-setting__note cerebro-setting__note--override">
              Overridden in {scopeName(over)}
            </div>
          );
        }}
      </div>
    );
  };

  const Page = (p: { id: string | undefined }) => {
    const page = p.id === undefined ? undefined : registry.pages.get(p.id);
    if (!page) return <div class="cerebro-settings__empty">No settings</div>;
    const settingsHere = registry.onPage(page.id);
    return (
      <div class="cerebro-settings__page">
        <h2 class="cerebro-settings__heading">{page.title}</h2>
        {settingsHere.length === 0 ? (
          <div class="cerebro-settings__empty">Choose a page below {page.title}</div>
        ) : (
          settingsHere
            // One shown beside another is on that one's row.
            .filter((spec) => !settingsHere.some((other) => other.id === spec.beside))
            .map((spec) => <Setting spec={spec} />)
        )}
      </div>
    );
  };

  return openDialog<true>({
    title: 'Settings',
    width: 860,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ok: { accept: () => true },
    apply: {
      enabled: () => draft.entries.size > 0,
      run: () => {
        const changed = draft.apply();
        options.onApply?.(changed);
      },
    },
    content: () => (
      <div class="cerebro-settings">
        <div class="cerebro-settings__side">
          <input
            class="cerebro-settings__search"
            type="text"
            placeholder="Search"
            aria-label="Search settings"
            spellcheck={false}
            on:input={(event) => {
              state.query = (event.currentTarget as HTMLInputElement).value;
            }}
          />
          <div
            class="cerebro-settings__tree"
            role="tree"
            aria-label="Settings pages"
            tabIndex={0}
            on:keydown={(event) => {
              const pages = visiblePages();
              const index = pages.findIndex((p) => p.page.id === state.page);
              const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
              if (step === 0) return;
              event.preventDefault();
              const next = pages[Math.min(Math.max(index + step, 0), pages.length - 1)];
              if (next) state.page = next.page.id;
            }}
          >
            {() =>
              visiblePages().map(({ page, depth }) => (
                <div
                  class={() =>
                    cls(
                      'cerebro-settings__node',
                      state.page === page.id && 'cerebro-settings__node--selected',
                    )
                  }
                  role="treeitem"
                  aria-selected={() => String(state.page === page.id)}
                  data-page={page.id}
                  style={{ paddingLeft: `${String(8 + depth * 16)}px` }}
                  on:click={() => {
                    state.page = page.id;
                  }}
                >
                  {page.title}
                </div>
              ))
            }
          </div>
        </div>
        <div class="cerebro-settings__main">
          <div class="cerebro-settings__scopes" role="radiogroup" aria-label="Scope">
            {SCOPES.toReversed()
              .filter((scope) => options.scopes?.includes(scope) ?? true)
              .map((scope) => (
                <button
                  type="button"
                  role="radio"
                  class={() =>
                    cls(
                      'cerebro-settings__scope',
                      state.scope === scope && 'cerebro-settings__scope--active',
                    )
                  }
                  aria-checked={() => String(state.scope === scope)}
                  data-scope={scope}
                  on:click={() => {
                    state.scope = scope;
                  }}
                >
                  {scopeName(scope)}
                </button>
              ))}
          </div>
          {() => {
            // Read here, as components run untracked.
            const id = state.page;
            return <Page id={id} />;
          }}
        </div>
      </div>
    ),
  });
}
