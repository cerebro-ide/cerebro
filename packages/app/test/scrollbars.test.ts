import { describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const ipc = new Map<string, Listener>();
  return {
    ipc,
    ipcMain: {
      handle: (channel: string, listener: Listener) => {
        ipc.set(channel, listener);
      },
    },
    systemPreferences: { getUserDefault: vi.fn(() => true) },
  };
});

vi.mock('electron', () => ({
  ipcMain: electron.ipcMain,
  systemPreferences: electron.systemPreferences,
}));

const { installScrollbars, jumpToSpot, SCROLLBARS_JUMP } = await import('../src/scrollbars.js');

describe('a press on a scrollbar’s track, as the system says', () => {
  it('jumps to the spot on macOS where its setting says so, as IntelliJ’s', async () => {
    installScrollbars('darwin');
    const ask = electron.ipc.get(SCROLLBARS_JUMP) as Listener;
    expect(await ask({})).toEqual({ result: true });
    expect(electron.systemPreferences.getUserDefault).toHaveBeenCalledWith(
      'AppleScrollerPagingBehavior',
      'boolean',
    );
    electron.systemPreferences.getUserDefault.mockReturnValueOnce(false);
    expect(await ask({})).toEqual({ result: false });
  });

  it('pages elsewhere, the setting not read', () => {
    electron.systemPreferences.getUserDefault.mockClear();
    expect(jumpToSpot('win32')).toBe(false);
    expect(jumpToSpot('linux')).toBe(false);
    expect(electron.systemPreferences.getUserDefault).not.toHaveBeenCalled();
  });
});
