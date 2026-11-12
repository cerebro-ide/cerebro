import { CommandRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { CodeEditor, EditorDocument } from '@cerebro-ide/ui-editor';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { setupEdit, type EditAction } from '../src/edit.js';

const commands = new CommandRegistry();
beforeAll(() => {
  setupEdit(commands);
});

const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  delete window.cerebro;
  vi.restoreAllMocks();
  await userEvent.cleanup();
});

/** Puts an element on the page, until the test ends. */
function add<E extends Element>(element: E, parent: Element = document.body): E {
  parent.append(element);
  cleanups.push(() => {
    element.remove();
  });
  return element;
}

function field(type = 'text'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  return add(input);
}

/** A code editor on the page, and its content, where it's typed. */
function editor(text: string): HTMLElement {
  const container = add(document.createElement('div'));
  const handle = render(
    () => <CodeEditor path="/a.ts" document={new EditorDocument(text)} />,
    container,
  );
  cleanups.push(() => {
    handle.dispose();
  });
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  return root.querySelector('.cm-content') as HTMLElement;
}

/** The app's menu bridge, with what it was asked to do. */
function app(): EditAction[] {
  const asked: EditAction[] = [];
  window.cerebro = {
    menu: {
      edit: (action: EditAction) => asked.push(action),
    },
  } as unknown as NonNullable<Window['cerebro']>;
  return asked;
}

const enabled = (action: EditAction) => commands.isEnabled(`edit.${action}`);
const text = (action: EditAction) => commands.get(`edit.${action}`)?.text?.(undefined);

