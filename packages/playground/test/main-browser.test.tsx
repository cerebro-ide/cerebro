import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Tab } from '@cerebro-ide/layout';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { EditorDocument } from '@cerebro-ide/ui-editor';
import { diffTab } from '../src/changes.js';
import { documentRead } from '../src/documents.js';
import { workspace } from '../src/environments.js';
import { carets } from '../src/navigation.js';
import { notifications } from '../src/notifications.js';
import { fetching, pullingFrom } from '../src/fetch-pull.js';
import { viewCommits } from '../src/git-log.js';
import { resetting } from '../src/reset.js';
import { fetchingRemote, pushing } from '../src/push.js';
import { updating } from '../src/update.js';
import { globalSettings } from '../src/settings.js';
import { closeAll, dialog, menuItem, menuItems, popupItems } from './fakes.js';

// The page, as a browser shows it: the samples, without the app's hosts. It's made once, as it's
// imported: each test leaves it as it found it, or goes on from where the last left it.

beforeAll(async () => {
  // The sample indexing's timer, among others, steps as a test says.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  // Always Select Opened File is read from storage as the page loads, which may be blocked.
  const read = (key: string) => localStorage[key] as string | undefined;
  const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
    if (key === 'cerebro.project.alwaysSelectOpened') throw new Error('blocked');
    return read(key) ?? null;
  });
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/main.js');
  blocked.mockRestore();
});

afterEach(async () => {
  await closeAll();
  vi.restoreAllMocks();
});

const q = (selector: string) => document.querySelector(selector) as HTMLElement;
/** The status bar's texts, of the items shown. */
const status = () =>
  [
    ...document.querySelectorAll('.cerebro-statusbar__item:not([hidden]) .cerebro-statusbar__text'),
  ].map((t) => t.textContent);
const stripe = (id: string) => q(`.cerebro-stripe-button[data-id="${id}"]`);
const tooltipText = () => document.querySelector('.cerebro-tooltip')?.textContent;
const env = () => workspace.active as NonNullable<typeof workspace.active>;
/** The active editor's text, in its shadow root. */
const code = () => editorRoot()?.querySelector<HTMLElement>('.cm-content');
const editorRoot = () =>
  document.querySelector('.cerebro-editor-group--active .cerebro-editor-code')?.shadowRoot;

