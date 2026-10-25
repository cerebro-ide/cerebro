import type { MenuItemConstructorOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    Menu: {
      buildFromTemplate: (items: unknown) => ({ items }),
      setApplicationMenu: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain, Menu: electron.Menu }));

const { applicationMenu, installMenu, MENU_COMMAND, SET_MENU, template } =
  await import('../src/menu.js');

/** Clicks a built item, by the mouse or through its accelerator. */
function click(item: MenuItemConstructorOptions | undefined, triggeredByAccelerator = false) {
  (item?.click as Listener)({}, undefined, { triggeredByAccelerator });
}

beforeEach(() => {
  electron.ipc.clear();
  electron.Menu.setApplicationMenu.mockClear();
});

describe('template', () => {
  it('builds commands, toggles, shortcuts, separators and submenus', () => {
    const items = template(
      [
        {
          label: 'File',
          submenu: [
            { label: 'Open…', command: 'open', enabled: true, accelerator: 'Command+O' },
            { separator: true },
            { label: 'Save', command: 'save', enabled: false },
            { label: 'Wrap', command: 'wrap', enabled: true, checked: true },
          ],
        },
      ],
      () => undefined,
    );
    const file = items[0]?.submenu as MenuItemConstructorOptions[];
    expect(items[0]?.label).toBe('File');
    expect(file[0]).toEqual(
      expect.objectContaining({ label: 'Open…', enabled: true, accelerator: 'Command+O' }),
    );
    expect(file[1]).toEqual({ type: 'separator' });
    expect(file[2]).toEqual(expect.objectContaining({ enabled: false }));
    expect(file[3]).toEqual(expect.objectContaining({ type: 'checkbox', checked: true }));
  });

  it('runs a clicked command, but not one its shortcut triggered', () => {
    const run = vi.fn();
    const [item] = template([{ label: 'Open', command: 'open' }], run);
    click(item, true);
    expect(run).not.toHaveBeenCalled();
    click(item);
    expect(run).toHaveBeenCalledWith('open');
  });

  it('takes only known fields from the page', () => {
    const run = vi.fn();
    expect(template('nonsense', run)).toEqual([]);
    const items = template([null, 3, { role: 'quit', label: 7 }, { submenu: 'no' }], run);
    expect(items).toHaveLength(2);
    expect(items[0]).not.toHaveProperty('role');
    expect(items[0]).toEqual(expect.objectContaining({ label: '', enabled: false }));
    click(items[0]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('applicationMenu', () => {
  it('frames the page’s menus with the app and Window menus, sending clicks back', () => {
    const sender = { send: vi.fn() };
    const menu = applicationMenu(
      [{ label: 'File', submenu: [{ label: 'Open', command: 'open' }] }],
      sender as never,
    ) as unknown as { items: MenuItemConstructorOptions[] };
    expect(menu.items.map((i) => i.role ?? i.label)).toEqual(['appMenu', 'File', 'windowMenu']);
    click((menu.items[1]?.submenu as MenuItemConstructorOptions[])[0]);
    expect(sender.send).toHaveBeenCalledWith(MENU_COMMAND, 'open');
  });
});

describe('installMenu', () => {
  it('sets the application menu from the page on macOS', () => {
    installMenu('darwin');
    (electron.ipc.get(SET_MENU) as Listener)({ sender: { send: vi.fn() } }, []);
    expect(electron.Menu.setApplicationMenu).toHaveBeenCalledOnce();
  });

  it('does nothing elsewhere', () => {
    installMenu('win32');
    installMenu();
    expect(electron.ipc.size).toBe(0);
  });
});
