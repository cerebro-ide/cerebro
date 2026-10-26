import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalView, type TerminalBackend, type TerminalOptions } from '../src/index.js';

/** A pretend host: records what the view asks, and sends output and exits when the test says. */
function fakeBackend(opened: { buffer?: string; exitCode?: number } = {}) {
  const data = new Set<(id: number, data: string) => void>();
  const exits = new Set<(id: number, exitCode: number) => void>();
  let next = 1;
  const backend = {
    open: vi.fn((): Promise<{ id: number; buffer: string; exitCode?: number }> =>
      Promise.resolve({ id: next++, buffer: '', ...opened }),
    ),
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    onData: (listener: (id: number, data: string) => void) => {
      data.add(listener);
      return () => data.delete(listener);
    },
    onExit: (listener: (id: number, exitCode: number) => void) => {
      exits.add(listener);
      return () => exits.delete(listener);
    },
  } satisfies TerminalBackend;
  return {
    backend,
    output: (id: number, text: string) => {
      for (const listener of data) listener(id, text);
    },
    exit: (id: number, code: number) => {
      for (const listener of exits) listener(id, code);
    },
    listeners: () => data.size + exits.size,
    /** Everything written to the process, joined. */
    written: () => backend.write.mock.calls.map((call) => call[1] as string).join(''),
  };
}

let views: TerminalView[] = [];

afterEach(() => {
  for (const view of views) {
    view.dispose();
    view.element.remove();
  }
  views = [];
});

function mount(backend: TerminalBackend, options: Partial<TerminalOptions> = {}) {
  const view = new TerminalView(backend, { key: 'k', cwd: '/w', ...options });
  view.element.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 300px;';
  document.body.append(view.element);
  views.push(view);
  return view;
}

/** Mounts a view and waits for its process to start. */
async function started(options: Partial<TerminalOptions> = {}, opened = {}) {
  const host = fakeBackend(opened);
  const view = mount(host.backend, options);
  await vi.waitFor(() => {
    expect(host.backend.open).toHaveBeenCalled();
  });
  await Promise.resolve();
  return { host, view };
}

/** Leaves the view out of the clean-up: the test closed it. */
function forget(view: TerminalView) {
  views = views.filter((v) => v !== view);
  view.element.remove();
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const part = (view: TerminalView, selector: string) =>
  view.element.querySelector(selector) as HTMLElement;
const input = (view: TerminalView) => part(view, '.cerebro-terminal__input') as HTMLTextAreaElement;
const viewport = (view: TerminalView) => part(view, '.cerebro-terminal__viewport');

/** The text drawn on the page, a line per row in view. */
const drawnRows = (view: TerminalView) =>
  [...view.element.querySelectorAll<HTMLElement>('.cerebro-terminal__row')]
    .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
    .map((row) => row.textContent.trimEnd());

/** Waits until the page shows `text`. */
const shows = (view: TerminalView, text: string, timeout = 1000) =>
  vi.waitFor(
    () => {
      expect(drawnRows(view).join('\n')).toContain(text);
    },
    { timeout },
  );

/** The middle of a cell of the buffer, in the window. */
function cellAt(view: TerminalView, line: number, col: number) {
  const rect = part(view, '.cerebro-terminal__lines').getBoundingClientRect();
  const width = part(view, '.cerebro-terminal__measure').getBoundingClientRect().width / 100;
  return { clientX: rect.left + (col + 0.5) * width, clientY: rect.top + (line + 0.5) * 16 };
}

type At = { clientX: number; clientY: number };

function pointer(target: EventTarget, type: string, at: At, extra: PointerEventInit = {}) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...at, ...extra }),
  );
}

/** Presses the main button at one cell and lets go at another. */
function drag(view: TerminalView, from: At, to: At, extra: PointerEventInit = {}) {
  pointer(viewport(view), 'pointerdown', from, extra);
  pointer(window, 'pointermove', to, { buttons: 1, ...extra });
  pointer(window, 'pointerup', to, extra);
}

