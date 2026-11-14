// New Scratch File, as IntelliJ's (`NewScratchFile`; ScratchFileActions and ScratchFileCreator,
// read from its source): a popup titled New Scratch File lists the languages, the last ones chosen
// first (its LRUPopupBuilder), then the rest by name, narrowed as one types. The one chosen makes an
// empty scratch file of it in the app's folder of them (the host's `scratches.create`, named as
// IntelliJ names them), opened in the editor. The Project view lists them under Scratches and
// Consoles.

import type { Tab } from '@cerebro-ide/layout';
import { languages } from '@cerebro-ide/ui-editor';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { fuzzyFilter, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { active, hostFor, type Host } from './environments.js';
import { notifications } from './notifications.js';
import { refreshTree } from './project.js';

/** Where the languages last chosen are kept, by name, the latest first, if storage allows. */
export const RECENT_LANGUAGES = 'cerebro.scratchLanguages';

interface Choice extends PickerItem {
  extension: string;
}

/** The languages last chosen: none if there are none kept, or storage can't be read. */
function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_LANGUAGES) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** The languages for the popup: those last chosen, the latest first, then the others by name. */
function choices(): Choice[] {
  const all = languages().map((l) => ({ label: l.name, extension: l.extension }));
  const kept = recent();
  const first = kept.flatMap((name) => all.filter((choice) => choice.label === name));
  return [...first, ...all.filter((choice) => !kept.includes(choice.label))];
}

export interface ScratchesSetup {
  /** Opens a file with its editor focused. */
  open: (tab: Tab) => void;
}

export function setupScratches(services: MenuServices, setup: ScratchesSetup): void {
  services.commands.register({
    id: 'file.newScratch',
    label: 'New Scratc&h File',
    dialog: true,
    // The scratch files are the host's: in the desktop app.
    enabled: () => {
      const env = active();
      return env !== undefined && hostFor(env.id) !== undefined;
    },
    run: async () => {
      const items = choices();
      const chosen = await openPicker<Choice>({
        label: 'New Scratch File',
        position: 'top',
        header: () => <span class="playground-popup__title">New Scratch File</span>,
        items: (query) => fuzzyFilter(items, query),
      }).result;
      if (!chosen) return;
      try {
        const kept = [chosen.label, ...recent().filter((name) => name !== chosen.label)];
        localStorage.setItem(RECENT_LANGUAGES, JSON.stringify(kept));
      } catch {
        // Not kept: the popup lists them by name next time.
      }
      // Run only while enabled: the active environment has a host.
      const worktree = (active() as { id: string }).id;
      const host = hostFor(worktree) as Host;
      let path: string;
      try {
        path = (await host.request('scratches.create', { extension: chosen.extension })) as string;
      } catch (error) {
        notifications.notify({
          title: 'Cannot Create Scratch File',
          content: (error as Error).message,
          type: 'error',
        });
        return;
      }
      await refreshTree(worktree);
      setup.open({ id: path, title: path.slice(path.lastIndexOf('/') + 1) });
    },
  });
}
