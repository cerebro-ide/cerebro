// Sample settings, and their layers: the global one, one per repo (the sample worktrees are all of
// one repo, `cerebro`) and one per worktree. Saved in the browser's storage until the host can save
// them to files.

import { Settings, SettingsLayer, SettingsRegistry, type Scope } from '@cerebro-ide/settings';
import { PRESETS } from './keymaps.js';

export const registry = new SettingsRegistry();

/** As IntelliJ: its own keymap for the system it runs on (`navigator.platform`). */
export function defaultKeymap(platform: string): string {
  return platform.includes('Mac') ? 'intellij-mac' : 'intellij';
}

registry.registerPage({ id: 'appearance', title: 'Appearance', order: 1 });
registry.registerPage({ id: 'editor', title: 'Editor', order: 2 });
registry.registerPage({ id: 'editor/general', title: 'General', parent: 'editor', order: 1 });
registry.registerPage({ id: 'editor/font', title: 'Font', parent: 'editor', order: 2 });
// IntelliJ's Code Style, for every language (IntelliJ has a page per language too).
registry.registerPage({ id: 'editor/codeStyle', title: 'Code Style', parent: 'editor', order: 3 });
registry.registerPage({ id: 'keymap', title: 'Keymap', order: 3 });
// The plugins, theirs to turn on or off, after Keymap as IntelliJ's.
registry.registerPage({ id: 'plugins', title: 'Plugins', order: 4 });
registry.registerPage({ id: 'system', title: 'System Settings', order: 5 });
registry.registerPage({ id: 'vcs', title: 'Version Control', order: 6 });
registry.registerPage({ id: 'vcs/git', title: 'Git', parent: 'vcs' });
// Where plugins for languages put their pages (Prettier's), as IntelliJ's.
registry.registerPage({ id: 'languages', title: 'Languages & Frameworks', order: 7 });
registry.registerPage({ id: 'languages/javascript', title: 'JavaScript', parent: 'languages' });
// IntelliJ's Tools → Diff & Merge (`DiffSettingsConfigurable`).
registry.registerPage({ id: 'tools', title: 'Tools', order: 8 });
registry.registerPage({ id: 'tools/diff', title: 'Diff & Merge', parent: 'tools' });

registry.register({
  id: 'appearance.theme',
  title: 'Theme',
  page: 'appearance',
  type: 'enum',
  default: 'dark',
  // As IntelliJ names them; its plain Dark and Light, without islands, may come later (Ido).
  options: [
    { value: 'dark', label: 'Islands Dark' },
    { value: 'light', label: 'Islands Light' },
  ],
  scopes: ['global'],
});
registry.register({
  id: 'appearance.syncWithOs',
  title: 'Sync with OS',
  description: 'The theme follows the system’s light or dark appearance.',
  page: 'appearance',
  type: 'boolean',
  default: false,
  scopes: ['global'],
  beside: 'appearance.theme',
});
registry.register({
  id: 'appearance.displayScale',
  title: 'Display scale',
  description: 'How large the app draws. Auto follows the system. Applies when the app restarts.',
  page: 'appearance',
  type: 'enum',
  default: 'auto',
  options: [
    { value: 'auto', label: 'Auto' },
    ...['1', '1.25', '1.5', '1.75', '2', '2.5', '3'].map((value) => ({
      value,
      label: `${String(Number(value) * 100)}%`,
    })),
  ],
  scopes: ['global'],
});
registry.register({
  id: 'keymap',
  title: 'Keymap',
  description: 'The keys of the commands, as in IntelliJ or VS Code.',
  page: 'keymap',
  type: 'enum',
  default: defaultKeymap(navigator.platform),
  options: PRESETS.map((preset) => ({ value: preset.id, label: preset.name })),
  scopes: ['global'],
});
registry.register({
  id: 'project.openIn',
  title: 'Open project in',
  description:
    'Where a project opens while another is open: New window adds it as tabs, This window puts it in the active project’s place.',
  page: 'system',
  type: 'enum',
  default: 'ask',
  options: [
    { value: 'ask', label: 'Ask' },
    { value: 'new', label: 'New window' },
    { value: 'this', label: 'This window' },
  ],
  scopes: ['global'],
});
// Autosave, as IntelliJ's System Settings: "Save files if the IDE is idle for 15 seconds", 1 to 300
// (`GeneralSettings.SAVE_FILES_AFTER_IDLE_SEC`). On here, as Ido asked for saving after a while; off
// by default in IntelliJ.
registry.register({
  id: 'system.saveWhenIdle',
  title: 'Save files if the IDE is idle for',
  description: 'Saved once no key has been pressed and the mouse not used for that long.',
  page: 'system',
  type: 'boolean',
  default: true,
  scopes: ['global'],
});
registry.register({
  id: 'system.idleSeconds',
  title: 'seconds',
  page: 'system',
  type: 'number',
  default: 15,
  min: 1,
  max: 300,
  integer: true,
  scopes: ['global'],
  beside: 'system.saveWhenIdle',
});
registry.register({
  id: 'editor.softWrap',
  title: 'Soft-wrap lines',
  description: 'Long lines continue on the next line instead of scrolling sideways.',
  page: 'editor/general',
  type: 'boolean',
  default: false,
});
// IntelliJ's, with its defaults (CodeStyleDefaults, CodeStyleSettings).
registry.register({
  id: 'editor.useTabCharacter',
  title: 'Use tab character',
  page: 'editor/codeStyle',
  type: 'boolean',
  default: false,
});
registry.register({
  id: 'editor.tabSize',
  title: 'Tab size',
  page: 'editor/codeStyle',
  type: 'number',
  default: 4,
  min: 1,
  max: 8,
  integer: true,
});
registry.register({
  id: 'editor.indent',
  title: 'Indent',
  page: 'editor/codeStyle',
  type: 'number',
  default: 4,
  min: 1,
  max: 16,
  integer: true,
});
registry.register({
  id: 'editor.detectIndent',
  title: 'Detect and use existing file indents for editing',
  page: 'editor/codeStyle',
  type: 'boolean',
  default: true,
});
registry.register({
  id: 'editor.fontSize',
  title: 'Size',
  page: 'editor/font',
  type: 'number',
  default: 13,
  min: 6,
  max: 72,
  integer: true,
});
// IntelliJ's (Version Control → Git), off by default: git's own credential helpers answer instead
// of Cerebro's login dialog.
registry.register({
  id: 'git.useCredentialHelper',
  title: 'Use credential helper',
  page: 'vcs/git',
  type: 'boolean',
  default: false,
  scopes: ['global'],
});
registry.register({
  id: 'git.branchPrefix',
  title: 'New branch prefix',
  description: 'Suggested when creating a branch (sample: not used yet).',
  page: 'vcs/git',
  type: 'string',
  default: 'feat/',
});
// IntelliJ's (Version Control → Git), with its defaults: how Update Project takes the upstream's
// commits, and where local changes in the way go meanwhile. Global, as the credential helper is
// (Cerebro's choice, open to change: IntelliJ keeps them by project).
registry.register({
  id: 'git.updateMethod',
  title: 'Update method',
  page: 'vcs/git',
  type: 'enum',
  default: 'merge',
  options: [
    { value: 'merge', label: 'Merge' },
    { value: 'rebase', label: 'Rebase' },
  ],
  scopes: ['global'],
});
registry.register({
  id: 'git.saveChanges',
  title: 'Clean working tree using',
  page: 'vcs/git',
  type: 'enum',
  default: 'shelve',
  options: [
    { value: 'stash', label: 'Stash' },
    { value: 'shelve', label: 'Shelve' },
  ],
  scopes: ['global'],
});
// IntelliJ's Show options before: Update (Version Control → Confirmation); its Update Project
// dialog's Don't show again turns it off.
registry.register({
  id: 'vcs.showUpdateOptions',
  title: 'Show options before update',
  page: 'vcs',
  type: 'boolean',
  default: true,
  scopes: ['global'],
});

