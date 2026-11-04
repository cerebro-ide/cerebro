// Prettier, as IntelliJ's plugin (prettierJS), written as a third party would: through the plugin
// API alone. Reformat with Prettier formats the focused editor's file, or its selection, with the
// project's own Prettier (the host runs it): from the editor's context menu, on its key
// (Ctrl+Alt+Shift+P), and as files are saved, when Run on save is on. Its settings are on the
// Settings dialog's Languages & Frameworks → JavaScript → Prettier page, where IntelliJ has them.

import type { FormatWords, Formatter, Plugin, PluginContext } from '@cerebro-ide/plugin-api';

/** IntelliJ's default for Run for files (`PrettierConfiguration`). */
export const FILES_DEFAULT = '**/*.{js,ts,jsx,tsx,cjs,cts,mjs,mts,json,vue,astro}';

/** IntelliJ's words (PrettierBundle); one line is "line", as Reformat Code's hint has it. */
const WORDS: FormatWords = {
  name: 'Reformat Code With Prettier',
  formatted: (lines) => `Prettier: formatted ${String(lines)} ${lines === 1 ? 'line' : 'lines'}`,
  unchanged: 'Prettier: no lines changed. Content is already properly formatted',
};

/** Why there's no Prettier in a plain browser: there's no host to run it. */
export const NO_HOST = 'Prettier runs in the desktop app';

/** A glob as a regular expression: `**` any folders, `*` and `?` within a name, `{a,b}` either. */
function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?';
      i += 2;
    } else if (glob.startsWith('**', i)) {
      source += '.*';
      i += 1;
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else if (c === '{') source += '(?:';
    else if (c === '}') source += ')';
    else if (c === ',') source += '|';
    else source += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  // From any folder down: the project's root isn't known here (a claim that it's close enough).
  return new RegExp(`(?:^|/)${source}$`);
}

/** Whether a file is one Run for files names. */
export function matchesGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path.replaceAll('\\', '/'));
}

/** Asks the file's host to format it with Prettier. */
function formatter(context: PluginContext): Formatter {
  return async ({ path, text, range }) => {
    const host = context.host(path);
    if (!host) return { refused: NO_HOST };
    const folder = String(context.settings(path).get('prettier.package'));
    return (await host.request('prettier.format', {
      path,
      text,
      ...(range ? { from: range.from, to: range.to } : {}),
      ...(folder === '' ? {} : { package: folder }),
    })) as Awaited<ReturnType<Formatter>>;
  };
}

export const prettierPlugin: Plugin = {
  id: 'cerebro.prettier',
  name: 'Prettier',
  description:
    'Formats files with the project’s Prettier: from the editor’s context menu, on a key, and on save.',
  activate(context) {
    const format = formatter(context);
    context.registerSettingsPage({
      id: 'languages/javascript/prettier',
      title: 'Prettier',
      parent: 'languages/javascript',
    });
    context.registerSetting({
      id: 'prettier.package',
      title: 'Prettier package',
      description:
        'The prettier package’s folder. Empty: the closest node_modules/prettier above each file.',
      page: 'languages/javascript/prettier',
      type: 'string',
      default: '',
    });
    context.registerSetting({
      id: 'prettier.files',
      title: 'Run for files',
      description: 'The files Run on save formats, as a glob.',
      page: 'languages/javascript/prettier',
      type: 'string',
      default: FILES_DEFAULT,
    });
    context.registerSetting({
      id: 'prettier.onSave',
      title: 'Run on save',
      description: 'Each time one of those files is saved, by Save All or on its own.',
      page: 'languages/javascript/prettier',
      type: 'boolean',
      default: false,
    });
    context.registerCommand({
      id: 'prettier.reformat',
      label: 'Reformat with Prettier',
      enabled: () => context.editors.focused() !== undefined,
      run: () => {
        context.editors.format(format, WORDS);
      },
    });
    // Last in the editor's context menu, as IntelliJ adds it (`anchor="last"`).
    context.contributeMenu({
      menu: 'editor/content',
      item: { command: 'prettier.reformat' },
      group: 'z',
    });
    context.bindKey('Mod+Alt+Shift+P', 'prettier.reformat');
    context.beforeSave(async (file) => {
      const settings = context.settings(file.path);
      if (settings.get('prettier.onSave') !== true) return undefined;
      if (!matchesGlob(String(settings.get('prettier.files')), file.path)) return undefined;
      const answer = await format(file);
      // One it can't format is saved as it is.
      return 'text' in answer ? { text: answer.text, name: WORDS.name } : undefined;
    });
  },
};