describe('starting and drawing', () => {
  it('starts the process once it has a size, as big as the element, and draws its output', async () => {
    const { host, view } = await started({ command: 'claude', args: ['--continue'], fontSize: 12 });
    const options = host.backend.open.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(options[0]).toMatchObject({
      key: 'k',
      cwd: '/w',
      command: 'claude',
      args: ['--continue'],
    });
    expect(options[0]['cols']).toBeGreaterThan(40);
    expect(options[0]['rows']).toBeGreaterThan(10);
    host.output(1, 'hello \x1b[31mred\x1b[0m');
    host.output(2, 'another terminal’s');
    await shows(view, 'hello red');
    expect(view.text()).toBe('hello red');
  });

  it('runs the shell when no command is given, and waits for a size and the font', async () => {
    const load = vi.spyOn(document.fonts, 'load').mockRejectedValueOnce(new Error('no font'));
    const host = fakeBackend();
    const view = mount(host.backend);
    view.element.style.display = 'none';
    // Clicked before it's measured: only focused.
    pointer(viewport(view), 'pointerdown', { clientX: 0, clientY: 0 });
    viewport(view).dispatchEvent(new Event('scroll'));
    await settle();
    expect(host.backend.open).not.toHaveBeenCalled();
    view.element.style.display = '';
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalled();
    });
    expect(load).toHaveBeenCalled();
    load.mockRestore();
    expect(host.backend.open.mock.calls[0]).not.toHaveProperty('0.command');
    expect(host.backend.open.mock.calls[0]).not.toHaveProperty('0.args');
    expect(host.backend.open.mock.calls[0]).not.toHaveProperty('0.agent');
  });

  it('shows the running process’s recent output, and follows the element’s size', async () => {
    const { host, view } = await started({}, { buffer: 'earlier output' });
    await shows(view, 'earlier output');
    view.element.style.width = '300px';
    await vi.waitFor(() => {
      expect(host.backend.resize).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Number));
    });
    // Taller only: rows change, columns don't.
    const [, cols] = host.backend.resize.mock.lastCall as [number, number, number];
    view.element.style.height = '400px';
    await vi.waitFor(() => {
      expect(host.backend.resize.mock.lastCall).toEqual([1, cols, expect.any(Number)]);
      expect(host.backend.resize).toHaveBeenCalledTimes(2);
    });
    // A pixel more fits no more cells.
    view.element.style.height = '401px';
    await settle();
    expect(host.backend.resize).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest output in view until scrolled up, drawing only the lines in view', async () => {
    const { host, view } = await started();
    host.output(1, Array.from({ length: 60 }, (_, i) => `line ${String(i)}`).join('\r\n'));
    await shows(view, 'line 59');
    expect(drawnRows(view)).not.toContain('line 0');
    viewport(view).scrollTop = 0;
    await shows(view, 'line 0');
    expect(drawnRows(view)).not.toContain('line 59');
    host.output(1, '\r\nline 60');
    await vi.waitFor(() => {
      expect(view.text()).toContain('line 60');
    });
    await settle();
    expect(drawnRows(view)).toContain('line 0');
  });

  it('draws nothing while the program updates the screen in one go, for at most a second', async () => {
    const { host, view } = await started();
    host.output(1, 'before');
    await shows(view, 'before');
    host.output(1, '\x1b[?2026h\r\nduring');
    await settle();
    expect(drawnRows(view).join()).not.toContain('during');
    host.output(1, '\x1b[?2026l');
    await shows(view, 'during');
    host.output(1, '\x1b[?2026h\r\nstuck');
    await shows(view, 'stuck', 3000);
  });

  it('draws the cursor: a block with its character while focused, an outline else; or hidden', async () => {
    const { host, view } = await started();
    host.output(1, 'ab\x1b[1D');
    const cursor = part(view, '.cerebro-terminal__cursor');
    await vi.waitFor(() => {
      expect(cursor.style.left).toBe('1ch');
    });
    expect(cursor.hidden).toBe(false);
    expect(cursor.textContent).toBe('');
    view.focus();
    await vi.waitFor(() => {
      expect(cursor.textContent).toBe('b');
    });
    expect(cursor.classList).toContain('cerebro-terminal__cursor--focused');
    host.output(1, '\x1b[?25l');
    await vi.waitFor(() => {
      expect(cursor.hidden).toBe(true);
    });
    host.output(1, '\x1b[?25h');
    await vi.waitFor(() => {
      expect(cursor.hidden).toBe(false);
    });
  });
});