const REPO = 'cerebro';

function storageKey(scope: Scope, owner: string): string {
  return `cerebro.settings.${scope}.${owner}`;
}

/** A layer, loaded from the browser's storage. */
function layer(scope: Scope, owner: string): SettingsLayer {
  const result = new SettingsLayer(registry, scope);
  try {
    const saved = localStorage.getItem(storageKey(scope, owner));
    if (saved) result.load(JSON.parse(saved) as Record<string, unknown>);
  } catch {
    // Unreadable storage leaves the defaults.
  }
  return result;
}

const global = layer('global', 'user');
const repo = layer('repo', REPO);
const worktrees = new Map<string, SettingsLayer>();

/** The global settings alone, for global-only settings such as the theme. */
export const globalSettings = new Settings(registry, {
  global,
  repo: new SettingsLayer(registry, 'repo'),
  worktree: new SettingsLayer(registry, 'worktree'),
});

const byWorktree = new Map<string, Settings>();

/** An environment's settings: its worktree's layer over the repo's over the global one. */
export function settingsFor(worktree: string | undefined): Settings {
  if (worktree === undefined) return globalSettings;
  let settings = byWorktree.get(worktree);
  if (!settings) {
    const own = layer('worktree', worktree);
    worktrees.set(worktree, own);
    settings = new Settings(registry, { global, repo, worktree: own });
    byWorktree.set(worktree, settings);
  }
  return settings;
}

/** Saves the layers of `scopes` that `settings` uses. */
export function save(settings: Settings, scopes: readonly Scope[]): void {
  for (const scope of scopes) {
    const owner =
      scope === 'global'
        ? 'user'
        : scope === 'repo'
          ? REPO
          : [...worktrees].find(([, l]) => l === settings.layers.worktree)?.[0];
    if (owner === undefined) continue;
    try {
      localStorage.setItem(storageKey(scope, owner), JSON.stringify(settings.layers[scope]));
    } catch {
      // Storage may be full or blocked; the settings still apply until reload.
    }
  }
}
// The lines Collapse Unchanged Fragments leaves by each change: IntelliJ's choices, 4 by default
// (`TextDiffSettingsHolder`'s CONTEXT_RANGE_MODES), its words (`DiffBundle`). A list for its slider
// (Claude's choice, open to change: the settings pages have no slider).
registry.register({
  id: 'diff.contextLines',
  title: 'Context lines',
  description:
    'The unchanged lines a diff shows by each change as Collapse Unchanged Fragments folds the rest; Disable folds none.',
  page: 'tools/diff',
  type: 'enum',
  default: '4',
  options: [
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '4', label: '4' },
    { value: '8', label: '8' },
    { value: 'disable', label: 'Disable' },
  ],
  scopes: ['global'],
});
// On by default, as IntelliJ's (`DiffSettingsHolder`'s GO_TO_NEXT_FILE_ON_NEXT_DIFFERENCE); its
// words, `DiffBundle`'s.
registry.register({
  id: 'diff.goToNextFile',
  title: 'Go to the next file after reaching last change',
  description:
    'In a diff window opened from a list, Next Difference (F7) pressed again at the last change goes on to the next file, and Previous Difference to the previous one.',
  page: 'tools/diff',
  type: 'boolean',
  default: true,
  scopes: ['global'],
});