describe('the page in a browser', () => {
  it('starts with the samples: a worktree’s files, and the windows shown by default', async () => {
    expect(document.documentElement.classList).not.toContain('cerebro-app');
    expect(env().id).toBe('cerebro-status-bar');
    // The file's items once it's read.
    await expect.poll(status).toEqual([
      'cerebro-status-bar · feat/status-bar',
      'src/styles.css',
      'Indexing…',
      expect.any(String),
      '1:1',
      'LF',
      'UTF-8',
      // The sample's lines are indented with tabs.
      'Tab',
      'CSS',
    ]);
    expect(q('.cerebro-tool-window[data-id="terminal"]').textContent).toContain(
      'Terminals run in the desktop app.',
    );
  });

  it('indexes, as a sample task, in the status bar', async () => {
    vi.advanceTimersByTime(20_000);
    await expect.poll(() => status()[2]).toBe('Indexed');
  });

  it('shows Pushing… while a push is under way, as IntelliJ’s background task', async () => {
    const item = q('.cerebro-statusbar__item[data-id="push"]');
    expect(item.hidden).toBe(true);
    pushing.set(true);
    await expect.poll(() => item.hidden).toBe(false);
    expect(item.textContent).toBe('Pushing…');
    expect(item.querySelector('.cerebro-statusbar__progress--indeterminate')).not.toBeNull();
    await userEvent.hover(item);
    await expect.poll(tooltipText).toBe('Pushing the branch');
    await userEvent.unhover(item);
    pushing.set(false);
    await expect.poll(() => item.hidden).toBe(true);
  });

  it('shows Updating… while the project updates, as IntelliJ’s', async () => {
    const item = q('.cerebro-statusbar__item[data-id="update"]');
    expect(item.hidden).toBe(true);
    updating.set(true);
    await expect.poll(() => item.hidden).toBe(false);
    expect(item.textContent).toBe('Updating…');
    await userEvent.hover(item);
    await expect.poll(tooltipText).toBe('Updating the project');
    await userEvent.unhover(item);
    updating.set(false);
    await expect.poll(() => item.hidden).toBe(true);
  });

  it('shows Fetching Remote Commits… while the Push dialog fetches, as IntelliJ’s', async () => {
    const item = q('.cerebro-statusbar__item[data-id="push-fetch"]');
    expect(item.hidden).toBe(true);
    fetchingRemote.set(true);
    await expect.poll(() => item.hidden).toBe(false);
    expect(item.textContent).toBe('Fetching Remote Commits…');
    await userEvent.hover(item);
    await expect
      .poll(tooltipText)
      .toBe('Fetching the remote’s commits, to count what a push replaces');
    await userEvent.unhover(item);
    fetchingRemote.set(false);
    await expect.poll(() => item.hidden).toBe(true);
  });

  it('shows Resetting HEAD… or Git Reset while a reset is under way, as IntelliJ’s', async () => {
    const item = q('.cerebro-statusbar__item[data-id="reset"]');
    expect(item.hidden).toBe(true);
    resetting.set('Resetting HEAD…');
    await expect.poll(() => item.hidden).toBe(false);
    expect(item.textContent).toBe('Resetting HEAD…');
    await userEvent.hover(item);
    await expect.poll(tooltipText).toBe('Resetting the branch');
    await userEvent.unhover(item);
    resetting.set('Git Reset');
    await expect.poll(() => item.textContent).toBe('Git Reset');
    resetting.set(undefined);
    await expect.poll(() => item.hidden).toBe(true);
  });

  it('shows Fetching… and Pulling changes from a remote while they’re under way, as IntelliJ’s', async () => {
    const fetchItem = q('.cerebro-statusbar__item[data-id="fetch"]');
    expect(fetchItem.hidden).toBe(true);
    fetching.set(true);
    await expect.poll(() => fetchItem.hidden).toBe(false);
    expect(fetchItem.textContent).toBe('Fetching…');
    await userEvent.hover(fetchItem);
    await expect.poll(tooltipText).toBe('Fetching every remote');
    await userEvent.unhover(fetchItem);
    fetching.set(false);
    await expect.poll(() => fetchItem.hidden).toBe(true);
    const pullItem = q('.cerebro-statusbar__item[data-id="pull"]');
    expect(pullItem.hidden).toBe(true);
    pullingFrom.set('upstream');
    await expect.poll(() => pullItem.hidden).toBe(false);
    expect(pullItem.textContent).toBe('Pulling changes from upstream');
    await userEvent.hover(pullItem);
    await expect.poll(tooltipText).toBe('Pulling the branch');
    await userEvent.unhover(pullItem);
    pullingFrom.set(undefined);
    await expect.poll(() => pullItem.hidden).toBe(true);
  });

  it('says what each item on the status bar is', async () => {
    const tips: (string | undefined)[] = [];
    for (const item of document.querySelectorAll('.cerebro-statusbar__item:not([hidden])')) {
      await userEvent.hover(item);
      await expect.poll(tooltipText).toBeDefined();
      tips.push(tooltipText());
      await userEvent.unhover(item);
      await expect.poll(tooltipText).toBeUndefined();
    }
    expect(tips).toEqual([
      'Environment: worktree and branch (sample)',
      'The active file',
      'A background task (sample)',
      'The worktree’s agent, in the Claude tool window',
      expect.stringMatching(/^Go to Line/),
      'Line Separator: \\n',
      'File Encoding: UTF-8',
      'Indent: Tab (detected)',
      'File Type',
    ]);
  });
});