describe('typing', () => {
  it('sends text and keys, including what was typed before the process started', async () => {
    const host = fakeBackend();
    let resolve: (value: { id: number; buffer: string }) => void = () => undefined;
    host.backend.open.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = mount(host.backend);
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalled();
    });
    view.focus();
    await userEvent.keyboard('ls');
    expect(host.backend.write).not.toHaveBeenCalled();
    resolve({ id: 7, buffer: '' });
    await vi.waitFor(() => {
      expect(host.backend.write).toHaveBeenCalledWith(7, 'ls');
    });
    await userEvent.keyboard('{Enter}{ArrowUp}{Control>}c{/Control}');
    expect(host.written()).toBe('ls\r\x1b[A\x03');
  });

  it('sends the arrows as the program’s cursor mode asks', async () => {
    const { host, view } = await started();
    host.output(1, '\x1b[?1h');
    await settle();
    view.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(host.written()).toBe('\x1bOB');
  });

  it('lets the app’s shortcuts and unknown Ctrl keys through, and keeps the rest', async () => {
    const passKey = vi.fn((event: KeyboardEvent) => event.altKey && event.key === '1');
    const { host, view } = await started({ passKey });
    // The app's keymap: it takes what reaches it.
    const app = vi.fn((event: KeyboardEvent) => {
      event.preventDefault();
    });
    window.addEventListener('keydown', app);
    view.focus();
    await userEvent.keyboard('{Alt>}1{/Alt}{Control>}.{/Control}x{Control>}d{/Control}');
    window.removeEventListener('keydown', app);
    expect(app.mock.calls.map((call) => call[0].key)).toEqual(['1', 'Control', '.', 'Control']);
    expect(host.written()).toBe('x\x04');
  });

  it('sends what an input method composes, once it’s done, and ignores keys meanwhile', async () => {
    const { host, view } = await started();
    const field = input(view);
    field.value = 'にほ';
    field.dispatchEvent(new InputEvent('input', { isComposing: true }));
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
    field.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
    field.dispatchEvent(new CompositionEvent('compositionend', { data: '日本' }));
    field.dispatchEvent(new InputEvent('input'));
    expect(host.written()).toBe('日本');
  });

  it('pastes, bracketed when the program asks, with line ends as Enter', async () => {
    const { host, view } = await started();
    const paste = (text?: string) => {
      const event = new ClipboardEvent('paste', { cancelable: true });
      if (text !== undefined) {
        Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
      }
      input(view).dispatchEvent(event);
      return event;
    };
    expect(paste('a\nb').defaultPrevented).toBe(true);
    paste();
    paste('');
    expect(host.written()).toBe('a\rb');
    host.output(1, '\x1b[?2004h');
    await settle();
    paste('c\r\nd');
    expect(host.written()).toBe('a\rb\x1b[200~c\rd\x1b[201~');
  });

  it('leaves Ctrl+V to the text field’s paste', async () => {
    const { view } = await started();
    const app = vi.fn();
    window.addEventListener('keydown', app);
    view.focus();
    await userEvent.keyboard('{Control>}v{/Control}');
    window.removeEventListener('keydown', app);
    expect(app.mock.calls.map((call) => (call[0] as KeyboardEvent).key)).toEqual(['Control']);
  });

  it('sends the terminal’s answers to the program’s questions', async () => {
    const { host } = await started();
    host.output(1, 'ab\x1b[6n');
    await vi.waitFor(() => {
      expect(host.written()).toBe('\x1b[1;3R');
    });
  });

  it('reports focus to a program that asks', async () => {
    const { host, view } = await started();
    host.output(1, '\x1b[?1004h');
    await settle();
    view.focus();
    input(view).blur();
    expect(host.written()).toBe('\x1b[I\x1b[O');
  });
});

