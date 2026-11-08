import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  Credentials,
  promptUrl,
  setupCredentials,
  type Answer,
  type Prompt,
} from '../src/credentials.js';
import { projects, type ProjectState } from '../src/environments.js';
import { globalSettings, save } from '../src/settings.js';
import { closeAll, dialog, press } from './fakes.js';

/** The app's passwords, in a map. */
function store() {
  const kept = new Map<string, string>();
  return {
    kept,
    get: vi.fn((key: string) => Promise.resolve(kept.get(key) ?? null)),
    set: vi.fn((key: string, password: string | null) => {
      if (password === null) kept.delete(key);
      else kept.set(key, password);
      return Promise.resolve();
    }),
  };
}

let sessions = 0;
const prompt = (text: string, more: Partial<Prompt> = {}): Prompt => ({
  id: '1',
  session: String(sessions),
  kind: 'git',
  prompt: text,
  silent: false,
  helper: false,
  ...more,
});
const USERNAME = "Username for 'https://h:8080': ";
const PASSWORD = "Password for 'https://ido@h:8080': ";
const KEY = 'Git HTTP:https://ido@h:8080';

const title = async () =>
  (await dialog()).querySelector('.cerebro-dialog__title')?.textContent ?? '';
const inputs = async () => [...(await dialog()).querySelectorAll<HTMLInputElement>('input')];
const field = async (label: string) =>
  [...(await dialog()).querySelectorAll('.playground-form__row')]
    .find((row) => row.querySelector('span')?.textContent === label)
    ?.querySelector('input') as HTMLInputElement;
const errors = async () =>
  [...(await dialog()).querySelectorAll('.cerebro-dialog-field__error')].map((e) => e.textContent);
const check = async (label: string) =>
  [...(await dialog()).querySelectorAll('.playground-form__check')]
    .find((row) => row.textContent === label)
    ?.querySelector('input') as HTMLInputElement;

beforeEach(() => {
  sessions++;
  localStorage.removeItem('cerebro.git.logins');
});

afterEach(async () => {
  await closeAll();
});

describe('promptUrl', () => {
  it('reads the URL from git’s prompt, as IntelliJ does', () => {
    expect(promptUrl(USERNAME)).toBe('https://h:8080');
    expect(promptUrl("Password for 'https://ido@h':")).toBe('https://ido@h');
    expect(promptUrl('Password for https://h')).toBe('https://h');
    expect(promptUrl('Password:')).toBe('');
  });
});