describe('the editor', () => {
  it('shows a sample file’s pretend contents, and its menus', async () => {
    await expect.poll(() => code()?.textContent).toContain('// src/styles.css');
    const editor = q('.cerebro-editor-group--active .playground-code');
    await userEvent.click(editor, { button: 'right' });
    expect(await menuItems()).toEqual(['Go to File…', 'Local History', 'Reformat with Prettier']);
    await closeAll();
    // The gutter's menu: the bookmarks', without git's Annotate.
    const gutter = document
      .querySelector('.cerebro-editor-group--active .cerebro-editor-code')
      ?.shadowRoot?.querySelector('.cm-gutters') as HTMLElement;
    await userEvent.click(gutter, { button: 'right' });
    expect(await menuItems()).toEqual(['Toggle Bookmark', 'Add Mnemonic Bookmark…']);
    await closeAll();
    await userEvent.click(q('.cerebro-editor-tab--active'), { button: 'right' });
    expect(await menuItems()).toEqual(expect.arrayContaining(['Close']));
  });

  it('says diffs show in the desktop app', async () => {
    env().editor.open(diffTab('src/main.ts'));
    await expect
      .poll(() => document.querySelector('.playground-code__note')?.textContent)
      .toBe('Diffs show in the desktop app.');
    // The status bar names its file.
    expect(status()[1]).toBe('src/main.ts');
    env().editor.close(env().editor.activeGroupId, diffTab('src/main.ts').id);
  });
});

describe('the Project popup', () => {
  it('lists the window’s projects, the active one checked, and shows the one chosen', async () => {
    await userEvent.click(q('[aria-label^="Project:"]'));
    expect(await popupItems()).toEqual(['Open…', 'cerebro']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
    expect(env().id).toBe('cerebro-status-bar');
  });
});

describe('Recent Files', () => {
  it('lists the files shown, the one before highlighted, and opens the one chosen', async () => {
    await userEvent.keyboard('{Control>}e{/Control}');
    expect(await popupItems()).toEqual(expect.arrayContaining(['styles.css', 'shell.tsx']));
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => status()[1]).not.toBe('src/styles.css');
  });

  it('lists the files edited, by its own key or the option', async () => {
    await userEvent.keyboard('{Control>}e{/Control}');
    await popupItems();
    await userEvent.keyboard('{Control>}e{/Control}');
    await expect
      .poll(() => document.querySelector('.cerebro-popup')?.textContent)
      .toContain('No recent files');
    await userEvent.click(q('.playground-recent__edited input'));
    expect(await popupItems()).not.toEqual([]);
    // Other keys are the search field's.
    await userEvent.keyboard('{Shift}x');
    expect(
      (
        q(
          '.cerebro-popup input[type="text"], .cerebro-popup input[type="search"]',
        ) as HTMLInputElement
      ).value,
    ).toBe('x');
  });

  it('lists the files edited at once, as Recently Changed Files', async () => {
    await userEvent.keyboard('{Shift}{Shift}');
    await popupItems();
    await userEvent.keyboard('Recently Changed');
    await expect.poll(popupItems).toContain('Recently Changed Files…');
    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() => document.querySelector('.cerebro-popup')?.textContent)
      .toContain('No recent files');
  });
});

describe('Go to Line', () => {
  it('moves the caret to the line and column typed', async () => {
    await userEvent.click(code() as HTMLElement);
    await userEvent.keyboard('{Control>}g{/Control}');
    const field = (await dialog()).querySelector('input') as HTMLInputElement;
    expect(field.value).toMatch(/^\d+:\d+$/);
    await userEvent.clear(field);
    await userEvent.type(field, 'x');
    expect((await dialog()).textContent).toContain('Not a line or column');
    await userEvent.clear(field);
    await userEvent.type(field, '5:3{Enter}');
    // The status bar follows the caret, and what's selected.
    await expect.poll(() => status()[4]).toBe('5:3');
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await expect.poll(() => status()[4]).toMatch(/^6:\d+ \(\d+ chars, 1 line break\)$/);
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
    await expect.poll(() => status()[4]).toBe('5:3');
  });

  it('is off without an editor’s focus, as IntelliJ’s: its key goes to others', async () => {
    await userEvent.click(q('.playground-files .cerebro-tree-row'));
    await userEvent.keyboard('{Control>}g{/Control}');
    // Nothing asked: no dialog opens.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
    // From the main menu, it's off too.
    await userEvent.click(q('[aria-label="Main Menu"]'));
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    await expect
      .poll(() =>
        [...document.querySelectorAll('.cerebro-menu-item')]
          .find((item) => item.textContent.startsWith('Line/Column'))
          ?.getAttribute('aria-disabled'),
      )
      .toBe('true');
    await userEvent.keyboard('{Escape}{Escape}');
    // The status bar's position goes to a line in the active editor, focused or not, as IntelliJ's.
    await userEvent.click(q('.cerebro-statusbar__item[data-id="position"]'));
    expect(((await dialog()).querySelector('input') as HTMLInputElement).value).toBe('5:3');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.cerebro-dialog')).toBeNull();
  });
});

