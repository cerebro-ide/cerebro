import { describe, expect, it, vi } from 'vitest';
import type { Answer } from '../src/ipc.js';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const handlers = new Map<string, Listener>();
  const owners = new Map<
    number,
    { focus: () => void; restore: () => void; close: () => void; isMinimized: () => boolean }
  >();
  return {
    handlers,
    owners,
    ipcMain: {
      handle: (channel: string, handler: Listener) => {
        handlers.set(channel, handler);
      },
    },
    BrowserWindow: {
      // As Electron's: it throws for contents destroyed (measured).
      fromWebContents: (contents: { id: number; isDestroyed: () => boolean }) => {
        if (contents.isDestroyed()) throw new TypeError('Object has been destroyed');
        return owners.get(contents.id) ?? null;
      },
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain, BrowserWindow: electron.BrowserWindow }));

const {
  DIFF_JUMP,
  DIFF_JUMPED,
  DIFF_DOCUMENT,
  DIFF_DOCUMENT_ASKED,
  DIFF_DOCUMENT_SHOWN,
  DIFF_DOCUMENT_TEXT,
  DIFF_TAB,
  DIFF_TABBED,
  DIFF_MOVE,
  DIFF_OPEN,
  DiffWindows,
  diffHash,
  diffSpec,
  installDiffWindows,
  windowOf,
} = await import('../src/diff-windows.js');

/** A window that can be closed, telling its listeners. */
function fake(id: number) {
  const closed: (() => void)[] = [];
  return {
    id,
    send: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(() => {
      for (const listener of closed) listener();
    }),
    onClosed: (listener: () => void) => {
      closed.push(listener);
    },
  };
}

const spec = { project: '/repo', env: '/repo', path: 'a.ts' };

