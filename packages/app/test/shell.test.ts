import { describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const ipc = new Map<string, Listener>();
  return {
    ipc,
    ipcMain: {
      on: (channel: string, listener: Listener) => {
        ipc.set(channel, listener);
      },
      handle: (channel: string, listener: Listener) => {
        ipc.set(channel, listener);
      },
    },
    shell: { showItemInFolder: vi.fn(), trashItem: vi.fn(() => Promise.resolve()) },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain, shell: electron.shell }));

const { installShell, REVEAL, TRASH } = await import('../src/shell.js');

describe('installShell', () => {
  it('shows an absolute path in the file manager, and ignores anything else', () => {
    installShell();
    const send = (path: unknown) => (electron.ipc.get(REVEAL) as Listener)({}, path);
    const windows = process.platform === 'win32';
    // The page's form, with forward slashes, in the platform's.
    send(windows ? 'C:/repo/a.ts' : '/repo//a.ts');
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(
      windows ? 'C:\\repo\\a.ts' : '/repo/a.ts',
    );
    vi.clearAllMocks();
    send('repo/a.ts');
    send(3);
    expect(electron.shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('moves an absolute path to the trash, failing for anything else', async () => {
    installShell();
    const send = (path: unknown) => (electron.ipc.get(TRASH) as Listener)({}, path);
    const windows = process.platform === 'win32';
    expect(await send(windows ? 'C:/repo/lib' : '/repo//lib')).toEqual({ result: undefined });
    expect(electron.shell.trashItem).toHaveBeenCalledWith(windows ? 'C:\\repo\\lib' : '/repo/lib');
    expect(await send('repo/lib')).toEqual({ error: 'Not a full path: repo/lib' });
    expect(await send(3)).toEqual({ error: 'Not a full path: 3' });
  });
});
