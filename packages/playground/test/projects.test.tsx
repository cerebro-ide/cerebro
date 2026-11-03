import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { OpenIn, RecentProject } from '../src/bridge.js';
import {
  closeProject,
  loadProjects,
  openFolder,
  openProject,
  projectAdded,
  projectRemoved,
  recentLabel,
  setActiveProject,
  setupProjects,
  windowProjects,
} from '../src/projects.js';
import { globalSettings } from '../src/settings.js';
import { closeAll, dialog, dialogText, press } from './fakes.js';

type Bridge = NonNullable<Window['cerebro']>;

const calls: unknown[][] = [];
let failing: string | undefined;
let picked: string | null = null;
const recent: RecentProject[] = [
  { path: '/p/a', name: 'a', opened: 2, exists: true },
  { path: '/p/gone', name: 'gone', opened: 1, exists: false },
  { path: '/p/open', name: 'open', opened: 3, exists: true },
  { path: '/p/R&D', name: 'R&D', opened: 0, exists: true },
];
const project = {
  current: () => Promise.resolve([{ path: '/p/open', name: 'open' }]),
  recent: () => Promise.resolve(recent),
  pick: () => Promise.resolve(picked),
  open: (path: string, where: OpenIn, replacing?: string) => {
    calls.push(['open', path, where, replacing]);
    return failing === 'open' ? Promise.reject(new Error('no such folder')) : Promise.resolve();
  },
  close: (path: string) => {
    calls.push(['close', path]);
    // Across IPC, a rejection may not be an Error.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- what's tested
    return failing === 'close' ? Promise.reject('busy') : Promise.resolve();
  },
};

afterEach(async () => {
  await closeAll();
  delete window.cerebro;
  calls.length = 0;
  failing = undefined;
  picked = null;
  globalSettings.layers.global.reset('project.openIn');
});

const app = () => {
  window.cerebro = { project } as unknown as Bridge;
};

describe('the window’s projects', () => {
  it('are none in a browser', async () => {
    expect(await loadProjects()).toEqual([]);
    await openProject('/p/a');
    await openFolder();
    await closeProject('/p/a');
    await setupProjects(new CommandRegistry(), new MenuRegistry(), () => Promise.resolve());
    expect(calls).toEqual([]);
  });

  it('are the app’s, as projects join and leave', async () => {
    app();
    expect(await loadProjects()).toEqual([{ path: '/p/open', name: 'open' }]);
    projectAdded({ path: '/p/b', name: 'b' });
    projectAdded({ path: '/p/open', name: 'open' });
    expect(windowProjects().map((p) => p.path)).toEqual(['/p/b', '/p/open']);
    projectRemoved('/p/b');
    expect(windowProjects().map((p) => p.path)).toEqual(['/p/open']);
  });
});

describe('opening a project', () => {
  it('opens one already open where it is, and from the Welcome window in a new one', async () => {
    app();
    await loadProjects();
    await openProject('/p/open');
    projectRemoved('/p/open');
    await openProject('/p/a');
    expect(calls).toEqual([
      ['open', '/p/open', 'new', undefined],
      ['open', '/p/a', 'new', undefined],
    ]);
  });

  it('goes where the setting says, This Window in the active project’s place', async () => {
    app();
    await loadProjects();
    setActiveProject(() => '/p/open');
    globalSettings.layers.global.set('project.openIn', 'this');
    await openProject('/p/a');
    globalSettings.layers.global.set('project.openIn', 'new');
    await openProject('/p/a');
    expect(calls).toEqual([
      ['open', '/p/a', 'this', '/p/open'],
      ['open', '/p/a', 'new', undefined],
    ]);
  });

  it('asks where otherwise, and remembers the answer if told to', async () => {
    app();
    await loadProjects();
    let done = openProject('/p/a');
    expect(await dialogText()).toContain('Where would you like to open the project?');
    await press('New Window');
    await done;
    done = openProject('/p/a');
    await dialog();
    await press('Cancel');
    await done;
    expect(calls).toEqual([['open', '/p/a', 'new', undefined]]);
    done = openProject('/p/a');
    await userEvent.click((await dialog()).querySelector('input[type="checkbox"]') as Element);
    await press('This Window');
    await done;
    expect(globalSettings.get('project.openIn')).toBe('this');
    expect(
      JSON.parse(localStorage.getItem('cerebro.settings.global.user') as string),
    ).toMatchObject({ 'project.openIn': 'this' });
  });

  it('opens a folder picked, unless none was', async () => {
    app();
    projectRemoved('/p/open');
    await openFolder();
    picked = '/p/picked';
    await openFolder();
    expect(calls).toEqual([['open', '/p/picked', 'new', undefined]]);
  });

  it('says why it couldn’t open or close one', async () => {
    app();
    projectRemoved('/p/open');
    failing = 'open';
    await openProject('/p/a');
    expect(await dialogText()).toBe('no such folder');
    await press('Close');
    failing = 'close';
    await closeProject('/p/a');
    expect(await dialogText()).toBe('busy');
    await press('Close');
    failing = undefined;
    await closeProject('/p/a');
    expect(calls.at(-1)).toEqual(['close', '/p/a']);
  });
});

describe('the File menu', () => {
  it('has Close Project, and the recent projects still there and not open', async () => {
    app();
    await loadProjects();
    const commands = new CommandRegistry();
    const menus = new MenuRegistry();
    let closed = 0;
    await setupProjects(commands, menus, () => {
      closed++;
      return Promise.resolve();
    });
    commands.execute('project.close');
    expect(closed).toBe(1);
    expect(menus.entries('main/file')).toContainEqual(
      expect.objectContaining({ command: 'project.close' }),
    );
    const items = menus.entries('main/file/recent').map((e) => ('command' in e ? e.command : ''));
    expect(items.map((id) => commands.get(id)?.label)).toEqual(['a [/p/a]', 'R&&D [/p/R&&D]']);
    globalSettings.layers.global.set('project.openIn', 'new');
    commands.execute(items[0] as string);
    await expect.poll(() => calls).toEqual([['open', '/p/a', 'new', undefined]]);
    expect(recentLabel({ path: '/x', name: 'x', opened: 0, exists: true })).toBe('x [/x]');
  });
});
