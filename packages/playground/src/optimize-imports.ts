// Optimize Imports, as IntelliJ's `OptimizeImports` (Ctrl+Alt+O): the focused editor's file's
// imports organized by its language server (the unused gone, the rest in order), as one change
// undo takes back, with IntelliJ's hint at the caret. Through Reformat Code's `formatIn`.

import type { CommandRegistry } from '@cerebro-ide/commands';
import { fileIn, formatIn, type FormatEdit, type FormatWords } from '@cerebro-ide/ui-editor';
import { target } from './edit.js';

/** IntelliJ's words (CodeInsightBundle: `process.optimize.imports`, `hint.text.*`). */
const WORDS: FormatWords = {
  name: 'Optimize Imports',
  formatted: () => 'Imports optimized',
  unchanged: 'No unused imports found',
};

/** Asks for the edits that organize a file's imports, or why it can't be done. */
export type AskOrganize = (path: string) => Promise<readonly FormatEdit[] | { refused: string }>;

export function setupOptimizeImports(commands: CommandRegistry, organize: AskOrganize): void {
  commands.register({
    id: 'code.optimizeImports',
    label: 'Optimize Imports',
    // An editor that can be edited has the focus (or had it before a menu took it).
    enabled: () => {
      const at = target();
      return at !== undefined && fileIn(at) !== undefined;
    },
    run: () => {
      const at = target() as Element;
      formatIn(at, () => organize(fileIn(at) as string), WORDS);
    },
  });
}
