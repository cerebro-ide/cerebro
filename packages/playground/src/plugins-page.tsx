// Settings → Plugins, as IntelliJ's Installed tab: each plugin, its name and what it does, with a
// checkbox that turns it on or off. Every plugin is on until it's turned off (Ido, 2026-11-04: "for
// now all plugins we create should be enabled by default"). Turning one off removes it and all it
// added at once, where IntelliJ mostly asks to restart; which are off is kept in the browser's
// storage, as the settings are.

import type { Plugin, PluginRegistry } from '@cerebro-ide/plugin-api';
import { signal } from '@cerebro-ide/reactive';
import type { CustomPage } from '@cerebro-ide/ui-settings';

const STORAGE_KEY = 'cerebro.plugins.disabled';

/** The plugins turned off, as saved; none where they can't be read. */
export function loadDisabled(): ReadonlySet<string> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return new Set(JSON.parse(saved) as string[]);
  } catch {
    // Unreadable storage leaves every plugin on.
  }
  return new Set();
}

/** The ids of the plugins turned off. */
export const disabledPlugins = signal<ReadonlySet<string>>(loadDisabled());

/** The plugins there are, on or off, and the registry the ones on are in. */
let installed: { plugins: readonly Plugin[]; registry: PluginRegistry } | undefined;

/** Adds a plugin; one whose activation fails says so on the page, and in the console. */
async function turnOn(registry: PluginRegistry, plugin: Plugin): Promise<void> {
  await registry.add(plugin).catch((error: unknown) => {
    console.error(error);
  });
}

/** Adds the plugins that aren't turned off, and lists them all on the Plugins page. */
export async function addPlugins(registry: PluginRegistry, plugins: readonly Plugin[]) {
  installed = { plugins, registry };
  const off = disabledPlugins.peek();
  for (const plugin of plugins) if (!off.has(plugin.id)) await turnOn(registry, plugin);
}

const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/** The Plugins page's list, with its own draft of which are off, applied with the dialog's. */
export function pluginsPage(): CustomPage {
  const draft = signal<ReadonlySet<string>>(disabledPlugins.peek());
  const toggle = (id: string, on: boolean) => {
    const next = new Set(draft.get());
    if (on) next.delete(id);
    else next.add(id);
    draft.set(next);
  };
  return {
    render: () => (
      <ul class="playground-plugins" aria-label="Installed">
        {(installed?.plugins ?? []).map((plugin) => (
          <li class="playground-plugins__item">
            <label class="playground-plugins__row">
              <span class="playground-plugins__name">{plugin.name}</span>
              <input
                type="checkbox"
                checked={() => !draft.get().has(plugin.id)}
                on:change={(event) => {
                  toggle(plugin.id, (event.currentTarget as HTMLInputElement).checked);
                }}
              />
            </label>
            {plugin.description === undefined ? null : (
              <div class="playground-plugins__note">{plugin.description}</div>
            )}
            {() => {
              const error = installed?.registry.plugins.get(plugin.id)?.error;
              return error === undefined ? null : (
                <div class="playground-plugins__note playground-plugins__note--error">
                  Failed to start: {error}
                </div>
              );
            }}
          </li>
        ))}
      </ul>
    ),
    changed: () => !same(draft.get(), disabledPlugins.get()),
    apply: () => {
      const off = draft.peek();
      disabledPlugins.set(off);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...off]));
      } catch {
        // Storage may be full or blocked; the plugins stay as chosen until reload.
      }
      if (!installed) return;
      const { plugins, registry } = installed;
      for (const plugin of plugins) {
        const entry = registry.plugins.get(plugin.id);
        if (off.has(plugin.id)) {
          if (entry) registry.remove(plugin.id);
        } else if (entry?.state !== 'active' && entry?.state !== 'activating') {
          // One that failed to start is tried again.
          if (entry) registry.remove(plugin.id);
          void turnOn(registry, plugin);
        }
      }
    },
  };
}
