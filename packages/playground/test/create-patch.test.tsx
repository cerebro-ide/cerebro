import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commonFolder, createPatch, patchName, type PatchRequest } from '../src/create-patch.js';
import { notifications } from '../src/notifications.js';
import { closeAll, dialog, dialogText, FakeHost, press } from './fakes.js';

/** The files there, by path; the folders too. */
const there = new Set<string>();
const host = new FakeHost({
  'fs.exists': (params: { path: string }) => there.has(params.path),
  'git.createPatch': (params: { file?: string }) =>
    params.file === undefined ? { text: 'the patch' } : null,
});

const request: PatchRequest = {
  host,
  worktree: '/r',
  from: 'abc1234',
  to: 'def5678',
  files: ['src/a.ts'],
  changed: ['src/a.ts'],
  message: 'Fix the bug',
};

/** The request, without a message. */
function noMessage(from: PatchRequest): PatchRequest {
  return { ...from, message: undefined };
}

beforeEach(() => {
  there.clear();
  there.add('/r');
  there.add('/r/src');
  host.asked.length = 0;
  localStorage.clear();
});

afterEach(async () => {
  await closeAll();
  vi.restoreAllMocks();
  delete (window as { cerebro?: unknown }).cerebro;
});

const input = async (label: string) =>
  (await dialog()).querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const radio = async (n: number) =>
  [...(await dialog()).querySelectorAll('input[type="radio"]')][n] as HTMLInputElement;
const okButton = async () =>
  [...(await dialog()).querySelectorAll('.cerebro-dialog__button')].find(
    (b) => b.textContent === 'OK',
  ) as HTMLButtonElement;
const alerts = async () =>
  [...(await dialog()).querySelectorAll('[role="alert"]')].map((a) => a.textContent);
const typeIn = async (label: string, text: string) => {
  const field = await input(label);
  await userEvent.clear(field);
  if (text !== '') await userEvent.type(field, text);
};

describe('a patch’s file name', () => {
  it('is the message, what a file name can’t hold, dots and spaces as _, as IntelliJ’s', () => {
    expect(patchName('Fix: the bug.\n\nWhy')).toBe('Fix__the_bug___Why');
    expect(patchName(undefined)).toBe('unnamed');
    expect(patchName('')).toBe('unnamed');
    expect(patchName('x'.repeat(200))).toHaveLength(90);
  });

  it('needs a base path holding the folder of all the changes', () => {
    expect(commonFolder('/r', ['src/a.ts'])).toBe('/r/src');
    expect(commonFolder('/r', ['src/a/b.ts', 'src/c.ts'])).toBe('/r/src');
    expect(commonFolder('/r', ['a.ts', 'src/c.ts'])).toBe('/r');
    expect(commonFolder('C:\\r\\', [])).toBe('C:/r');
  });
});

