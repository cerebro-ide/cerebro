// The layout between runs: tool windows, open environments and their editor areas. Saved shortly
// after each change, and when the page goes away. Local data: in the browser's storage until the
// host's local database exists.

import type { Environments, EnvironmentSpec, Tab, ToolWindows } from '@cerebro-ide/layout';
import { effect } from '@cerebro-ide/reactive';

/** How long changes settle before they're saved, in milliseconds. */
const DELAY = 200;

interface Parts {
  /** Where in the browser's storage it's kept. */
  key: string;
  tools: ToolWindows;
  workspace: Environments;
  /** The environment to open for a saved one, or undefined when it no longer exists. */
  resolve: (spec: EnvironmentSpec) => EnvironmentSpec | undefined;
  /** Whether a saved tab still exists. */
  keepTab: (tab: Tab) => boolean;
}

/** Restores the saved layout; returns false when there is none, so the defaults stay. */
export function restoreLayout(parts: Parts): boolean {
  let saved: { toolWindows?: unknown; environments?: unknown };
  try {
    const text = localStorage.getItem(parts.key);
    if (!text) return false;
    saved = JSON.parse(text) as typeof saved;
  } catch {
    return false;
  }
  parts.tools.restore(saved.toolWindows);
  parts.workspace.restore(saved.environments, parts.resolve, (_env, tab) => parts.keepTab(tab));
  return true;
}

/** Saves the layout whenever it changes. */
export function saveLayout(parts: Parts): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | undefined;
  const write = () => {
    clearTimeout(timer);
    if (pending === undefined) return;
    try {
      localStorage.setItem(parts.key, pending);
    } catch {
      // Storage may be full or blocked: the layout just isn't kept.
    }
    pending = undefined;
  };
  effect(() => {
    pending = JSON.stringify({
      toolWindows: parts.tools.state(),
      environments: parts.workspace.state(),
    });
    clearTimeout(timer);
    timer = setTimeout(write, DELAY);
    return undefined;
  });
  window.addEventListener('pagehide', write);
}
