// Next and Previous Occurrence, as IntelliJ's (`NextOccurenceAction` and `PreviousOccurenceAction`,
// through `OccurenceNavigatorActionBase` and `OccurenceNavigatorSupport`, read from its source):
// Ctrl+Alt+Down and Up go to the next or previous result of a tool window that lists them (Find,
// and Hierarchy), from wherever the keyboard is: the focused tool window's, else the one active
// last that has them (`LAST_ACTIVE_TOOL_WINDOWS`), so a search's results can be stepped through
// from the editor. The result is selected in its tree, under its parents expanded, and opened in
// the editor, which takes the keyboard (`navigate(true)`). Its tree is walked as IntelliJ's: every
// node loaded, collapsed or not, after or before the one selected, from the start with none
// selected; nothing before the start, nor after the end. In the Navigate menu after Next Edit
// Location, "Previous Occurrence" then "Next Occurrence" (`GoToMenu`, ActionsBundle's words).

import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { TreeModel } from '@cerebro-ide/ui-tree';

/** What a tool window's results give the actions. */
export interface OccurrenceNavigator {
  /** Whether there's one to go to, after the one selected or before it. */
  has(forward: boolean): boolean;
  /** Selects the next or previous one, and opens it. */
  go(forward: boolean): void;
}

/** The navigators of the tool windows showing results, by window. */
const navigators = new Map<string, OccurrenceNavigator>();

/** Gives a tool window's results to the actions, until the function returned is called. */
export function provideOccurrences(window: string, navigator: OccurrenceNavigator): () => void {
  navigators.set(window, navigator);
  return () => {
    if (navigators.get(window) === navigator) navigators.delete(window);
  };
}

/**
 * A tree's results, as IntelliJ's `OccurenceNavigatorSupport`: the nodes `isOccurrence` takes,
 * each opened with `open`.
 */
export function treeOccurrences<T>(
  model: TreeModel<T>,
  isOccurrence: (node: T) => boolean,
  open: (node: T) => void,
): OccurrenceNavigator {
  const find = (forward: boolean) => {
    const nodes = model.loadedNodes;
    const at = nodes.findIndex((n) => n.keys.at(-1) === model.selected);
    const candidates = forward ? nodes.slice(at + 1) : at < 0 ? [] : nodes.slice(0, at).reverse();
    return candidates.find((n) => isOccurrence(n.node));
  };
  return {
    has: (forward) => find(forward) !== undefined,
    go: (forward) => {
      const found = find(forward);
      if (!found) return;
      // Selected at once, so the next press goes on from it; its parents expanded after.
      model.select(found.keys.at(-1));
      void model.reveal(found.keys);
      open(found.node);
    },
  };
}

/** The tool windows the keyboard was in, the latest first. */
let recent: string[] = [];

const windowOf = (element: Element | null) =>
  element?.closest('.cerebro-tool-window')?.getAttribute('data-id') ?? undefined;

/** The focused tool window's navigator, else the latest active one's that has one. */
function navigator(): OccurrenceNavigator | undefined {
  const focused = windowOf(document.activeElement);
  const own = focused === undefined ? undefined : navigators.get(focused);
  if (own) return own;
  for (const window of recent) {
    const found = navigators.get(window);
    if (found) return found;
  }
  return undefined;
}

/** The actions, their place in the Navigate menu, and the tool windows' activity followed. */
export function setupOccurrences(services: MenuServices): void {
  document.addEventListener('focusin', (event) => {
    const window = windowOf(event.target as Element);
    if (window !== undefined) recent = [window, ...recent.filter((w) => w !== window)];
  });
  for (const [id, label, forward] of [
    ['navigate.previousOccurrence', 'Previ&ous Occurrence', false],
    ['navigate.nextOccurrence', 'Ne&xt Occurrence', true],
  ] as const) {
    services.commands.register({
      id,
      label,
      enabled: () => navigator()?.has(forward) ?? false,
      run: () => {
        (navigator() as OccurrenceNavigator).go(forward);
      },
    });
    services.menus.contribute({ menu: 'main/navigate', item: { command: id }, group: 'a' });
  }
}
