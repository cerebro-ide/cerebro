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
    },
    shell: { showItemInFolder: vi.fn() },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain, shell: electron.shell }));

const { installReveal, REVEAL } = await import('../src/reveal.js');

describe('installReveal', () => {
  it('shows an absolute path in the file manager, and ignores anything else', () => {
    installReveal();
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
});
