// Navigate → Select In (Alt+F1; Option+F1 on macOS), as IntelliJ's: a "Select In" popup of the
// places the active file can be shown, numbered as IntelliJ numbers them ("1. Project"), the number
// its mnemonic, in IntelliJ's order (its targets' weights): the Project tool window, then the
// system's file manager ("Reveal in Finder" on macOS, "Show in Explorer" on Windows, "Show in File
// Manager" elsewhere), which only the desktop app can reach. Each target is a command, shown only
// where it can take the file.

import type { CommandRegistry } from '@cerebro-ide/commands';
import { openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import type { Disposable } from '@cerebro-ide/reactive';

/** What Select In shows: a file, by its tab's path, and the targets' numbers. */
interface SelectInContext {
  path: string;
  numbers: ReadonlyMap<string, number>;
}

/** A place a file can be shown. */
export interface SelectInTarget {
  id: string;
  label: string;
  /** Whether it can show the file at `path`. */
  can: (path: string) => boolean;
  show: (path: string) => void | Promise<void>;
}

/** IntelliJ's name for showing a file in the system's file manager, on this platform. */
export function fileManagerLabel(platform: string): string {
  if (platform === 'darwin') return 'Reveal in Finder';
  return platform === 'win32' ? 'Show in Explorer' : 'Show in File Manager';
}

/** IntelliJ's numbering: 1 to 9, then 0, then letters; the `&` marks it the mnemonic. */
export function numbered(index: number, label: string): string {
  const key = index < 9 ? String(index + 1) : index === 9 ? '0' : String.fromCharCode(55 + index);
  return `&${key}. ${label}`;
}

const MENU = 'selectIn';

/**
 * Registers the targets, in order, as commands, and Select In, which opens their popup for the file
 * `file` gives, where `at` says (the caret).
 */
export function setupSelectIn(
  services: MenuServices & { commands: CommandRegistry },
  targets: readonly SelectInTarget[],
  file: () => string | undefined,
  at: () => { x: number; y: number },
): void {
  for (const target of targets) {
    services.commands.register<SelectInContext>({
      id: `selectIn.${target.id}`,
      label: target.label,
      // Only from the popup, which gives the file: not among Search Everywhere's actions.
      enabled: (context?: SelectInContext) => context !== undefined,
      text: (context) => numbered(context.numbers.get(target.id) as number, target.label),
      run: (context) => target.show(context.path),
    });
  }
  services.commands.register({
    id: 'navigate.selectIn',
    label: 'Se&lect In',
    dialog: true,
    enabled: () => file() !== undefined,
    run: () => {
      const path = file();
      if (path === undefined) return;
      const shown = targets.filter((t) => t.can(path));
      const numbers = new Map(shown.map((t, i) => [t.id, i]));
      // Only the targets that can take it, as IntelliJ lists them.
      const contributions: Disposable[] = [
        services.menus.contribute({ menu: MENU, item: { heading: 'Select In' } }),
        ...shown.map((t, i) =>
          services.menus.contribute({
            menu: MENU,
            item: { command: `selectIn.${t.id}` },
            order: i,
          }),
        ),
      ];
      openMenu(services, MENU, at(), {
        context: { path, numbers } satisfies SelectInContext,
        focusFirst: true,
        onClose: () => {
          for (const c of contributions) c.dispose();
        },
      });
    },
  });
}
