import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import { setupRemotes } from '../src/remotes.js';
import { closeAll, FakeHost, project } from './fakes.js';

/** The repository's remotes, as the host has them; what changing them fails with, if it does. */
const git = {
  remotes: [] as { name: string; url: string }[],
  failure: undefined as Error | undefined,
};
const changed = () => {
  if (git.failure) throw git.failure;
  return null;
};
const host = new FakeHost({
  'git.remotes': () => {
    if (git.failure?.message === 'unreadable') throw git.failure;
    return git.remotes.map((r) => ({ ...r }));
  },
  'git.checkRemote': () => null,
  'git.addRemote': (p: { name: string; url: string }) => {
    changed();
    git.remotes.push({ name: p.name, url: p.url });
    return null;
  },
  'git.changeRemote': (p: { fromName: string; name: string; url: string }) => {
    changed();
    git.remotes = git.remotes.map((r) =>
      r.name === p.fromName ? { name: p.name, url: p.url } : r,
    );
    return null;
  },
  'git.removeRemote': (p: { name: string }) => {
    changed();
    git.remotes = git.remotes.filter((r) => r.name !== p.name);
    return null;
  },
});

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };

beforeAll(() => {
  useProjects([project('/r', host), project('/s', undefined)]);
  setupRemotes(services);
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  git.remotes = [
    { name: 'origin', url: 'https://o' },
    { name: 'up', url: 'https://u' },
  ];
  git.failure = undefined;
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
});

/** The dialogs open, newest last. */
const dialogs = () => [...document.querySelectorAll<HTMLElement>('.cerebro-dialog')];
const top = () => dialogs().at(-1) as HTMLElement;
const title = () => top().querySelector('.cerebro-dialog__title')?.textContent;
const remotesDialog = () =>
  dialogs().find((d) => d.querySelector('.playground-remotes')) as HTMLElement;
/** The table's rows, as name and URL. */
const rows = () =>
  [...remotesDialog().querySelectorAll('.playground-remotes__row')].map((row) =>
    [...row.querySelectorAll('td')].map((td) => td.textContent).join(' '),
  );
const row = (name: string) =>
  [...remotesDialog().querySelectorAll<HTMLElement>('.playground-remotes__row')].find(
    (r) => r.querySelector('td')?.textContent === name,
  ) as HTMLElement;
const tool = (label: string) =>
  remotesDialog().querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  ) as HTMLButtonElement;
const opened = async () => {
  commands.execute('git.manageRemotes');
  await expect.poll(() => title()).toBe('Git Remotes');
  await expect.poll(rows).toEqual(['origin https://o', 'up https://u']);
};
/** Clicks a button of the newest dialog. */
const click = async (label: string) => {
  const button = [...top().querySelectorAll('.cerebro-dialog__button')].find(
    (b) => b.textContent === label,
  ) as HTMLElement;
  await userEvent.click(button);
};
/** Define Remote's fields. */
const fields = () => top().querySelectorAll<HTMLInputElement>('input[type="text"]');