describe('the status bar’s file items', () => {
  const items = ['position', 'separator', 'encoding', 'indent'];
  const shown = () => items.filter((id) => !q(`.cerebro-statusbar__item[data-id="${id}"]`).hidden);

  it('are a text editor’s: not a diff’s, nor an image’s', async () => {
    expect(shown()).toEqual(items);
    env().editor.open(diffTab('src/main.ts'));
    await expect.poll(shown).toEqual([]);
    env().editor.close(env().editor.activeGroupId, diffTab('src/main.ts').id);
    env().editor.open({ id: 'src/logo.png', title: 'logo.png' });
    await expect.poll(shown).toEqual([]);
    env().editor.close(env().editor.activeGroupId, 'src/logo.png');
    await expect.poll(shown).toEqual(items);
  });

  it('show the indent the settings’ Code Style says, or the file’s own', async () => {
    const global = globalSettings.layers.global;
    const indent = () => q('.cerebro-statusbar__item[data-id="indent"]').textContent;
    expect(indent()).toBe('Tab');
    global.set('editor.detectIndent', false);
    await expect.poll(indent).toBe('4 spaces');
    await userEvent.hover(q('.cerebro-statusbar__item[data-id="indent"]'));
    await expect.poll(tooltipText).toBe('Indent: 4 spaces');
    await userEvent.unhover(q('.cerebro-statusbar__item[data-id="indent"]'));
    global.set('editor.indent', 2);
    await expect.poll(indent).toBe('2 spaces');
    global.set('editor.useTabCharacter', true);
    await expect.poll(indent).toBe('Tab');
    global.reset('editor.useTabCharacter');
    global.reset('editor.indent');
    global.reset('editor.detectIndent');
    await expect.poll(indent).toBe('Tab');
  });

  it('change the indent from its menu, as IntelliJ’s', async () => {
    // A sample, indented with tabs: the settings say 4 spaces.
    const was = env().editor.activeGroup.activeTab as Tab;
    env().editor.open({ id: 'src/styles.css', title: 'styles.css' });
    const item = q('.cerebro-statusbar__item[data-id="indent"]');
    await expect.poll(() => item.textContent).toBe('Tab');
    const heading = () => q('.cerebro-menu-heading').textContent;
    const choose = async (label: string) => {
      await userEvent.click(item);
      await userEvent.click(menuItem(label));
    };
    await userEvent.click(item);
    expect(heading()).toBe('Indents Detection');
    expect(await menuItems()).toEqual([
      'Indent New Lines with 4 Spaces',
      'Reindent File with 4 Spaces',
      'Configure Indents for CSS…',
      'Disable Indents Detection',
    ]);
    await userEvent.keyboard('{Escape}');
    // New lines as the settings say, until the file's own is asked for again.
    await choose('Indent New Lines with 4 Spaces');
    await expect.poll(() => item.textContent).toBe('4 spaces');
    await userEvent.click(item);
    expect(heading()).toBe('Indents Detection');
    expect(await menuItems()).toEqual([
      'Indent New Lines with Tab (detected)',
      'Configure Indents for CSS…',
      'Disable Indents Detection',
    ]);
    await userEvent.click(menuItem('Indent New Lines with Tab (detected)'));
    await expect.poll(() => item.textContent).toBe('Tab');
    // Every line indented again, as the settings say; then that's the file's own.
    const text = () => (documentRead('src/styles.css') as EditorDocument).text.get().toString();
    const before = text();
    await choose('Reindent File with 4 Spaces');
    await expect.poll(text).not.toBe(before);
    expect(text()).not.toContain('\t');
    await expect.poll(() => item.textContent).toBe('4 spaces');
    await userEvent.click(code() as HTMLElement);
    await userEvent.keyboard('{Control>}z{/Control}');
    await expect.poll(text).toBe(before);
    await expect.poll(() => item.textContent).toBe('Tab');
    // Detection, off and on for every file.
    await choose('Disable Indents Detection');
    await expect.poll(() => item.textContent).toBe('4 spaces');
    await userEvent.click(item);
    expect(heading()).toBe('CSS Code Style');
    expect(await menuItems()).toEqual(['Configure Indents for CSS…', 'Enable Indents Detection']);
    await userEvent.click(menuItem('Enable Indents Detection'));
    await expect.poll(() => item.textContent).toBe('Tab');
    globalSettings.layers.global.reset('editor.detectIndent');
    // Code Style, in Settings.
    await choose('Configure Indents for CSS…');
    expect(
      (await dialog()).querySelector('.cerebro-settings__node--selected')?.textContent,
    ).toContain('Code Style');
    await userEvent.keyboard('{Escape}');
    env().editor.open(was);
  });
});

