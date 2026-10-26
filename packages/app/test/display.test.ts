import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const ipc = new Map<string, Listener>();
  return {
    ipc,
    app: {
      getPath: vi.fn(() => '/data'),
      commandLine: { appendSwitch: vi.fn() },
    },
    ipcMain: {
      on: (channel: string, listener: Listener) => {
        ipc.set(channel, listener);
      },
    },
  };
});

vi.mock('electron', () => ({ app: electron.app, ipcMain: electron.ipcMain }));

const { installDisplayScale, isWsl, osScale, readChoice, scaleFor, SET_SCALE, system, zoomFor } =
  await import('../src/display.js');

const REG = `
HKEY_CURRENT_USER\\Control Panel\\Desktop\\WindowMetrics
    AppliedDPI    REG_DWORD    0x90
`;

/** A system: WSL or not, a registry answer, and files. */
function fake(options: { wsl?: boolean; reg?: string; files?: Record<string, string> } = {}) {
  const run = vi.fn(() => options.reg);
  return {
    platform: 'linux' as const,
    read: (path: string) =>
      path === '/proc/version'
        ? options.wsl
          ? 'Linux version 6.18.54.1-microsoft-standard-WSL2'
          : 'Linux version 6.8.0-generic'
        : options.files?.[path],
    run,
  };
}

beforeEach(() => {
  electron.ipc.clear();
  electron.app.commandLine.appendSwitch.mockClear();
});

describe('the OS scale', () => {
  it('is Electron’s own, except under WSL', () => {
    expect(isWsl(fake({ wsl: true }))).toBe(true);
    expect(isWsl(fake())).toBe(false);
    expect(isWsl({ ...fake({ wsl: true }), platform: 'win32' })).toBe(false);
    expect(isWsl({ ...fake(), read: () => undefined })).toBe(false);
    const native = fake({ reg: REG });
    expect(osScale(native)).toBeUndefined();
    expect(native.run).not.toHaveBeenCalled();
  });

  it('comes from Windows’ registry under WSL', () => {
    expect(osScale(fake({ wsl: true, reg: REG }))).toBe(1.5);
    expect(osScale(fake({ wsl: true, reg: REG.replace('0x90', '0x78') }))).toBe(1.25);
  });

  it('is left to Electron when the registry can’t be read', () => {
    expect(osScale(fake({ wsl: true }))).toBeUndefined();
    expect(osScale(fake({ wsl: true, reg: 'ERROR: not found' }))).toBeUndefined();
  });
});

describe('the scale chosen', () => {
  it('follows the OS for auto, else is the factor chosen', () => {
    expect(scaleFor('auto', fake({ wsl: true, reg: REG }))).toBe(1.5);
    expect(scaleFor('auto', fake())).toBeUndefined();
    expect(scaleFor('1.25', fake({ wsl: true, reg: REG }))).toBe(1.25);
  });

  it('is read from the data folder, auto without a valid one', () => {
    const files = (json: string) => fake({ files: { '/d/display.json': json } });
    expect(readChoice('/d', files('{"scale":"2"}'))).toBe('2');
    expect(readChoice('/d', files('{"scale":"7"}'))).toBe('auto');
    expect(readChoice('/d', files('not json'))).toBe('auto');
    expect(readChoice('/d', fake())).toBe('auto');
  });
});

describe('installDisplayScale', () => {
  it('forces the scale chosen before the app starts', () => {
    const sys = fake({ files: { '/data/display.json': '{"scale":"1.75"}' } });
    expect(installDisplayScale(sys, vi.fn())).toBe(1.75);
    expect(electron.app.commandLine.appendSwitch).toHaveBeenCalledWith(
      'force-device-scale-factor',
      '1.75',
    );
  });

  it('forces no scale on macOS, which ignores the switch: the page is zoomed instead', () => {
    const sys = {
      ...fake({ files: { '/data/display.json': '{"scale":"1.25"}' } }),
      platform: 'darwin' as const,
    };
    expect(installDisplayScale(sys, vi.fn())).toBe(1.25);
    expect(electron.app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it('leaves the scale to Electron when there’s nothing to force', () => {
    expect(installDisplayScale(fake(), vi.fn())).toBeUndefined();
    expect(electron.app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it('keeps valid choices the page sends, for the next start', () => {
    const write = vi.fn();
    installDisplayScale(fake(), write);
    const send = electron.ipc.get(SET_SCALE) as Listener;
    send({}, '1.5');
    send({}, 'huge');
    expect(write).toHaveBeenCalledExactlyOnceWith('/data/display.json', '{"scale":"1.5"}');
    write.mockImplementation(() => {
      throw new Error('read-only');
    });
    expect(() => send({}, '2')).not.toThrow();
  });
});

describe('zoomFor', () => {
  it('zooms by the scale over the screen’s, only on macOS and only for a forced scale', () => {
    expect(zoomFor(1.25, 'darwin', 2)).toBe(0.625);
    expect(zoomFor(1.25, 'darwin', 1)).toBe(1.25);
    expect(zoomFor(undefined, 'darwin', 2)).toBeUndefined();
    expect(zoomFor(1.25, 'linux', 1)).toBeUndefined();
  });
});

describe('the real system', () => {
  it('reads files and runs programs, undefined when it can’t', () => {
    expect(system.read('/definitely/missing')).toBeUndefined();
    expect(system.read(import.meta.filename)).toContain('the real system');
    expect(system.run('node', ['-e', 'process.stdout.write("hi")'])).toBe('hi');
    expect(system.run('definitely-not-a-program', [])).toBeUndefined();
  });
});
