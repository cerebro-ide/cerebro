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

  it('takes a spec with its strings, and a range’s, or none', () => {
    expect(diffSpec(spec)).toEqual(spec);
    const range = { from: 'a1', to: 'b2' };
    expect(diffSpec({ ...spec, range, extra: 1 })).toEqual({ ...spec, range });
    for (const bad of [null, {}, { ...spec, path: '' }, { ...spec, range: { from: 'a' } }]) {
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