describe('notifications', () => {
  it('show as balloons, and in the Notifications tool window, unread until it was shown', async () => {
    const dot = () => stripe('notifications').querySelector('path')?.getAttribute('d');
    const bell = dot();
    notifications.notify({ title: '1 file committed', content: 'Fix it' });
    await expect
      .poll(() => q('.cerebro-balloons .cerebro-notification__title').textContent)
      .toBe('1 file committed');
    await expect.poll(dot).not.toBe(bell);
    await userEvent.click(stripe('notifications'));
    await expect
      .poll(
        () =>
          document.querySelector(
            '.cerebro-tool-window[data-id="notifications"] .cerebro-notification__content',
          )?.textContent,
      )
      .toBe('Fix it');
    expect(dot()).not.toBe(bell);
    await userEvent.click(stripe('notifications'));
    await expect.poll(dot).toBe(bell);
    notifications.clear();
  });

  it('shows balloons under a dialog, as IntelliJ’s modal dialogs are over its window', async () => {
    notifications.notify({ title: 'Pushed', content: '' });
    await expect.poll(() => q('.cerebro-balloon')).not.toBeNull();
    const box = q('.cerebro-balloon').getBoundingClientRect();
    const open = openDialog({ title: 'Over', content: () => 'x' });
    await dialog();
    // The dialog's layer, which covers the window, is what's under the pointer there.
    const under = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    expect(under?.closest('.cerebro-dialog-layer, .cerebro-balloons')?.className).toBe(
      'cerebro-dialog-layer',
    );
    open.close();
    notifications.clear();
  });
});

describe('the tool windows', () => {
  it('show their content: the Commit window, Agent Changes, a plugin’s, and samples', async () => {
    const shows = async (id: string, text: string) => {
      await userEvent.click(stripe(id));
      await expect
        .poll(() => document.querySelector(`.cerebro-tool-window[data-id="${id}"]`)?.textContent)
        .toContain(text);
      await userEvent.click(stripe(id));
    };
    await shows('commit', 'Commit');
    await shows('agentChanges', 'Agent Changes');
    await shows('notes', 'Notes');
    await shows('structure', 'The structure shows in the desktop app.');
    await shows('services', 'cerebro-status-bar · Services item 1');
    // Commit's and Agent Changes' took the Project window's place.
    await userEvent.click(stripe('project'));
  });

  it('show the Git window for View Commits, after an update', async () => {
    const git = () => document.querySelector('.cerebro-tool-window[data-id="git"]');
    expect(git()).toBeNull();
    viewCommits({ start: 'a1', end: 'b2' });
    await expect.poll(() => git()?.textContent).toContain('The log shows in the desktop app.');
    await userEvent.click(stripe('git'));
    await expect.poll(git).toBeNull();
    // It took the Terminal's place: back, for the tests after.
    await userEvent.click(stripe('terminal'));
  });

  it('show their shortcut in their tooltip', async () => {
    await userEvent.hover(stripe('commit'));
    await expect.poll(tooltipText).toBe('CommitAlt+0');
    await userEvent.unhover(stripe('commit'));
    await userEvent.hover(q('[aria-label^="Search Everywhere"]'));
    await expect.poll(tooltipText).toContain('Search Everywhere');
    await userEvent.unhover(q('[aria-label^="Search Everywhere"]'));
    await userEvent.hover(q('[aria-label^="Settings"]'));
    await expect.poll(tooltipText).toContain('Settings');
    await userEvent.unhover(q('[aria-label^="Settings"]'));
  });
});