describe('selecting and copying', () => {
  async function withText() {
    const copy = vi.fn();
    const { host, view } = await started({ copy });
    host.output(1, 'hello world\r\nsecond line');
    await shows(view, 'second line');
    return { host, view, copy };
  }

  it('selects by dragging, either way, and copies with Ctrl+Shift+C, or Ctrl+C', async () => {
    const { host, view, copy } = await withText();
    drag(view, cellAt(view, 1, 2), cellAt(view, 0, 6));
    expect(view.selectedText()).toBe('world\nsec');
    await vi.waitFor(() => {
      expect(view.element.querySelector('.cerebro-terminal__selected')).not.toBeNull();
    });
    view.focus();
    await userEvent.keyboard('{Control>}{Shift>}C{/Shift}{/Control}');
    expect(copy).toHaveBeenLastCalledWith('world\nsec');
    expect(view.selectedText()).toBe('');
    // Ctrl+C copies while there's a selection, else it's for the program.
    drag(view, cellAt(view, 0, 0), cellAt(view, 0, 4));
    await userEvent.keyboard('{Control>}c{/Control}');
    expect(copy).toHaveBeenLastCalledWith('hello');
    await userEvent.keyboard('{Control>}c{/Control}');
    expect(host.written()).toBe('\x03');
    // Ctrl+Shift+C with nothing selected copies nothing.
    await userEvent.keyboard('{Control>}{Shift>}C{/Shift}{/Control}');
    expect(copy).toHaveBeenCalledTimes(2);
    expect(host.written()).toBe('\x03');
  });

  it('copies with Cmd+C on macOS', async () => {
    const copy = vi.fn();
    const { host, view } = await started({ copy, mac: true });
    host.output(1, 'abc');
    await shows(view, 'abc');
    drag(view, cellAt(view, 0, 0), cellAt(view, 0, 1));
    view.focus();
    await userEvent.keyboard('{Meta>}c{/Meta}');
    expect(copy).toHaveBeenCalledWith('ab');
  });

  it('copies to the system clipboard by default, and survives a refusal', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('no'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { host, view } = await started();
    host.output(1, 'abc');
    await shows(view, 'abc');
    drag(view, cellAt(view, 0, 0), cellAt(view, 0, 2));
    view.focus();
    await userEvent.keyboard('{Control>}{Shift>}C{/Shift}{/Control}');
    expect(write).toHaveBeenCalledWith('abc');
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    write.mockRestore();
    warn.mockRestore();
  });

  it('clears on a click without a drag, and when typing', async () => {
    const { view } = await withText();
    drag(view, cellAt(view, 0, 1), cellAt(view, 0, 1));
    expect(view.selectedText()).toBe('');
    drag(view, cellAt(view, 0, 1), cellAt(view, 0, 3));
    expect(view.selectedText()).toBe('ell');
    // Typing while dragging ends the selection.
    pointer(viewport(view), 'pointerdown', cellAt(view, 0, 1));
    input(view).value = 'a';
    input(view).dispatchEvent(new InputEvent('input'));
    pointer(window, 'pointermove', cellAt(view, 0, 3), { buttons: 1 });
    pointer(window, 'pointerup', cellAt(view, 0, 3));
    expect(view.selectedText()).toBe('');
    drag(view, cellAt(view, 0, 1), cellAt(view, 0, 3));
    view.focus();
    await userEvent.keyboard('x');
    expect(view.selectedText()).toBe('');
  });

  it('selects a word on a double click, and nothing on a space', async () => {
    const { view } = await withText();
    pointer(viewport(view), 'pointerdown', cellAt(view, 0, 8), { detail: 2 });
    expect(view.selectedText()).toBe('world');
    pointer(viewport(view), 'pointerdown', cellAt(view, 0, 0), { detail: 2 });
    expect(view.selectedText()).toBe('hello');
    pointer(viewport(view), 'pointerdown', cellAt(view, 1, 30), { detail: 2 });
    expect(view.selectedText()).toBe('hello');
  });

  it('joins wrapped lines without a line break', async () => {
    const { host, view } = await started();
    const cols = (host.backend.open.mock.calls[0] as unknown as [{ cols: number }])[0].cols;
    host.output(1, `${'x'.repeat(cols)}yz`);
    await shows(view, 'yz');
    drag(view, cellAt(view, 0, cols - 2), cellAt(view, 1, 1));
    expect(view.selectedText()).toBe('xxyz');
  });

  it('only selects with the main button', async () => {
    const { view } = await withText();
    drag(view, cellAt(view, 0, 1), cellAt(view, 0, 3), { button: 2 });
    expect(view.selectedText()).toBe('');
  });
});

