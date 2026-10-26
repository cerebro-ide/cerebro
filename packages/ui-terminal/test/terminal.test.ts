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
    open: vi.fn(() => Promise.resolve({ id: next++, buffer: opened.buffer ?? '', ...opened })),
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
  view.element.style.cssText =
    'position: fixed; inset: 0 auto auto 0; width: 600px; height: 300px;';
  document.body.append(view.element);
  views.push(view);
  return view;
}

/** Waits for xterm to draw what it was given. */
const drawn = (view: TerminalView, text: string) =>
  vi.waitFor(() => {
    expect(view.text()).toContain(text);
  });

describe('the terminal view', () => {
  it('starts the process once it has a size, as big as the element, and shows its output', async () => {
    const host = fakeBackend();
    const view = mount(host.backend, { command: 'claude', args: ['--continue'], fontSize: 12 });
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalledTimes(1);
    });
    const options = host.backend.open.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(options[0]).toMatchObject({
      key: 'k',
      cwd: '/w',
      command: 'claude',
      args: ['--continue'],
    });
    expect(options[0]['cols']).toBeGreaterThan(40);
    expect(options[0]['rows']).toBeGreaterThan(10);
    host.output(1, 'hello from the host');
    host.output(2, 'another terminal’s');
    await drawn(view, 'hello from the host');
    expect(view.text()).not.toContain('another');
  });

  it('runs the shell when no command is given, and waits for a size', async () => {
    const host = fakeBackend();
    const view = mount(host.backend);
    view.element.style.display = 'none';
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.backend.open).not.toHaveBeenCalled();
    view.element.style.display = '';
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalled();
    });
    expect(host.backend.open.mock.calls[0]).not.toHaveProperty('0.command');
    expect(host.backend.open.mock.calls[0]).not.toHaveProperty('0.args');
  });

  it('sends what is typed, including what was typed before the process started', async () => {
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
    await userEvent.keyboard('{Enter}');
    expect(host.backend.write).toHaveBeenLastCalledWith(7, '\r');
  });

  it('shows the running process’s recent output, and follows the element’s size', async () => {
    const host = fakeBackend({ buffer: 'earlier output' });
    const view = mount(host.backend);
    await drawn(view, 'earlier output');
    view.element.style.width = '300px';
    await vi.waitFor(() => {
      expect(host.backend.resize).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Number));
    });
  });

  it('says when the process ends, and starts it again on Enter', async () => {
    const host = fakeBackend();
    const view = mount(host.backend);
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalled();
    });
    host.exit(2, 1);
    host.exit(1, 3);
    await drawn(view, 'Process ended with code 3');
    view.focus();
    await userEvent.keyboard('x');
    expect(host.backend.write).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(host.backend.close).toHaveBeenCalledWith(1);
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalledTimes(2);
    });
    await userEvent.keyboard('y');
    expect(host.backend.write).toHaveBeenCalledWith(2, 'y');
  });

  it('says so for a process that had already ended', async () => {
    const host = fakeBackend({ buffer: 'done', exitCode: 0 });
    const view = mount(host.backend);
    await drawn(view, 'Process ended with code 0');
  });

  it('closes the process, unless it ended; disposing leaves it running', async () => {
    const host = fakeBackend();
    const view = mount(host.backend);
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalled();
    });
    view.close();
    expect(host.backend.close).toHaveBeenCalledWith(1);
    expect(host.listeners()).toBe(0);
    views = [];

    const other = fakeBackend();
    const ended = mount(other.backend);
    await vi.waitFor(() => {
      expect(other.backend.open).toHaveBeenCalled();
    });
    other.exit(1, 0);
    ended.close();
    // Closed before it started: nothing to close in the host.
    mount(fakeBackend().backend).close();
    expect(other.backend.close).not.toHaveBeenCalled();
    views = [];
  });

  it('takes its colours from the theme, and draws without WebGL if it must', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = fakeBackend();
    const view = mount(host.backend, {
      webgl: () => {
        throw new Error('no WebGL');
      },
    });
    await vi.waitFor(() => {
      expect(host.backend.open).toHaveBeenCalled();
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    document.documentElement.dataset['cerebroTheme'] = 'light';
    view.refreshTheme();
    delete document.documentElement.dataset['cerebroTheme'];
    host.output(1, 'still drawn');
    await drawn(view, 'still drawn');
  });
});