describe('Edit → Cut, Copy and Paste', () => {
  it('act through the app on the field that has the focus', async () => {
    const asked = app();
    await userEvent.click(field());
    for (const action of ['cut', 'copy', 'paste'] as const) {
      expect(enabled(action)).toBe(true);
      expect(commands.execute(`edit.${action}`)).toBe(true);
    }
    expect(asked).toEqual(['cut', 'copy', 'paste']);
  });

  it('act on the field that had the focus before a menu took it', async () => {
    const asked = app();
    const input = field();
    await userEvent.click(input);
    const menu = add(document.createElement('div'));
    menu.className = 'cerebro-menu-layer';
    const item = add(document.createElement('button'), menu);
    item.focus();
    expect(enabled('paste')).toBe(true);
    commands.execute('edit.paste');
    expect(asked).toEqual(['paste']);
    expect(document.activeElement).toBe(input);
  });

  it('use the browser’s own commands without the app', async () => {
    const exec = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    await userEvent.click(field());
    commands.execute('edit.copy');
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('need somewhere to type: not a read-only, disabled or non-text field', async () => {
    const readOnly = field();
    readOnly.readOnly = true;
    await userEvent.click(readOnly);
    expect([enabled('cut'), enabled('paste')]).toEqual([false, false]);
    const box = field('checkbox');
    await userEvent.click(box);
    expect(enabled('paste')).toBe(false);
    const area = add(document.createElement('textarea'));
    await userEvent.click(area);
    expect(enabled('paste')).toBe(true);
    area.disabled = true;
    expect(enabled('paste')).toBe(false);
    area.remove();
    expect(enabled('paste')).toBe(false);
    const editable = add(document.createElement('div'));
    editable.contentEditable = 'true';
    await userEvent.click(editable);
    expect(enabled('paste')).toBe(true);
    // Not an HTML element: an SVG's, which takes the focus but no typing.
    const svg = add(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    link.setAttribute('tabindex', '0');
    svg.append(link);
    link.focus();
    window.dispatchEvent(new KeyboardEvent('keydown'));
    expect(enabled('paste')).toBe(false);
  });

  it('copy a selection anywhere, but don’t cut from a terminal', async () => {
    const paragraph = add(document.createElement('p'));
    paragraph.textContent = 'some words';
    // Text the app lets be selected, as its base styles say.
    paragraph.className = 'cerebro-selectable';
    await userEvent.click(paragraph);
    expect(enabled('copy')).toBe(false);
    document.getSelection()?.selectAllChildren(paragraph);
    expect(enabled('copy')).toBe(true);
    document.getSelection()?.removeAllRanges();

    const terminal = add(document.createElement('div'));
    terminal.className = 'cerebro-terminal';
    const typed = add(document.createElement('textarea'), terminal);
    await userEvent.click(typed);
    expect([enabled('cut'), enabled('paste'), enabled('copy')]).toEqual([false, true, true]);
  });
});

describe('Edit → Duplicate Line or Selection', () => {
  const on = () => commands.isEnabled('edit.duplicate');

  it('duplicates in the code editor that had the focus, and nowhere else', async () => {
    const content = editor('one\ntwo');
    await userEvent.click(content);
    await userEvent.keyboard('{Control>}{Home}{/Control}');
    expect(on()).toBe(true);
    commands.execute('edit.duplicate');
    expect([...content.querySelectorAll('.cm-line')].map((line) => line.textContent)).toEqual([
      'one',
      'one',
      'two',
    ]);
    // Not in a text field, or a read-only editor.
    await userEvent.click(field());
    expect(on()).toBe(false);
    const container = add(document.createElement('div'));
    const handle = render(() => <CodeEditor path="/b.ts" text="b" />, container);
    cleanups.push(() => {
      handle.dispose();
    });
    const shadow = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    await userEvent.click(shadow.querySelector('.cm-content') as HTMLElement);
    expect(on()).toBe(false);
  });

  it('does nothing once the editor has gone', async () => {
    const content = editor('one');
    await userEvent.click(content);
    for (const cleanup of cleanups.splice(0)) cleanup();
    expect(on()).toBe(false);
    commands.get('edit.duplicate')?.run(undefined);
  });
});

describe('Edit → Undo and Redo', () => {
  it('say what they’d do in a code editor, and do it there', async () => {
    const content = editor('one');
    await userEvent.click(content);
    expect([enabled('undo'), text('undo')]).toEqual([false, '&Undo']);
    await userEvent.keyboard('{End} two');
    expect([enabled('undo'), text('undo')]).toEqual([true, '&Undo Typing']);
    expect(enabled('redo')).toBe(false);
    commands.execute('edit.undo');
    expect(content.textContent).toBe('one');
    expect([enabled('redo'), text('redo')]).toEqual([true, '&Redo Typing']);
    commands.execute('edit.redo');
    expect(content.textContent).toBe('one two');
  });

  it('aren’t a closed editor’s', async () => {
    const asked = app();
    const content = editor('one');
    await userEvent.click(content);
    await userEvent.keyboard('{End} two');
    // Its tab closed: the editor's gone from the page.
    for (const cleanup of cleanups.splice(0)) cleanup();
    expect([enabled('undo'), text('undo')]).toEqual([false, '&Undo']);
    commands.get('edit.undo')?.run(undefined);
    expect(asked).toEqual(['undo']);
  });

  it('go to the system elsewhere, where there’s somewhere to type', async () => {
    const asked = app();
    await userEvent.click(field());
    expect([enabled('undo'), text('undo')]).toEqual([true, '&Undo']);
    commands.execute('edit.undo');
    commands.execute('edit.redo');
    expect(asked).toEqual(['undo', 'redo']);
  });

  it('follow the focus to an editor before a key or a press, and not to the page', async () => {
    const content = editor('one');
    await userEvent.click(content);
    await userEvent.keyboard('{End} two');
    await userEvent.click(field());
    expect(text('undo')).toBe('&Undo');
    content.focus();
    window.dispatchEvent(new KeyboardEvent('keydown'));
    expect(text('undo')).toBe('&Undo Typing');
    // The page itself never counts as what's edited: the editor still does.
    content.blur();
    window.dispatchEvent(new PointerEvent('pointerdown'));
    expect(text('undo')).toBe('&Undo Typing');
  });
});

describe('Edit, with nothing to act on', () => {
  it('goes to the system when what had the focus has gone', async () => {
    const asked = app();
    const input = field();
    await userEvent.click(input);
    input.remove();
    commands.get('edit.copy')?.run(undefined);
    expect(asked).toEqual(['copy']);
  });

  it('copies nothing without a selection, or a page without one', async () => {
    await userEvent.click(document.body);
    vi.spyOn(document, 'getSelection').mockReturnValue(null);
    expect(enabled('copy')).toBe(false);
  });

  it('keeps what had the focus while nothing has it', async () => {
    await userEvent.click(field());
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    expect(enabled('paste')).toBe(true);
  });
});