describe('Create Patch…', () => {
  it('writes the patch to a file named from the message, then offers to show it, as IntelliJ’s', async () => {
    const reveal = vi.fn();
    (window as { cerebro?: unknown }).cerebro = { platform: 'darwin', shell: { reveal } };
    there.add('/r/Fix_the_bug.patch');
    const done = createPatch(request);
    expect((await dialog()).querySelector('.cerebro-dialog__title')?.textContent).toBe(
      'Patch File Settings',
    );
    // The next name not there yet.
    await expect.poll(async () => (await input('To file')).value).toBe('/r/Fix_the_bug1.patch');
    expect((await input('Base path')).value).toBe('/r');
    expect((await radio(0)).checked).toBe(true);
    await userEvent.click((await dialog()).querySelector('input[type="checkbox"]') as HTMLElement);
    await press('OK');
    await expect.poll(dialogText).toContain('Successfully created patch /r/Fix_the_bug1.patch');
    await press('Reveal in Finder');
    await done;
    expect(reveal).toHaveBeenCalledWith('/r/Fix_the_bug1.patch');
    expect(host.params('git.createPatch')).toEqual([
      {
        path: '/r',
        from: 'abc1234',
        to: 'def5678',
        files: ['src/a.ts'],
        base: '/r',
        reverse: true,
        message: 'Fix the bug',
        file: '/r/Fix_the_bug1.patch',
      },
    ]);
  });

  it('asks before writing over a file, and keeps the folder used for next time', async () => {
    there.add('/out');
    there.add('/out/x.patch');
    let done = createPatch(request);
    await typeIn('To file', '/out/x.patch');
    await expect.poll(alerts).toEqual(["A file with the name '/out/x.patch' already exists", '']);
    // A warning: OK stays on.
    expect((await okButton()).disabled).toBe(false);
    await press('OK');
    await expect
      .poll(dialogText)
      .toBe('File x.patch (/out) already exists.Do you want to overwrite it?');
    await press('Cancel');
    await done;
    expect(host.params('git.createPatch')).toEqual([]);
    done = createPatch(request);
    await typeIn('To file', '/out/x.patch');
    await press('OK');
    await press('Overwrite');
    // Without the desktop app, nothing to show it in: only Close; told not to ask again.
    await expect.poll(dialogText).toContain('Successfully created patch /out/x.patch');
    await userEvent.click((await dialog()).querySelector('input[type="checkbox"]') as HTMLElement);
    await press('Close');
    await done;
    expect(host.params('git.createPatch')).toHaveLength(1);
    // The folder kept; the default one isn't.
    done = createPatch(noMessage(request));
    await expect.poll(async () => (await input('To file')).value).toBe('/out/unnamed.patch');
    await typeIn('To file', '/r/y.patch');
    await press('OK');
    await done;
    // Not asked again: the answer, Close, kept.
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
    done = createPatch(request);
    await expect.poll(async () => (await input('To file')).value).toBe('/r/Fix_the_bug.patch');
    await press('Cancel');
    await done;
  });

  it('shows the file unasked once told to, without asking again', async () => {
    const reveal = vi.fn();
    (window as { cerebro?: unknown }).cerebro = { platform: 'linux', shell: { reveal } };
    let done = createPatch(request);
    await press('OK');
    await expect.poll(dialogText).toContain('Successfully created patch');
    await userEvent.click((await dialog()).querySelector('input[type="checkbox"]') as HTMLElement);
    await press('Show in File Manager');
    await done;
    done = createPatch(request);
    await press('OK');
    await done;
    expect(reveal).toHaveBeenCalledTimes(2);
    // Without the desktop app, nowhere to show it.
    delete (window as { cerebro?: unknown }).cerebro;
    done = createPatch(request);
    await press('OK');
    await done;
    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it('copies the patch to the clipboard instead, the choice kept', async () => {
    const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    let done = createPatch(request);
    await userEvent.click(await radio(1));
    expect((await input('To file')).disabled).toBe(true);
    await userEvent.click(await radio(0));
    expect((await input('To file')).disabled).toBe(false);
    await userEvent.click(await radio(1));
    await press('OK');
    await done;
    expect(copied).toHaveBeenCalledWith('the patch');
    expect(notifications.all.get(0)?.title).toBe('Patch copied to clipboard');
    expect(host.params('git.createPatch')[0]).not.toHaveProperty('file');
    done = createPatch(
      noMessage({ host, worktree: '/r', from: 'abc1234', to: 'def5678', changed: [] }),
    );
    expect((await radio(1)).checked).toBe(true);
    await press('OK');
    await done;
    expect(host.params('git.createPatch')[1]).toEqual({
      path: '/r',
      from: 'abc1234',
      to: 'def5678',
      base: '/r',
      reverse: false,
    });
  });

  it('checks its fields as they’re typed in, as IntelliJ’s, OK off while one’s wrong', async () => {
    // Slow to answer, so a check made as one character was typed ends after the next: it's dropped.
    const exists = host.answers['fs.exists'] as (params: { path: string }) => boolean;
    host.answers['fs.exists'] = (params: { path: string }) =>
      new Promise((resolve) =>
        setTimeout(() => {
          resolve(there.has(params.path));
        }, 40),
      );
    onTestFinished(() => {
      host.answers['fs.exists'] = exists;
    });
    void createPatch(request);
    await typeIn('To file', '');
    await expect.poll(alerts).toEqual(['Name cannot be empty', '']);
    expect((await okButton()).disabled).toBe(true);
    await typeIn('To file', `/r/${'x'.repeat(260)}`);
    await expect.poll(alerts).toEqual(['File path should not be too long.', '']);
    // To the clipboard, the file doesn't matter.
    await userEvent.click(await radio(1));
    expect((await okButton()).disabled).toBe(false);
    expect(await alerts()).toEqual(['', '']);
    await typeIn('Base path', '');
    await expect.poll(alerts).toEqual(['', 'Base path cannot be empty!']);
    expect((await okButton()).disabled).toBe(true);
    await typeIn('Base path', '/nowhere');
    await expect.poll(alerts).toEqual(['', "Base dir doesn't exist"]);
    there.add('/r/lib');
    await typeIn('Base path', '/r/lib');
    await expect
      .poll(alerts)
      .toEqual(['', "Base path doesn't contain all selected changes (use /r/src)"]);
    await typeIn('Base path', '/r/src');
    await expect.poll(alerts).toEqual(['', '']);
    expect((await okButton()).disabled).toBe(false);
  });

  it('works where nothing can be kept: to a file, asked each time', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const done = createPatch(request);
    expect((await radio(0)).checked).toBe(true);
    await press('OK');
    await expect.poll(dialogText).toContain('Successfully created patch');
    await press('Close');
    await done;
  });

  it('says why it couldn’t, in IntelliJ’s words', async () => {
    host.answers['git.createPatch'] = () => {
      throw new Error('disk full');
    };
    const done = createPatch(request);
    await press('OK');
    await expect.poll(dialogText).toBe('Error creating patch: disk full');
    await press('OK');
    await done;
    host.answers['git.createPatch'] = () => null;
  });
});