describe('the mouse', () => {
  it('reports presses, drags and releases to a program that asks, in SGR', async () => {
    const { host, view } = await started();
    host.output(1, '\x1b[?1002h\x1b[?1006h');
    await settle();
    drag(view, cellAt(view, 2, 4), cellAt(view, 2, 5));
    const reports = '\x1b[<0;5;3M\x1b[<32;6;3M\x1b[<0;6;3m';
    expect(host.written()).toBe(reports);
    expect(view.selectedText()).toBe('');
    // With Shift, it selects instead.
    drag(view, cellAt(view, 0, 0), cellAt(view, 0, 1), { shiftKey: true });
    expect(host.written()).toBe(reports);
    const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    viewport(view).dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('reports moves without a button in any-motion mode, in the original encoding', async () => {
    const { host, view } = await started();
    host.output(1, '\x1b[?1003h');
    await settle();
    pointer(viewport(view), 'pointermove', cellAt(view, 0, 0), { buttons: 0 });
    pointer(viewport(view), 'pointermove', cellAt(view, 0, 0), { buttons: 1 });
    expect(host.written()).toBe(`\x1b[M${String.fromCharCode(32 + 35, 33, 33)}`);
  });

  it('reports nothing in the scrollback, nor what the mode doesn’t report', async () => {
    const { host, view } = await started();
    host.output(1, `${'\r\n'.repeat(40)}\x1b[?9h`);
    await vi.waitFor(() => {
      expect(viewport(view).scrollTop).toBeGreaterThan(0);
    });
    viewport(view).scrollTop = 0;
    await settle();
    drag(view, cellAt(view, 0, 0), cellAt(view, 0, 0));
    expect(host.written()).toBe('');
  });

  it('leaves the context menu alone without tracking', async () => {
    const { view } = await started();
    const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    viewport(view).dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });
});

describe('the wheel', () => {
  const wheel = (view: TerminalView, deltaY: number) => {
    const event = new WheelEvent('wheel', {
      deltaY,
      cancelable: true,
      bubbles: true,
      ...cellAt(view, 0, 0),
    });
    viewport(view).dispatchEvent(event);
    return event;
  };

  it('reports to a program tracking the mouse', async () => {
    const { host, view } = await started();
    host.output(1, '\x1b[?1000h\x1b[?1006h');
    await settle();
    expect(wheel(view, -10).defaultPrevented).toBe(true);
    wheel(view, 10);
    wheel(view, 0);
    expect(host.written()).toBe('\x1b[<64;1;1M\x1b[<65;1;1M');
  });

  it('sends arrows to a full-screen program that doesn’t track it, and scrolls otherwise', async () => {
    const { host, view } = await started();
    expect(wheel(view, 10).defaultPrevented).toBe(false);
    host.output(1, '\x1b[?1049h');
    await settle();
    expect(wheel(view, -10).defaultPrevented).toBe(true);
    host.output(1, '\x1b[?1h');
    await settle();
    wheel(view, 10);
    expect(host.written()).toBe('\x1b[A\x1b[A\x1b[A\x1bOB\x1bOB\x1bOB');
  });
});

describe('ending', () => {
  it('says when the process ends, and starts it again on Enter', async () => {
    const { host, view } = await started();
    host.output(1, '\x1b[?1006h');
    host.exit(2, 1);
    host.exit(1, 3);
    await shows(view, 'Process ended with code 3');
    expect(part(view, '.cerebro-terminal__cursor').hidden).toBe(true);
    view.focus();
    await userEvent.keyboard('x');
    expect(host.backend.write).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(host.backend.close).toHaveBeenCalledWith(1);
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalledTimes(2);
    });
    await Promise.resolve();
    await userEvent.keyboard('y');
    expect(host.backend.write).toHaveBeenCalledWith(2, 'y');
    // Resizing an ended process's view tells the host nothing.
    host.exit(2, 0);
    host.backend.resize.mockClear();
    view.element.style.width = '400px';
    await settle();
    expect(host.backend.resize).not.toHaveBeenCalled();
  });

  it('says why the host couldn’t start it, and tries again on Enter', async () => {
    const host = fakeBackend();
    host.backend.open
      .mockRejectedValueOnce(new Error('posix_spawnp failed'))
      .mockRejectedValueOnce('no reason');
    const view = mount(host.backend);
    await shows(view, 'Couldn’t start: posix_spawnp failed');
    view.focus();
    await userEvent.keyboard('x{Enter}');
    await shows(view, 'Couldn’t start: no reason');
    // A resize doesn't try again; Enter does.
    view.element.style.width = '400px';
    await settle();
    expect(host.backend.open).toHaveBeenCalledTimes(2);
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalledTimes(3);
    });
    await Promise.resolve();
    await userEvent.keyboard('y');
    expect(host.written()).toBe('y');
    expect(host.backend.close).not.toHaveBeenCalled();
  });

  it('runs an agent, its arguments read at each start, and says when it ends', async () => {
    const onExit = vi.fn();
    let run = 0;
    const { host, view } = await started({
      command: 'claude',
      args: () => [`--run=${String(++run)}`],
      agent: true,
      onExit,
    });
    expect(host.backend.open.mock.calls[0]).toMatchObject([
      { command: 'claude', args: ['--run=1'], agent: true },
    ]);
    host.exit(1, 2);
    await shows(view, 'Process ended with code 2');
    expect(onExit).toHaveBeenCalledWith(2);
    view.focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => {
      expect(host.backend.open.mock.calls[1]).toMatchObject([{ args: ['--run=2'] }]);
    });
  });

  it('says so for a process that had already ended', async () => {
    const { view } = await started({}, { buffer: 'done', exitCode: 0 });
    await shows(view, 'Process ended with code 0');
  });

  it('closes the process, unless it ended or never started', async () => {
    const { host, view } = await started();
    view.close();
    forget(view);
    expect(host.backend.close).toHaveBeenCalledWith(1);
    expect(host.listeners()).toBe(0);

    const ended = await started();
    ended.host.exit(1, 0);
    ended.view.close();
    forget(ended.view);
    expect(ended.host.backend.close).not.toHaveBeenCalled();

    const early = fakeBackend();
    const unstarted = mount(early.backend);
    unstarted.close();
    forget(unstarted);
    await settle();
    expect(early.backend.open).not.toHaveBeenCalled();
    expect(early.backend.close).not.toHaveBeenCalled();
  });

  it('stops drawing once disposed, with a frame pending', async () => {
    const { host, view } = await started();
    host.output(1, 'before');
    await shows(view, 'before');
    host.output(1, '\r\nlate');
    view.focus();
    view.dispose();
    forget(view);
    await settle();
    expect(drawnRows(view).join()).not.toContain('late');
  });
});
