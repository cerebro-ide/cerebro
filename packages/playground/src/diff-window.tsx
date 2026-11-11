// A diff window's page (boot.ts): one file's diff, as IntelliJ's diff window, with the diff's toolbar
// and keys. It names what it shows in its URL's hash, reads it through its opener's hosts (the app
// shares them), takes the settings kept for every window (the theme, the keymap, the font), and
// sends Jump to Source back to its opener.

import '@cerebro-ide/theme/fonts.css';
import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/theme/base.css';
import '@cerebro-ide/ui-editor/styles.css';
import '@cerebro-ide/ui-menu/styles.css';
import '@cerebro-ide/ui-toolbar/styles.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import { installScrollbars } from '@cerebro-ide/ui-scrollbar';
import '@cerebro-ide/ui-scrollbar/styles.css';
import './bridge.js';
import {
  chordFromEvent,
  CommandRegistry,
  KeyDispatcher,
  Keymap,
  MenuRegistry,
} from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { effect } from '@cerebro-ide/reactive';
import { diffSource } from '@cerebro-ide/ui-editor';
import { MainToolbar } from '@cerebro-ide/ui-toolbar';
import type { DiffSpec } from './bridge.js';
import { FileDiff, setupDiffViewer } from './diff-viewer.js';
import { userKeymaps } from './keymap-page.js';
import { keymapPlatform, PRESETS } from './keymaps.js';
import { globalSettings, settingsFor } from './settings.js';
import { applyTheme, themeIsDark } from './theme.js';
import './playground.css';

/** What the window shows, from its hash (`diff=` and the spec, as the app writes it). */
export function specOf(hash: string): DiffSpec {
  return JSON.parse(decodeURIComponent(hash.replace(/^#diff=/, ''))) as DiffSpec;
}

/** The window's title: the file's name, and the commits it's between if it's a range's. */
export function titleOf(spec: DiffSpec): string {
  const name = spec.path.split('/').at(-1) as string;
  return spec.range
    ? `${name} (${spec.range.from.slice(0, 8)}..${spec.range.to.slice(0, 8)})`
    : name;
}

const app = window.cerebro as NonNullable<Window['cerebro']>;
const spec = specOf(location.hash);

document.documentElement.classList.add('cerebro-app', `cerebro-platform-${app.platform}`);
document.title = titleOf(spec);
effect(() => {
  applyTheme(themeIsDark(globalSettings));
  return undefined;
});
installScrollbars();

// The keymap chosen in Settings → Keymap, with the user's changes, as the project's window has it.
const keymap = new Keymap(keymapPlatform(navigator.platform));
effect(() => {
  const id = globalSettings.get('keymap') as string;
  keymap.setPreset(PRESETS.find((preset) => preset.id === id));
  keymap.setUser(userKeymaps.get()[id] ?? []);
  return undefined;
});
const services = { commands: new CommandRegistry(), menus: new MenuRegistry(), keymap };
setupDiffViewer(services);
// Jump to Source, as from a diff tab: back in the opener, where the caret is.
services.commands.register({
  id: 'changes.jumpToSource',
  label: 'Jump to Source',
  enabled: () =>
    document.activeElement !== null && diffSource(document.activeElement) !== undefined,
  run: () => {
    const at = diffSource(document.activeElement as Element) as { line: number; column: number };
    void app.diff.jump({ env: spec.env, path: spec.path, ...at });
  },
});
const dispatcher = new KeyDispatcher(keymap, services.commands);
window.addEventListener('keydown', (event) => {
  const chord = chordFromEvent(event);
  if (chord !== undefined && dispatcher.press(chord) !== 'unhandled') event.preventDefault();
});

const settings = settingsFor(spec.env);
render(
  () => (
    <div class="playground-diff-window">
      <MainToolbar
        left={() => <span class="playground-diff-window__title">{document.title}</span>}
      />
      <FileDiff
        services={services}
        path={spec.path}
        read={() =>
          app.host.request(spec.project, 'git.diff', {
            path: spec.env,
            file: spec.path,
            ...spec.range,
          }) as Promise<{ original: string; text: string }>
        }
        fontSize={() => settings.get('editor.fontSize') as number}
        tabSize={() => settings.get('editor.tabSize') as number}
      />
    </div>
  ),
  document.getElementById('app') as HTMLElement,
);