describe('diff windows', () => {
  it('opens a window per diff, sharing its opener’s hosts, and brings it back for the same one', () => {
    const hosts = { share: vi.fn(), unshare: vi.fn() };
    let ids = 10;
    const made: ReturnType<typeof fake>[] = [];
    const create = vi.fn(() => {
      const window = fake(++ids);
      made.push(window);
      return window;
    });
    const windows = new DiffWindows(hosts, create);
    const opener = fake(1);
    windows.show(opener, spec);
    expect(create).toHaveBeenCalledWith(spec);
    expect(hosts.share).toHaveBeenCalledWith(11, 1);
    windows.show(opener, spec);
    expect(create).toHaveBeenCalledTimes(1);
    expect(made[0]?.focus).toHaveBeenCalled();
    // Another file: another window.
    windows.show(opener, { ...spec, path: 'b.ts' });
    expect(create).toHaveBeenCalledTimes(2);
    // Jump to Source goes to the opener, in front.
    windows.jump(11, { path: 'a.ts', line: 3, column: 0 });
    expect(opener.send).toHaveBeenCalledWith(DIFF_JUMPED, { path: 'a.ts', line: 3, column: 0 });
    expect(opener.focus).toHaveBeenCalled();
    // Closed, it shares no more; the opener closed, its diff windows close.
    (made[0] as ReturnType<typeof fake>).close();
    expect(hosts.unshare).toHaveBeenCalledWith(11);
    windows.jump(11, {});
    expect(opener.send).toHaveBeenCalledTimes(1);
    windows.show(opener, spec);
    expect(create).toHaveBeenCalledTimes(3);
    opener.close();
    expect(made[1]?.close).toHaveBeenCalled();
    expect(made[2]?.close).toHaveBeenCalled();
  });

  it('asks a diff window’s opener for a document, and tells its diff windows alone of its text', () => {
    let ids = 10;
    const made: ReturnType<typeof fake>[] = [];
    const windows = new DiffWindows({ share: vi.fn(), unshare: vi.fn() }, () => {
      const window = fake(++ids);
      made.push(window);
      return window;
    });
    const [opener, other] = [fake(1), fake(2)];
    windows.show(opener, spec);
    windows.show(other, spec);
    windows.askDocument(11, '/repo/a.ts', null);
    expect(opener.send).toHaveBeenCalledWith(DIFF_DOCUMENT_ASKED, '/repo/a.ts', null);
    expect(other.send).not.toHaveBeenCalled();
    windows.showDocument(1, '/repo/a.ts', 'text');
    expect(made[0]?.send).toHaveBeenCalledWith(DIFF_DOCUMENT_SHOWN, '/repo/a.ts', 'text');
    expect(made[1]?.send).not.toHaveBeenCalled();
    // A window no project window opened: no one to ask.
    windows.askDocument(99, '/repo/a.ts', null);
    expect(opener.send).toHaveBeenCalledOnce();
  });

  it('moves a diff to its opener as a tab, in front, and closes its window', () => {
    let ids = 10;
    const windows = new DiffWindows({ share: vi.fn(), unshare: vi.fn() }, () => fake(++ids));
    const opener = fake(1);
    windows.show(opener, spec);
    const shown = fake(11);
    windows.toTab(shown, { ...spec, path: 'b.ts' });
    expect(opener.send).toHaveBeenCalledWith(DIFF_TABBED, { ...spec, path: 'b.ts' });
    expect(opener.focus).toHaveBeenCalled();
    expect(shown.close).toHaveBeenCalled();
    // A window no project window opened: nothing to move to.
    const other = fake(12);
    windows.toTab(other, spec);
    expect(other.close).not.toHaveBeenCalled();
    expect(opener.send).toHaveBeenCalledOnce();
  });

  it('tells the opener’s other diff windows to move too, when asked, as IntelliJ moves every diff', () => {
    const made: ReturnType<typeof fake>[] = [];
    let ids = 10;
    const windows = new DiffWindows({ share: vi.fn(), unshare: vi.fn() }, () => {
      const window = fake(++ids);
      made.push(window);
      return window;
    });
    const opener = fake(1);
    const another = fake(2);
    windows.show(opener, spec);
    windows.show(opener, { ...spec, path: 'b.ts' });
    windows.show(another, spec);
    const [first, second, elsewhere] = made as [typeof opener, typeof opener, typeof opener];
    windows.toTab(first, spec, true);
    expect(second.send).toHaveBeenCalledWith(DIFF_MOVE);
    expect(first.send).not.toHaveBeenCalled();
    // Another project window's diffs stay.
    expect(elsewhere.send).not.toHaveBeenCalled();
    // Moving as told: no one else told again.
    windows.toTab(second, { ...spec, path: 'b.ts' });
    expect(second.send).toHaveBeenCalledOnce();
  });

  it('takes a spec with its strings, a range’s, and its files with its own, or none', () => {
    expect(diffSpec(spec)).toEqual(spec);
    const range = { from: 'a1', to: 'b2' };
    expect(diffSpec({ ...spec, range, extra: 1 })).toEqual({ ...spec, range });
    const chain = ['b.ts', spec.path];
    expect(diffSpec({ ...spec, chain })).toEqual({ ...spec, chain });
    // Show Diff's: the editor's caret line, kept.
    expect(diffSpec({ ...spec, line: 0 })).toEqual({ ...spec, line: 0 });
    for (const bad of [
      null,
      {},
      { ...spec, path: '' },
      { ...spec, range: { from: 'a' } },
      { ...spec, chain: 'b.ts' },
      { ...spec, chain: ['b.ts'] },
      { ...spec, chain: [spec.path, 1] },
      { ...spec, line: -1 },
      { ...spec, line: 1.5 },
      { ...spec, line: '3' },
    ]) {
      expect(() => diffSpec(bad)).toThrow('A diff needs');
    }
    expect(decodeURIComponent(diffHash(spec))).toBe(`diff=${JSON.stringify(spec)}`);
  });

  it('opens them for a page, and jumps back from them', async () => {
    const opener = fake(1);
    const create = vi.fn(() => fake(2));
    const hosts = { share: vi.fn(), unshare: vi.fn() };
    installDiffWindows(hosts as never, create);
    const contents = (id: number) => ({
      id,
      isDestroyed: () => false,
      send: opener.send,
      once: vi.fn(),
    });
    const ask = (channel: string, id: number, ...args: unknown[]) =>
      (electron.handlers.get(channel) as Listener)(
        { sender: contents(id) },
        ...args,
      ) as Promise<Answer>;
    expect(await ask(DIFF_OPEN, 1, spec)).toEqual({ result: undefined });
    expect(create).toHaveBeenCalledWith(spec);
    expect(((await ask(DIFF_OPEN, 1, { path: 3 })) as { error: string }).error).toContain(
      'A diff needs',
    );
    await ask(DIFF_JUMP, 2, { line: 1 });
    expect(opener.send).toHaveBeenCalledWith(DIFF_JUMPED, { line: 1 });
    await ask(DIFF_TAB, 2, spec, true);
    expect(opener.send).toHaveBeenCalledWith(DIFF_TABBED, spec);
    // Its document, asked for through the opener, told of to the diff window.
    create.mockImplementation(() => ({ ...fake(3), send: opener.send }));
    await ask(DIFF_OPEN, 1, { ...spec, path: 'b.ts' });
    await ask(DIFF_DOCUMENT, 3, '/repo/b.ts', null);
    expect(opener.send).toHaveBeenCalledWith(DIFF_DOCUMENT_ASKED, '/repo/b.ts', null);
    await ask(DIFF_DOCUMENT_TEXT, 1, '/repo/b.ts', 'b');
    expect(opener.send).toHaveBeenCalledWith(DIFF_DOCUMENT_SHOWN, '/repo/b.ts', 'b');
  });

  it('sees a window through its contents: sent to while it lasts, brought to the front, closed', () => {
    const owner = {
      focus: vi.fn(),
      restore: vi.fn(),
      close: vi.fn(),
      isMinimized: vi.fn(() => true),
    };
    electron.owners.set(5, owner);
    let destroyed = false;
    const once = vi.fn();
    const contents = { id: 5, isDestroyed: () => destroyed, send: vi.fn(), once };
    const window = windowOf(contents as never);
    window.send('x', 1);
    destroyed = true;
    window.send('y');
    expect(contents.send).toHaveBeenCalledTimes(1);
    // Destroyed, as a diff window's are when its opener closes after it: nothing to close.
    window.close();
    window.focus();
    expect(owner.close).not.toHaveBeenCalled();
    destroyed = false;
    window.focus();
    expect(owner.restore).toHaveBeenCalled();
    owner.isMinimized.mockReturnValue(false);
    window.focus();
    expect(owner.restore).toHaveBeenCalledTimes(1);
    expect(owner.focus).toHaveBeenCalledTimes(2);
    window.close();
    expect(owner.close).toHaveBeenCalled();
    const listener = vi.fn();
    window.onClosed(listener);
    expect(once).toHaveBeenCalledWith('destroyed', listener);
    // Its window gone: nothing to do.
    electron.owners.delete(5);
    window.focus();
    window.close();
  });
});
