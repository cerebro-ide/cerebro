import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { CodeEditor, EditorDocument } from '@cerebro-ide/ui-editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { setupEdit } from '../src/edit.js';
import { setupEditorActions } from '../src/editor-actions.js';
import { setupRenameFile } from '../src/rename-file.js';

const commands = new CommandRegistry();
const menus = new MenuRegistry();
setupEdit(commands);
setupEditorActions(commands, menus);
setupRenameFile({ commands, menus, keymap: new Keymap('other') }, { editor: () => undefined });

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(
  doc: EditorDocument,
  onGoToDefinition?: () => void,
  renaming?: Parameters<typeof CodeEditor>[0]['renaming'],
) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 300px;';
  document.body.append(container);
  const handle = render(
    () => (
      <CodeEditor
        path="a.ts"
        document={doc}
        {...(onGoToDefinition ? { onGoToDefinition } : {})}
        {...(renaming ? { renaming, onRename: () => Promise.resolve(undefined) } : {})}
      />
    ),
    container,
  );
  const outside = document.createElement('button');
  document.body.append(outside);
  cleanup = () => {
    handle.dispose();
    container.remove();
    outside.remove();
  };
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  return { content: root.querySelector('.cm-content') as HTMLElement, outside };
}

describe('the editor’s actions as commands', () => {
  it('are named as IntelliJ’s, Find and Replace opening something', () => {
    expect(commands.get('editor.goToDefinition')?.label).toBe('Go to Declaration or Usages');
    expect(commands.get('editor.goToImplementation')?.label).toBe('Go to I&mplementation(s)');
    expect(commands.get('editor.find')).toMatchObject({ label: '&Find', dialog: true });
    expect(commands.get('editor.toggleCase')?.dialog).toBe(false);
  });

  it('are in the menus where IntelliJ’s are, the Navigate menu’s named as its', () => {
    const shown = (menu: string) =>
      menus
        .entries(menu)
        .map((entry) =>
          'separator' in entry
            ? '---'
            : 'submenu' in entry
              ? `${entry.label} >`
              : 'command' in entry
                ? (entry.label ?? commands.get(entry.command)?.label)
                : '',
        );
    expect(shown('main/code')).toEqual([
      'Code &Completion >',
      '---',
      'Folding >',
      '---',
      'Comment with &Line Comment',
      'Comment with &Block Comment',
      '&Reformat Code',
      '---',
      'Move Line Do&wn',
      'Move Line &Up',
    ]);
    expect(shown('main/code/completion')).toEqual(['&Basic']);
    expect(shown('main/code/folding')).toEqual([
      'E&xpand',
      '&Expand All',
      '---',
      '&Collapse',
      'Collapse &All',
    ]);
    expect(shown('main/refactor')).toEqual(['&Rename']);
    expect(shown('main/navigate')).toEqual([
      '&Next Highlighted Error',
      '&Previous Highlighted Error',
      '---',
      'N&ext Method',
      'Prev&ious Method',
      '---',
      '&Declaration or Usages',
      'I&mplementation(s)',
      '&Type Declaration',
      'S&uper Method',
    ]);
    expect(shown('main/edit/find')).toEqual(['&Find', '&Replace']);
    expect(shown('main/edit')).toEqual([
      'Extend Selection',
      'Shrink Selection',
      '---',
      'Toggle Case',
      'Join Lines',
    ]);
    expect(shown('main/view')).toEqual(['Quic&k Definition', 'Quick &Documentation']);
    expect(shown('main').slice(-2)).toEqual(['&Code >', '&Refactor >']);
  });

  it('run on the editor with the keyboard, where it has them', async () => {
    const doc = new EditorDocument('const answer = 1;');
    const onGoToDefinition = vi.fn();
    const { content, outside } = mount(doc, onGoToDefinition);
    expect(commands.isEnabled('editor.toggleCase')).toBe(false);
    await userEvent.click(content);
    await userEvent.keyboard('{Home}{Shift>}{ArrowRight}{ArrowRight}{/Shift}');
    expect(commands.isEnabled('editor.toggleCase')).toBe(true);
    // No problems shown there: nothing to go to.
    expect(commands.isEnabled('editor.nextProblem')).toBe(false);
    commands.execute('editor.toggleCase');
    expect(doc.content()).toBe('COnst answer = 1;');
    commands.execute('editor.goToDefinition');
    expect(onGoToDefinition).toHaveBeenCalledTimes(1);
    // Elsewhere: off.
    outside.focus();
    expect(commands.isEnabled('editor.toggleCase')).toBe(false);
    expect(commands.execute('editor.toggleCase')).toBe(false);
  });

  it('rename in the editor with the keyboard, the Project view’s file elsewhere', async () => {
    const renaming = vi.fn(() => Promise.resolve(null));
    const { content, outside } = mount(
      new EditorDocument('const answer = 1;'),
      undefined,
      renaming,
    );
    outside.focus();
    // Neither an editor nor the Project view: off.
    expect(commands.isEnabled('editor.rename')).toBe(false);
    await userEvent.click(content);
    expect(commands.execute('editor.rename')).toBe(true);
    await expect.poll(() => renaming.mock.calls.length).toBe(1);
  });
});
