// Navigation by name, through the host's index: Go to Symbol, and go to definition and find usages
// from the editor. The index matches names, not meanings (that comes with the language servers),
// so every list says "Name matches".

import type { EditorArea } from '@cerebro-ide/layout';
import { ObservableMap, signal } from '@cerebro-ide/reactive';
import { fuzzyFilter, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { active, currentHost } from './environments.js';
import { icon } from './icons.js';

interface Located {
  path: string;
  line: number;
  column: number;
  name?: string;
  kind?: string;
}

type Choice = PickerItem & { at: Located };

/** Positions to reveal in open files, by path: the editor follows them. */
export const reveals = new ObservableMap<string, { line: number; column: number }>();

const GROUP = 'Name matches';

export function setupNavigation(editor: () => EditorArea | undefined) {
  /** Opens a file at a position. */
  const openAt = (at: Located) => {
    editor()?.open({ id: at.path, title: at.path.split('/').at(-1) as string });
    // A new object each time, so revealing the same place again works.
    reveals.set(at.path, { line: at.line, column: at.column });
  };
  const relative = (path: string) => {
    const root = active()?.id;
    return root !== undefined && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  };
  const choice = (at: Located, label: string): Choice => ({
    label,
    detail: `${relative(at.path)}:${String(at.line + 1)}`,
    ...(at.kind === undefined ? {} : { shortcut: at.kind }),
    group: GROUP,
    icon: () => icon(at.kind === undefined ? 'file' : 'structure'),
    at,
  });
  const request = async (method: string, params: Record<string, string>) => {
    const host = currentHost();
    const env = active();
    if (!host || !env) return [];
    return (await host.request(method, { worktree: env.id, ...params })) as Located[];
  };
  /** A list to choose a place from, opening the one chosen. */
  const choose = async (label: string, empty: string, items: Choice[]) => {
    const chosen = await openPicker<Choice>({
      label,
      placeholder: 'Filter',
      position: 'top',
      empty,
      items: (query) => fuzzyFilter(items, query),
    }).result;
    if (chosen) openAt(chosen.at);
  };

  return {
    /** Whether navigation by name works here: the app, on a real repository. */
    available: () => currentHost() !== undefined && active() !== undefined,

    async goToSymbol() {
      const results = signal<Choice[]>([]);
      let latest = 0;
      const chosen = await openPicker<Choice>({
        label: 'Go to Symbol',
        placeholder: 'Type a class, function or other name',
        position: 'top',
        empty: 'No symbols found',
        items: () => results.get(),
        onQueryChange: (query) => {
          const asked = ++latest;
          void request('index.symbols', { query }).then((found) => {
            // Only the latest query's answer counts.
            if (asked === latest) results.set(found.map((s) => choice(s, s.name ?? '')));
          });
        },
      }).result;
      if (chosen) openAt(chosen.at);
    },

    async goToDefinition(name: string) {
      const found = await request('index.definitions', { name });
      if (found.length === 1) openAt(found[0] as Located);
      else {
        await choose(
          `Definitions of ${name}`,
          `No definition named ${name}`,
          found.map((d) => choice(d, d.name ?? name)),
        );
      }
    },

    async findUsages(name: string) {
      const found = await request('index.usages', { name });
      await choose(
        `Usages of ${name}`,
        `No usages of ${name}`,
        found.map((u) => choice(u, relative(u.path).split('/').at(-1) as string)),
      );
    },
  };
}