describe('over HTTP', () => {
  it('logs in with the dialog, then answers from what it kept', async () => {
    const passwords = store();
    const credentials = new Credentials(passwords, vi.fn());
    const asking = credentials.answer('/p', prompt(USERNAME));
    expect(await title()).toBe('Log In to h:8080');
    // The username first, while it's blank; OK says what's missing.
    expect(document.activeElement).toBe(await field('Username:'));
    await press('Log In').catch(() => undefined);
    expect(await errors()).toEqual(['Username cannot be empty', '']);
    await userEvent.type(await field('Username:'), 'ido');
    expect(await errors()).toEqual(['', '']);
    await press('Log In').catch(() => undefined);
    expect(await errors()).toEqual(['', 'Password cannot be empty']);
    await userEvent.type(await field('Password:'), 'secret');
    expect((await check('Remember')).checked).toBe(true);
    await press('Log In');
    expect(await asking).toEqual({ answer: 'ido' });
    // The password given with it, unasked; kept, as Remember was ticked.
    expect(await credentials.answer('/p', prompt(PASSWORD))).toEqual({ answer: 'secret' });
    expect(passwords.kept.get(KEY)).toBe('secret');
    await credentials.done('/p', String(sessions), false);
    // Next time, the login remembered for the URL, and its password: nothing asked.
    sessions++;
    expect(await credentials.answer('/p', prompt(USERNAME))).toEqual({ answer: 'ido' });
    expect(await credentials.answer('/p', prompt(PASSWORD))).toEqual({ answer: 'secret' });
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
    // A command that never asked, or ends twice: nothing to do.
    await credentials.done('/p', 'other', true);
  });

  it('forgets a password whose login failed, and asks again with the login filled in', async () => {
    const passwords = store();
    passwords.kept.set(KEY, 'old');
    localStorage.setItem('cerebro.git.logins', JSON.stringify({ 'https://h:8080': 'ido' }));
    const credentials = new Credentials(passwords, vi.fn());
    expect(await credentials.answer('/p', prompt(USERNAME))).toEqual({ answer: 'ido' });
    await credentials.done('/p', String(sessions), true);
    expect(passwords.kept.has(KEY)).toBe(false);
    sessions++;
    const asking = credentials.answer('/p', prompt(USERNAME));
    expect((await field('Username:')).value).toBe('ido');
    // The password next, as the username is there.
    await expect.poll(async () => document.activeElement === (await field('Password:'))).toBe(true);
    await userEvent.type(await field('Password:'), 'new');
    await userEvent.click(await check('Remember'));
    await press('Log In');
    expect(await asking).toEqual({ answer: 'ido' });
    // Not remembered: kept until the app quits, not in the app's store.
    expect(passwords.kept.has(KEY)).toBe(false);
    sessions++;
    expect(await credentials.answer('/p', prompt(PASSWORD))).toEqual({ answer: 'new' });
  });

  it('asks for a password with the login git gave it, not to be changed', async () => {
    const credentials = new Credentials(store(), vi.fn());
    const asking = credentials.answer('/p', prompt(PASSWORD));
    expect((await field('Username:')).value).toBe('ido');
    expect((await field('Username:')).readOnly).toBe(true);
    await userEvent.type(await field('Password:'), 'secret');
    await press('Log In');
    expect(await asking).toEqual({ answer: 'secret' });
    // Cancelled: nothing.
    sessions++;
    const cancelled = credentials.answer('/p', prompt("Password for 'https://h': "));
    expect((await field('Username:')).readOnly).toBe(false);
    await press('Cancel');
    expect(await cancelled).toEqual({ answer: null });
  });

  it('answers silent prompts only with what it kept', async () => {
    const passwords = store();
    const credentials = new Credentials(passwords, vi.fn());
    const silent = { silent: true };
    expect(await credentials.answer('/p', prompt(USERNAME, silent))).toEqual({ answer: null });
    expect(await credentials.answer('/p', prompt(PASSWORD, silent))).toEqual({ answer: null });
    passwords.kept.set(KEY, 'secret');
    expect(await credentials.answer('/p', prompt(PASSWORD, silent))).toEqual({
      answer: 'secret',
    });
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
  });

  it('offers git’s credential helper when git has one', async () => {
    const useHelper = vi.fn();
    const credentials = new Credentials(store(), useHelper);
    const asking = credentials.answer('/p', prompt(USERNAME, { helper: true }));
    await userEvent.click(await check('Use credentials helper'));
    expect((await field('Username:')).disabled).toBe(true);
    // Back and forth.
    await userEvent.click(await check('Enter credentials'));
    expect((await field('Username:')).disabled).toBe(false);
    await userEvent.click(await check('Use credentials helper'));
    await press('Log In');
    expect(await asking).toEqual({ answer: null, useCredentialHelper: true });
    expect(useHelper).toHaveBeenCalled();
    // From the password's prompt too.
    sessions++;
    const password = credentials.answer('/p', prompt(PASSWORD, { helper: true }));
    await userEvent.click(await check('Use credentials helper'));
    await press('Log In');
    expect(await password).toEqual({ answer: null, useCredentialHelper: true });
  });

  it('answers nothing when it can’t read what it kept', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const passwords = store();
    passwords.get.mockRejectedValue(new Error('locked'));
    const credentials = new Credentials(passwords, vi.fn());
    expect(await credentials.answer('/p', prompt(PASSWORD))).toEqual({ answer: null });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('reads the logins it remembered, unless they’re unreadable', async () => {
    localStorage.setItem('cerebro.git.logins', '{');
    const credentials = new Credentials(store(), vi.fn());
    const asking = credentials.answer('/p', prompt('Username for nowhere: '));
    expect(await title()).toBe('Log In to nowhere');
    await press('Cancel');
    expect(await asking).toEqual({ answer: null });
  });
});

describe('over SSH', () => {
  const ssh = (text: string, more: Partial<Prompt> = {}) => prompt(text, { kind: 'ssh', ...more });
  const PASSPHRASE = "Enter passphrase for key '/home/i/.ssh/id_ed25519': ";

  it('asks for a key’s passphrase, keeps it, and forgets it when asked again', async () => {
    const passwords = store();
    const credentials = new Credentials(passwords, vi.fn());
    const asking = credentials.answer('/p', ssh(PASSPHRASE));
    expect(await title()).toBe('SSH Key Passphrase');
    expect((await dialog()).textContent).toContain(
      'Password for the SSH key "/home/i/.ssh/id_ed25519":',
    );
    expect((await check('Remember')).closest('label')?.title).toBe(
      'The password will be stored between application sessions.',
    );
    await userEvent.type((await inputs())[0] as HTMLInputElement, 'phrase');
    await press('OK');
    expect(await asking).toEqual({ answer: 'phrase' });
    expect(passwords.kept.get('SSH Key Passphrase:/home/i/.ssh/id_ed25519')).toBe('phrase');
    // Done, it worked: no login to remember over SSH.
    await credentials.done('/p', String(sessions), false);
    expect(localStorage.getItem('cerebro.git.logins')).toBeNull();
    // Next time, kept.
    sessions++;
    expect(await credentials.answer('/p', ssh(PASSPHRASE))).toEqual({ answer: 'phrase' });
    // Asked again in the same command: it didn't do.
    const again = credentials.answer('/p', ssh(PASSPHRASE));
    await dialog();
    expect(passwords.kept.size).toBe(0);
    await press('Cancel');
    expect(await again).toEqual({ answer: null });
    // Not remembered: until the app quits.
    sessions++;
    const once = credentials.answer('/p', ssh(PASSPHRASE));
    await userEvent.type((await inputs())[0] as HTMLInputElement, 'other');
    await userEvent.click(await check('Remember'));
    await press('OK');
    expect(await once).toEqual({ answer: 'other' });
    expect(passwords.kept.size).toBe(0);
    sessions++;
    expect(await credentials.answer('/p', ssh(PASSPHRASE))).toEqual({ answer: 'other' });
  });

  it('asks for a user’s password, or a PIN, in their own dialogs', async () => {
    const credentials = new Credentials(store(), vi.fn());
    for (const [text, heading, label] of [
      ["ido@h's password: ", 'SSH Password Login', 'Password for user ido@h:'],
      ["Enter PIN for 'token': ", 'SSH Pin Passphrase', 'PIN for "token":'],
      ['Enter passphrase for /k: ', 'SSH Key Passphrase', 'Password for the SSH key "/k":'],
    ]) {
      const asking = credentials.answer('/p', ssh(text as string));
      expect(await title()).toBe(heading);
      expect((await dialog()).textContent).toContain(label);
      await press('Cancel');
      expect(await asking).toEqual({ answer: null });
    }
    expect(await credentials.answer('/p', ssh("ido@h's password: ", { silent: true }))).toEqual({
      answer: null,
    });
  });

  it('asks about a host’s authenticity as Yes or No', async () => {
    const credentials = new Credentials(store(), vi.fn());
    const question =
      "The authenticity of host 'h (1.2.3.4)' can't be established.\n" +
      'Are you sure you want to continue connecting (yes/no/[fingerprint])? ';
    const yes = credentials.answer('/p', ssh(question));
    expect(await title()).toBe('SSH Confirmation');
    expect((await dialog()).querySelector('.playground-ssh-question')?.textContent).toBe(
      "The authenticity of host 'h (1.2.3.4)' can't be established.\n" +
        'Are you sure you want to continue connecting?',
    );
    await press('Yes');
    expect(await yes).toEqual({ answer: 'yes' });
    const no = credentials.answer('/p', ssh(question));
    await press('No');
    expect(await no).toEqual({ answer: 'no' });
    expect(await credentials.answer('/p', ssh(question, { silent: true }))).toEqual({
      answer: null,
    });
  });

  it('asks anything else in a dialog of its own, not kept', async () => {
    const credentials = new Credentials(store(), vi.fn());
    const asking = credentials.answer('/p', ssh('Verification code: '));
    expect(await title()).toBe('SSH Keyboard Interactive');
    expect((await dialog()).textContent).toContain('Verification code:');
    expect(await inputs()).toHaveLength(1);
    await userEvent.type((await inputs())[0] as HTMLInputElement, '123');
    await press('OK');
    expect(await asking).toEqual({ answer: '123' });
    const cancelled = credentials.answer('/p', ssh('Verification code: '));
    await press('Cancel');
    expect(await cancelled).toEqual({ answer: null });
    expect(await credentials.answer('/p', ssh('Code: ', { silent: true }))).toEqual({
      answer: null,
    });
  });
});

describe('setupCredentials', () => {
  it('answers the hosts’ prompts, and tells them whether to use git’s helper', async () => {
    type Listener = (project: string, method: string, params: unknown) => void;
    const listeners: Listener[] = [];
    const request = vi.fn<(project: string, method: string, params?: unknown) => Promise<unknown>>(
      () => Promise.resolve(null),
    );
    const passwords = store();
    passwords.kept.set(KEY, 'secret');
    const saved = projects.peek();
    projects.set([{ path: '/p' } as ProjectState]);
    setupCredentials({
      passwords,
      host: {
        request,
        onNotification: (listener: Listener) => {
          listeners.push(listener);
          return () => undefined;
        },
      },
    } as unknown as NonNullable<Window['cerebro']>);
    expect(request).toHaveBeenCalledWith('/p', 'askpass.configure', {
      useCredentialHelper: false,
    });
    const notify = (method: string, params: unknown) => {
      for (const listener of listeners) listener('/p', method, params);
    };
    notify('askpass.prompt', { ...prompt(PASSWORD), id: '9' });
    await expect
      .poll(() => request.mock.calls.find(([, method]) => method === 'askpass.answer'))
      .toEqual([
        '/p',
        'askpass.answer',
        { id: '9', answer: 'secret' } satisfies Answer & {
          id: string;
        },
      ]);
    notify('askpass.done', { session: String(sessions), failed: true });
    await expect.poll(() => passwords.kept.has(KEY)).toBe(false);
    notify('agent.status', {});
    // The login dialog's Use credentials helper turns the setting on, for every host.
    // Hosts that are gone meanwhile: nobody to tell.
    request.mockRejectedValueOnce(new Error('host gone')).mockRejectedValueOnce(new Error('gone'));
    sessions++;
    notify('askpass.prompt', { ...prompt(USERNAME, { helper: true }), id: '10' });
    await userEvent.click(await check('Use credentials helper'));
    await press('Log In');
    await expect
      .poll(() => request.mock.calls.filter(([, method]) => method === 'askpass.configure').at(-1))
      .toEqual(['/p', 'askpass.configure', { useCredentialHelper: true }]);
    expect(globalSettings.get('git.useCredentialHelper')).toBe(true);
    globalSettings.layers.global.reset('git.useCredentialHelper');
    save(globalSettings, ['global']);
    projects.set(saved);
  });
});