describe('Git → Manage Remotes…', () => {
  it('sits in the Git menu, for a worktree with a host', () => {
    expect(menus.entries('main/git')).toEqual([{ command: 'git.manageRemotes' }]);
    expect(commands.get('git.manageRemotes')?.label).toBe('Manage Remotes');
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(commands.isEnabled('git.manageRemotes')).toBe(false);
  });

  it('lists the remotes, Remove and Edit off until one is selected, only OK to close', async () => {
    await opened();
    expect([...remotesDialog().querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      'Name',
      'URL',
    ]);
    expect(tool('Remove').disabled).toBe(true);
    expect(tool('Edit').disabled).toBe(true);
    expect(tool('Add').disabled).toBe(false);
    expect(
      [...remotesDialog().querySelectorAll('.cerebro-dialog__button')].map((b) => b.textContent),
    ).toEqual(['OK']);
    await userEvent.click(row('up'));
    expect(row('up').getAttribute('aria-selected')).toBe('true');
    expect(tool('Remove').disabled).toBe(false);
    await userEvent.keyboard('{ArrowUp}');
    expect(row('origin').getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(row('up').getAttribute('aria-selected')).toBe('true');
    await click('OK');
    expect(dialogs()).toHaveLength(0);
  });

  it('names each tool and its key; Enter and Alt+Delete do nothing with none selected', async () => {
    await opened();
    const tip = () => document.querySelector('.cerebro-tooltip')?.textContent;
    for (const [label, text] of [
      ['Add', 'AddAlt+Insert'],
      ['Remove', 'RemoveAlt+Delete'],
      ['Edit', 'EditEnter'],
    ] as const) {
      await userEvent.hover(tool(label));
      await expect.poll(tip).toBe(text);
      await userEvent.unhover(tool(label));
    }
    (remotesDialog().querySelector('table') as HTMLElement).focus();
    await userEvent.keyboard('{Enter}{Alt>}{Delete}{/Alt}');
    expect(dialogs()).toHaveLength(1);
  });

  it('fits a long URL in the table, cut with an ellipsis, as IntelliJ’s', async () => {
    git.remotes = [{ name: 'origin', url: `/${'very-long-folder/'.repeat(20)}repository` }];
    commands.execute('git.manageRemotes');
    await expect.poll(() => remotesDialog().querySelector('.playground-remotes__row')).toBeTruthy();
    const list = remotesDialog().querySelector('.playground-remotes__list') as HTMLElement;
    // No horizontal bar to lie over the rows.
    expect(list.scrollWidth).toBe(list.clientWidth);
    const url = row('origin').querySelectorAll('td')[1] as HTMLElement;
    expect(url.scrollWidth).toBeGreaterThan(url.clientWidth);
    expect(getComputedStyle(url).textOverflow).toBe('ellipsis');
    // Name as wide as its names.
    const name = row('origin').querySelector('td') as HTMLElement;
    expect(name.offsetWidth).toBeLessThan(list.clientWidth / 4);
  });

  it('adds a remote with Define Remote, its name empty when there’s an origin', async () => {
    await opened();
    await userEvent.click(tool('Add'));
    await expect.poll(title).toBe('Define Remote');
    const [name, url] = fields();
    expect(name?.value).toBe('');
    await expect.poll(() => document.activeElement).toBe(name);
    await userEvent.keyboard('fork');
    await userEvent.type(url as HTMLInputElement, 'https://f');
    await click('OK');
    await expect.poll(rows).toEqual(['origin https://o', 'up https://u', 'fork https://f']);
    expect(host.params('git.addRemote')).toEqual([
      { path: '/r', name: 'fork', url: 'https://f', fetch: true },
    ]);
    expect(row('fork').getAttribute('aria-selected')).toBe('true');
  });

  it('proposes origin when there’s none, with Alt+Insert from the table', async () => {
    git.remotes = [];
    commands.execute('git.manageRemotes');
    await expect.poll(title).toBe('Git Remotes');
    await expect.poll(() => document.activeElement?.tagName).toBe('TABLE');
    // Nothing to move to.
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Alt>}{Insert}{/Alt}');
    await expect.poll(title).toBe('Define Remote');
    expect(fields()[0]?.value).toBe('origin');
  });

  it('edits a remote: renamed and moved; nothing asked when nothing changed', async () => {
    await opened();
    await userEvent.dblClick(row('up'));
    await expect.poll(title).toBe('Define Remote');
    const [name, url] = fields();
    expect([name?.value, url?.value]).toEqual(['up', 'https://u']);
    // Its own name isn't taken; another's is.
    await click('OK');
    await expect.poll(() => dialogs()).toHaveLength(1);
    expect(host.params('git.changeRemote')).toEqual([]);
    await userEvent.click(row('up'));
    await userEvent.keyboard('{Enter}');
    await expect.poll(title).toBe('Define Remote');
    await userEvent.clear(fields()[0] as HTMLInputElement);
    await userEvent.type(fields()[0] as HTMLInputElement, 'origin');
    expect(top().textContent).toContain("Remote name 'origin' is already used");
    await userEvent.clear(fields()[0] as HTMLInputElement);
    await userEvent.type(fields()[0] as HTMLInputElement, 'upstream');
    await userEvent.clear(fields()[1] as HTMLInputElement);
    await userEvent.type(fields()[1] as HTMLInputElement, 'https://v');
    await click('OK');
    await expect.poll(rows).toEqual(['origin https://o', 'upstream https://v']);
    expect(host.params('git.changeRemote')).toEqual([
      {
        path: '/r',
        fromName: 'up',
        fromUrl: 'https://u',
        name: 'upstream',
        url: 'https://v',
        fetch: true,
      },
    ]);
  });

  it('removes a remote once asked, with Alt+Delete too', async () => {
    await opened();
    await userEvent.click(row('up'));
    await userEvent.click(tool('Remove'));
    await expect.poll(title).toBe('Remove Remote');
    expect(top().textContent).toContain("Remove remote up 'https://u'?");
    await click('No');
    expect(rows()).toEqual(['origin https://o', 'up https://u']);
    await userEvent.click(row('up'));
    await userEvent.keyboard('{Alt>}{Delete}{/Alt}');
    await expect.poll(title).toBe('Remove Remote');
    await click('Yes');
    await expect.poll(rows).toEqual(['origin https://o']);
  });

  it('says why a change failed, in IntelliJ’s words, the list read again', async () => {
    await opened();
    git.failure = new Error("error: No such remote: 'up'");
    await userEvent.click(row('up'));
    await userEvent.click(tool('Remove'));
    await click('Yes');
    await expect.poll(title).toBe('Remove Remote');
    expect(top().textContent).toContain(
      "Cannot remove remote up 'https://u' in /r:\nerror: No such remote: 'up'",
    );
  });

  it('says when the remotes can’t be read', async () => {
    git.failure = new Error('unreadable');
    commands.execute('git.manageRemotes');
    await expect.poll(title).toBe('Git Remotes');
    expect(top().textContent).toContain('unreadable');
    expect(remotesDialog()).toBeUndefined();
  });

  it('takes the keys of Windows and Linux without a keymap', async () => {
    const registry = new CommandRegistry();
    setupRemotes({ commands: registry, menus: new MenuRegistry() });
    registry.execute('git.manageRemotes');
    await expect.poll(rows).toEqual(['origin https://o', 'up https://u']);
    await userEvent.keyboard('{Alt>}{Insert}{/Alt}');
    await expect.poll(title).toBe('Define Remote');
  });

  it('takes ⌘N and ⌘⌫ on macOS', async () => {
    const mac: MenuServices = { commands, menus, keymap: new Keymap('mac') };
    const registry = new CommandRegistry();
    setupRemotes({ ...mac, commands: registry, menus: new MenuRegistry() });
    registry.execute('git.manageRemotes');
    await expect.poll(rows).toEqual(['origin https://o', 'up https://u']);
    await userEvent.click(row('up'));
    await userEvent.keyboard('{Meta>}{Backspace}{/Meta}');
    await expect.poll(title).toBe('Remove Remote');
    await click('No');
    await userEvent.keyboard('{Meta>}n{/Meta}');
    await expect.poll(title).toBe('Define Remote');
    vi.restoreAllMocks();
  });
});
