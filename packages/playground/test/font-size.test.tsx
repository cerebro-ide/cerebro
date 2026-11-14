import { CommandRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { CodeEditor, EditorDocument } from '@cerebro-ide/ui-editor';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupFontSize } from '../src/font-size.js';
import { globalSettings } from '../src/settings.js';

const commands = new CommandRegistry();
beforeAll(() => {
  setupFontSize(commands);
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  globalSettings.layers.global.reset('editor.fontSize');
});

/** A code editor on the page with the focus, until the test ends. */
function focusEditor(): void {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = render(
    () => <CodeEditor path="/a.ts" document={new EditorDocument('a')} />,
    container,
  );
  cleanups.push(() => {
    handle.dispose();
    container.remove();
  });
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  (root.querySelector('.cm-content') as HTMLElement).focus();
}

const size = () => globalSettings.get('editor.fontSize');
const saved = () =>
  (
    JSON.parse(localStorage.getItem('cerebro.settings.global.user') ?? '{}') as Record<
      string,
      unknown
    >
  )['editor.fontSize'];

describe('Increase and Decrease Font Size in All Editors', () => {
  it('need an editor with the focus', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(commands.isEnabled('editor.increaseFontSize')).toBe(false);
    expect(commands.isEnabled('editor.decreaseFontSize')).toBe(false);
    input.remove();
    focusEditor();
    expect(commands.isEnabled('editor.increaseFontSize')).toBe(true);
    expect(commands.isEnabled('editor.decreaseFontSize')).toBe(true);
  });

  it('make the editors’ font a point larger or smaller, saved as the global setting', () => {
    focusEditor();
    expect(size()).toBe(13);
    commands.execute('editor.increaseFontSize');
    expect([size(), saved()]).toEqual([14, 14]);
    commands.execute('editor.decreaseFontSize');
    commands.execute('editor.decreaseFontSize');
    expect([size(), saved()]).toEqual([12, 12]);
  });

  it('go no smaller than 8 nor larger than 72, as IntelliJ’s', () => {
    focusEditor();
    globalSettings.layers.global.set('editor.fontSize', 8);
    commands.execute('editor.decreaseFontSize');
    expect(size()).toBe(8);
    globalSettings.layers.global.set('editor.fontSize', 72);
    commands.execute('editor.increaseFontSize');
    expect(size()).toBe(72);
  });
});