describe('the Project tool window', () => {
  const selected = () =>
    document.querySelector('.playground-files .cerebro-tree-row--selected')?.textContent;

  it('selects the opened file, by its button', async () => {
    await userEvent.click(
      q('.cerebro-tool-window[data-id="project"] [aria-label^="Select Opened File"]'),
    );
    await expect.poll(selected).toBe(status()[1]?.split('/').at(-1));
  });

  it('selects the opened file as tabs change, if its Options say, kept if storage allows', async () => {
    const options = q('.cerebro-tool-window[data-id="project"] [aria-label="Options"]');
    await userEvent.hover(options);
    await expect.poll(tooltipText).toBe('Options');
    await userEvent.click(options);
    expect(await menuItems()).toEqual(['Always Select Opened File']);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await userEvent.click(q('.cerebro-menu-item'));
    env().editor.open({ id: 'package.json', title: 'package.json' });
    await expect.poll(selected).toBe('package.json');
    vi.restoreAllMocks();
    await userEvent.click(options);
    await userEvent.click(q('.cerebro-menu-item'));
    expect(localStorage.getItem('cerebro.project.alwaysSelectOpened')).toBe('false');
  });
});

describe('Select In', () => {
  it('selects the file in the Project tool window, from the caret or the window', async () => {
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Alt>}{F1}{/Alt}');
    expect(await menuItems()).toEqual(['1. Project']);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => document.querySelector('.cerebro-menu')).toBeNull();
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Alt>}{F1}{/Alt}');
    expect(await menuItems()).toEqual(['1. Project']);
  });
});

describe('Go to Line, cancelled', () => {
  it('starts from the file’s start when its caret hasn’t moved, and moves nothing', async () => {
    // Asked as it opens, its editor focused.
    env().editor.open({ id: 'src/layout.ts', title: 'layout.ts' });
    (await vi.waitUntil(code)).focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ctrlKey: true }));
    const field = (await dialog()).querySelector('input') as HTMLInputElement;
    expect(field.value).toBe('1:1');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.cerebro-dialog')).toBeNull();
    expect(carets.get('src/layout.ts')).toEqual({ line: 0, column: 0 });
  });
});

describe('the main menu', () => {
  it('opens at File, its commands for the active tab', async () => {
    await userEvent.click(q('[aria-label="Main Menu"]'));
    expect(await menuItems()).toEqual(expect.arrayContaining(['Close Tab']));
  });
});

describe('Save when idle', () => {
  it('is asked how long to wait at each key, as Settings says', async () => {
    globalSettings.layers.global.set('system.saveWhenIdle', true);
    await userEvent.keyboard('{Shift}');
    globalSettings.layers.global.reset('system.saveWhenIdle');
  });
});

describe('Back and Forward', () => {
  it('go by the mouse’s own buttons, when there’s somewhere to go', async () => {
    const button = (which: number) => {
      window.dispatchEvent(new MouseEvent('mouseup', { button: which }));
    };
    const path = env().editor.activeGroup.active as string;
    const line = () => carets.get(path)?.line;
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}g{/Control}');
    await userEvent.keyboard('{Control>}a{/Control}30{Enter}');
    await expect.poll(line).toBe(29);
    // Not another button, nor Forward with nowhere to go.
    button(0);
    button(4);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(line()).toBe(29);
    button(3);
    await expect.poll(line).not.toBe(29);
    button(4);
    await expect.poll(line).toBe(29);
  });

  it('Last Edit Location goes back to where the text was changed, and Next on again', async () => {
    const path = env().editor.activeGroup.active as string;
    const line = () => carets.get(path)?.line;
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}g{/Control}');
    await userEvent.keyboard('{Control>}a{/Control}20{Enter}');
    await expect.poll(line).toBe(19);
    await userEvent.keyboard('x{Backspace}');
    await userEvent.keyboard('{Control>}{Home}{/Control}');
    await expect.poll(line).toBe(0);
    await userEvent.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}');
    await expect.poll(line).toBe(19);
    await userEvent.keyboard('{Control>}{Home}{/Control}');
    // Next, from Find Action: it has no key.
    await userEvent.keyboard('{Control>}{Shift>}a{/Shift}{/Control}');
    await userEvent.keyboard('Next Edit Location');
    await expect.poll(popupItems).toContain('Next Edit Location');
    await userEvent.keyboard('{Enter}');
    await expect.poll(line).toBe(19);
  });
});

