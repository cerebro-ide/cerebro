// Increase and Decrease Font Size in All Editors, as IntelliJ's `EditorIncreaseFontSizeGlobal`
// and `EditorDecreaseFontSizeGlobal` (`ChangeEditorFontSizeAction`, read from its source): the
// editors' font size a point larger or smaller, from 8 to 72, kept as the global setting. Each
// needs an editor with the focus, any of them (a diff's, a read-only one), as IntelliJ's.

import type { CommandRegistry } from '@cerebro-ide/commands';
import { target } from './edit.js';
import { active } from './environments.js';
import { globalSettings, save, settingsFor } from './settings.js';

const SMALLEST = 8;
const LARGEST = 72;

/** Whether an editor has the focus (or had it before a menu took it). */
function inEditor(): boolean {
  return target()?.closest('.cm-editor') != null;
}

/** The font size `step` points from what the editors show, within IntelliJ's bounds. */
function change(step: number): void {
  const size = (settingsFor(active()?.id).get('editor.fontSize') as number) + step;
  if (size < SMALLEST || size > LARGEST) return;
  globalSettings.layers.global.set('editor.fontSize', size);
  save(globalSettings, ['global']);
}

export function setupFontSize(commands: CommandRegistry): void {
  commands.register({
    id: 'editor.increaseFontSize',
    label: 'Increase Font Size in All Editors',
    enabled: inEditor,
    run: () => {
      change(1);
    },
  });
  commands.register({
    id: 'editor.decreaseFontSize',
    label: 'Decrease Font Size in All Editors',
    enabled: inEditor,
    run: () => {
      change(-1);
    },
  });
}
