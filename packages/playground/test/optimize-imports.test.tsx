import { CommandRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { CodeEditor, EditorDocument, historyNamesIn } from '@cerebro-ide/ui-editor';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupOptimizeImports, type AskOrganize } from '../src/optimize-imports.js';

const commands = new CommandRegistry();
let organize: AskOrganize = () => Promise.resolve([]);
const asked: string[] = [];
beforeAll(() => {
  setupOptimizeImports(commands, (path) => {
    asked.push(path);
    return organize(path);
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  asked.length = 0;
});

/** A code editor on the page with the focus, editing `text` unless `readOnly`; its content. */
function focusEditor(text: string, readOnly = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const doc = new EditorDocument(text);
  const handle = render(
    () =>
      readOnly ? (
        <CodeEditor path="/r/a.ts" text={text} />
      ) : (
        <CodeEditor path="/r/a.ts" document={doc} />
      ),
    container,
  );
  cleanups.push(() => {
    handle.dispose();
    container.remove();
  });
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  const content = root.querySelector('.cm-content') as HTMLElement;
  content.focus();
  const hint = () => root.querySelector('.cerebro-hint')?.textContent;
  return { doc, content, hint };
}

describe('Optimize Imports', () => {
  it('needs an editor that can be edited, with the focus', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(commands.isEnabled('code.optimizeImports')).toBe(false);
    input.remove();
    focusEditor('x', true);
    expect(commands.isEnabled('code.optimizeImports')).toBe(false);
    focusEditor('x');
    expect(commands.isEnabled('code.optimizeImports')).toBe(true);
  });

  it('makes the edits asked for, as one change undo names; says so, as IntelliJ', async () => {
    const { doc, content, hint } = focusEditor("import { z, a } from './a';\nimport b from 'b';\n");
    organize = () =>
      Promise.resolve([
        {
          from: { line: 0, column: 0 },
          to: { line: 1, column: 0 },
          text: "import { a, z } from './a';\n",
        },
        { from: { line: 1, column: 0 }, to: { line: 2, column: 0 }, text: '' },
      ]);
    commands.execute('code.optimizeImports');
    await vi.waitFor(() => {
      expect(doc.content()).toBe("import { a, z } from './a';\n");
    });
    expect(asked).toEqual(['/r/a.ts']);
    expect(historyNamesIn(content)?.undo).toBe('Optimize Imports');
    await vi.waitFor(() => {
      expect(hint()).toBe('Imports optimized');
    });
  });

  it('says when there’s nothing to do, and why it can’t be done', async () => {
    const { hint } = focusEditor("import { a } from './a';\n");
    organize = () =>
      Promise.resolve([
        {
          from: { line: 0, column: 0 },
          to: { line: 1, column: 0 },
          text: "import { a } from './a';\n",
        },
      ]);
    commands.execute('code.optimizeImports');
    await vi.waitFor(() => {
      expect(hint()).toBe('No unused imports found');
    });
    organize = () => Promise.resolve({ refused: 'No language server answered.' });
    commands.execute('code.optimizeImports');
    await vi.waitFor(() => {
      expect(hint()).toBe('No language server answered.');
    });
  });
});