describe('saving', () => {
  it('saves every file, by Save All, and as the app asks before it closes', async () => {
    await userEvent.keyboard('{Control>}s{/Control}');
    await (globalThis as unknown as { cerebroSaveAll: () => Promise<void> }).cerebroSaveAll();
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
  });
});

describe('the Project popup’s Open…', () => {
  it('opens a sample file, in a browser', async () => {
    await userEvent.click(q('[aria-label^="Project:"]'));
    expect(await popupItems()).toEqual(['Open…', 'cerebro']);
    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() => document.querySelector('.cerebro-popup')?.getAttribute('aria-label'))
      .toBe('Search Everywhere');
  });
});

describe('the environment tabs', () => {
  it('show once there are two, each named with its file, with their menus', async () => {
    await userEvent.click(q('[aria-label^="Worktree:"]'));
    expect(await popupItems()).toEqual(expect.arrayContaining(['cerebro']));
    const item = [...document.querySelectorAll('.cerebro-popup-item')].find((i) =>
      i.textContent.startsWith('cerebro'),
    ) as HTMLElement;
    await userEvent.click(item);
    const labels = () =>
      [...document.querySelectorAll('.cerebro-env-tab__label')].map((l) => l.textContent);
    const first: unknown = expect.stringMatching(/^cerebro-status-bar – /);
    await expect.poll(labels).toEqual([first, 'cerebro – package.json']);
    // Without a file open, just its name.
    for (const tab of [...env().editor.activeGroup.tabs]) {
      env().editor.close(env().editor.activeGroupId, tab.id);
    }
    await expect.poll(labels).toEqual([first, 'cerebro']);
    expect(q('.playground-editor h1').textContent).toBe('No files open');
    expect(status()[1]).toBe('No file open');
    await userEvent.click(q('.cerebro-env-tab--active'), { button: 'right' });
    expect(await menuItems()).toEqual(expect.arrayContaining(['Close']));
    await closeAll();
    await userEvent.click(q('[aria-label="Open Environment"]'));
    expect(await menuItems()).toEqual(expect.arrayContaining(['cerebro', 'cerebro-status-bar']));
  });
});

describe('the page with nothing open', () => {
  it('says so, in the editor, the tool windows and the status bar', async () => {
    for (const open of [...workspace.open]) workspace.close(open.id);
    await expect
      .poll(() => document.querySelector('.cerebro-env-empty h1')?.textContent)
      .toBe('No environment open');
    expect(status()[0]).toBe('No environment');
    expect(q('.cerebro-tool-window[data-id="terminal"]').textContent).toContain(
      'No environment open',
    );
    await userEvent.click(stripe('structure'));
    await expect
      .poll(() => document.querySelector('.cerebro-tool-window[data-id="structure"]')?.textContent)
      .toBe('StructureNo structure');
    // Nothing to go back or forward to, nor recent files.
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3 }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 4 }));
    await userEvent.keyboard('{Control>}e{/Control}');
    await expect
      .poll(() => document.querySelector('.cerebro-popup')?.textContent)
      .toContain('No recent files');
    await closeAll();
    await userEvent.keyboard('{Shift}{Shift}');
    await popupItems();
    await closeAll();
    // The main menu's commands, with no tab to act on.
    await userEvent.click(q('[aria-label="Main Menu"]'));
    expect(await menuItems()).toEqual(expect.arrayContaining(['Close Tab']));
  });
});
