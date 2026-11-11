// A diff window's page (boot.ts): a file's diff, as IntelliJ's diff window, with the diff's toolbar
// and keys, and the other files of the list it was opened from: Compare Previous and Next File, and
// Go to Changed File from its count. It names what it shows in its URL's hash, reads it through its
// opener's hosts (the app shares them), takes the settings kept for every window (the theme, the
// keymap, the font), and sends Jump to Source back to its opener.

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
import { effect, signal } from '@cerebro-ide/reactive';
import { diffSource } from '@cerebro-ide/ui-editor';
import { fuzzyFilter, openPicker } from '@cerebro-ide/ui-popup';
import '@cerebro-ide/ui-popup/styles.css';
import { MainToolbar } from '@cerebro-ide/ui-toolbar';
import { tooltip } from '@cerebro-ide/ui-tooltip';
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
/** The files it goes through, and the one it shows. */
const chain = spec.chain ?? [spec.path];
/** The file shown, and where its caret starts: its last change, come back to by Previous Difference. */
const current = signal<{ path: string; scrollTo?: 'lastChange' }>({ path: spec.path });
const at = () => chain.indexOf(current.get().path);
/** The file `step` away from the one shown, if there's one. */
const beside = (step: 1 | -1) => chain[at() + step];
const title = () => titleOf({ ...spec, path: current.get().path });

document.documentElement.classList.add('cerebro-app', `cerebro-platform-${app.platform}`);
effect(() => {
  document.title = title();
  return undefined;
});
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
// Next and Previous Difference go on to the list's files past a file's ends, as IntelliJ's.
setupDiffViewer(services, {
  has: (step) => beside(step) !== undefined,
  go: (step) => {
    current.set({
      path: beside(step) as string,
      ...(step < 0 ? { scrollTo: 'lastChange' as const } : {}),
    });
  },
});
/** Where the window's diff's caret is, on the side last focused; undefined until it shows. */
const source = () => {
  const diff = document.querySelector('.cerebro-editor-diff');
  return diff ? diffSource(diff) : undefined;
};
// Jump to Source, as from a diff tab: back in the opener, where the caret is. The toolbar's button
// is told the diff (its context) once it shows.
services.commands.register({
  id: 'changes.jumpToSource',
  label: 'Jump to Source',
  icon: 'editSource',
  enabled: () => source() !== undefined,
  run: () => {
    const at = source() as { line: number; column: number };
    void app.diff.jump({ env: spec.env, path: current.peek().path, ...at });
  },
});
// The list's files, as IntelliJ's Diff.PrevChange and Diff.NextChange (its names, `ActionsBundle`).
for (const [id, label, step] of [
  ['diff.previousFile', 'Compare Previous File', -1],
  ['diff.nextFile', 'Compare Next File', 1],
] as const) {
  services.commands.register({
    id,
    label,
    icon: id.replace('diff.', ''),
    enabled: () => beside(step) !== undefined,
    run: () => {
      current.set({ path: beside(step) as string });
    },
  });
}
/** Go to Changed File: the list's files, by name and folder, the one shown chosen. */
async function goToFile(anchor: Element): Promise<void> {
  const items = chain.map((path) => {
    const slash = path.lastIndexOf('/');
    return slash < 0
      ? { label: path, path }
      : { label: path.slice(slash + 1), detail: path.slice(0, slash), path };
  });
  const chosen = await openPicker({
    label: 'Go to Changed File',
    position: { below: anchor },
    placeholder: 'Filter',
    items: (query) => fuzzyFilter(items, query),
    initial: at(),
    owner: anchor,
  }).result;
  if (chosen) current.set({ path: chosen.path });
}
const dispatcher = new KeyDispatcher(keymap, services.commands);
window.addEventListener('keydown', (event) => {
  const chord = chordFromEvent(event);
  if (chord !== undefined && dispatcher.press(chord) !== 'unhandled') event.preventDefault();
});

const settings = settingsFor(spec.env);
// The file may have changed while the window was in the background: read again with the focus
// back, as the Log does.
const version = signal(0);
window.addEventListener('focus', () => {
  version.set(version.peek() + 1);
});
render(
  () => (
    <div class="playground-diff-window">
      <MainToolbar left={() => <span class="playground-diff-window__title">{title}</span>} />
      {() => {
        // Made again for each file, as IntelliJ's window shows the next.
        const { path, scrollTo } = current.get();
        return (
          <FileDiff
            services={services}
            path={path}
            read={() =>
              app.host.request(spec.project, 'git.diff', {
                path: spec.env,
                file: path,
                ...spec.range,
              }) as Promise<{ original: string; text: string }>
            }
            version={() => version.get()}
            {...(scrollTo ? { scrollTo } : {})}
            focus
            fontSize={() => settings.get('editor.fontSize') as number}
            tabSize={() => settings.get('editor.tabSize') as number}
            navigation={(button) => [
              button('changes.jumpToSource'),
              ...(chain.length > 1
                ? [
                    button('diff.previousFile'),
                    <button
                      type="button"
                      class="cerebro-toolbar-button playground-diff-window__count"
                      ref={tooltip({ text: () => 'Go to Changed File', placement: 'below' })}
                      on:click={(event) => {
                        void goToFile(event.currentTarget as Element);
                      }}
                    >
                      {() => `${String(at() + 1)}/${String(chain.length)}`}
                    </button>,
                    button('diff.nextFile'),
                  ]
                : []),
            ]}
          />
        );
      }}
    </div>
  ),
  document.getElementById('app') as HTMLElement,
);
