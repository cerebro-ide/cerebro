import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { fileManagerLabel, numbered, setupSelectIn } from '../src/select-in.js';
import { closeAll } from './fakes.js';

afterEach(closeAll);

/** The open menu's heading and items, as shown. */
const shown = () =>
  [...document.querySelectorAll('.cerebro-menu-heading, .cerebro-menu-item__label')].map(
    (e) => e.textContent,
  );

describe('Select In', () => {
  it('names the file manager as IntelliJ does on each system', () => {
    expect(fileManagerLabel('darwin')).toBe('Reveal in Finder');
    expect(fileManagerLabel('win32')).toBe('Show in Explorer');
    expect(fileManagerLabel('linux')).toBe('Show in File Manager');
  });

  it('numbers its targets 1 to 9, then 0, then letters', () => {
    expect([0, 8, 9, 10, 11].map((i) => numbered(i, 'X'))).toEqual([
      '&1. X',
      '&9. X',
      '&0. X',
      '&A. X',
      '&B. X',
    ]);
  });

  it('offers the targets that can take the file, numbered, and shows it in the one chosen', async () => {
    const services = { commands: new CommandRegistry(), menus: new MenuRegistry() };
    const shownIn: string[] = [];
    let file: string | undefined = '/r/a.ts';
    setupSelectIn(
      services,
      [
        { id: 'never', label: 'Nowhere', can: () => false, show: () => undefined },
        { id: 'project', label: 'Project', can: () => true, show: (p) => void shownIn.push(p) },
        { id: 'files', label: 'Explorer', can: () => true, show: () => undefined },
      ],
      () => file,
      () => ({ x: 10, y: 10 }),
    );
    // Its targets run only from its popup, which gives them the file.
    expect(services.commands.isEnabled('selectIn.project')).toBe(false);
    services.commands.execute('navigate.selectIn');
    await expect.poll(shown).toEqual(['Select In', '1. Project', '2. Explorer']);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => shownIn).toEqual(['/r/a.ts']);
    expect(document.querySelector('.cerebro-menu')).toBeNull();
    // Its items went with it.
    expect(services.menus.entries('selectIn')).toEqual([]);

    file = undefined;
    expect(services.commands.isEnabled('navigate.selectIn')).toBe(false);
    services.commands.get('navigate.selectIn')?.run(undefined);
    expect(document.querySelector('.cerebro-menu')).toBeNull();
  });
});
