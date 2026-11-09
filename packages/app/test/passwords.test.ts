import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const handlers = new Map<string, Listener>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, handler: Listener) => {
        handlers.set(channel, handler);
      },
    },
  };
});
vi.mock('electron', () => ({ ipcMain: electron.ipcMain, safeStorage: {} }));

const { installPasswords, PASSWORD_GET, PASSWORD_SET, PasswordStore } =
  await import('../src/passwords.js');

/** A keychain that "encrypts" by reversing, and knows whether it's there. */
function keychain(backend: 'basic_text' | 'gnome_libsecret' = 'gnome_libsecret', available = true) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (text: string) => Buffer.from(text.split('').reverse().join('')),
    decryptString: (data: Buffer) => {
      const text = data.toString();
      if (text === 'garbled') throw new Error('Error while decrypting the ciphertext');
      return text.split('').reverse().join('');
    },
  };
}

const file = () =>
  join(mkdtempSync(join(tmpdir(), 'cerebro-passwords-')), 'data', 'passwords.json');

describe('PasswordStore', () => {
  it('keeps passwords encrypted in its file, for the next start', () => {
    const path = file();
    const store = new PasswordStore(path, keychain(), 'linux');
    expect(store.lasting).toBe(true);
    expect(store.get('Git HTTP:https://ido@h')).toBeNull();
    store.set('Git HTTP:https://ido@h', 'secret');
    expect(store.get('Git HTTP:https://ido@h')).toBe('secret');
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    expect(Buffer.from(saved['Git HTTP:https://ido@h'] as string, 'base64').toString()).toBe(
      'terces',
    );
    expect(new PasswordStore(path, keychain(), 'linux').get('Git HTTP:https://ido@h')).toBe(
      'secret',
    );
    store.set('Git HTTP:https://ido@h', null);
    expect(new PasswordStore(path, keychain(), 'linux').get('Git HTTP:https://ido@h')).toBeNull();
  });

  it('keeps them in memory only without a keychain, as Linux’s basic text', () => {
    const path = file();
    for (const [encryption, platform] of [
      [keychain('basic_text'), 'linux'],
      [keychain('gnome_libsecret', false), 'darwin'],
    ] as const) {
      const store = new PasswordStore(path, encryption, platform);
      expect(store.lasting).toBe(false);
      store.set('k', 'secret');
      expect(store.get('k')).toBe('secret');
      expect(new PasswordStore(path, encryption, platform).get('k')).toBeNull();
      store.set('k', null);
      expect(store.get('k')).toBeNull();
    }
    // Elsewhere than Linux, the keychain is there when it encrypts.
    expect(new PasswordStore(path, keychain('basic_text'), 'win32').lasting).toBe(true);
  });

  it('reads nothing from a file it can’t read, or a password it can’t decrypt', () => {
    const path = file();
    expect(new PasswordStore(path, keychain()).get('k')).toBeNull();
    new PasswordStore(path, keychain()).set('k', 'x');
    writeFileSync(path, '[1]');
    expect(new PasswordStore(path, keychain()).get('0')).toBeNull();
    writeFileSync(path, 'null');
    expect(new PasswordStore(path, keychain()).get('k')).toBeNull();
    writeFileSync(path, JSON.stringify({ k: Buffer.from('garbled').toString('base64'), n: 1 }));
    const store = new PasswordStore(path, keychain());
    expect(store.get('k')).toBeNull();
    expect(store.get('n')).toBeNull();
    // Saved by a keychain that's gone since: not read.
    writeFileSync(path, JSON.stringify({ k: Buffer.from('x').toString('base64') }));
    expect(new PasswordStore(path, keychain('basic_text'), 'linux').get('k')).toBeNull();
  });
});

describe('installPasswords', () => {
  it('lets pages read, keep and forget passwords, ignoring anything else', async () => {
    const store = new PasswordStore(file(), keychain());
    installPasswords(store);
    const get = electron.handlers.get(PASSWORD_GET) as Listener;
    const set = electron.handlers.get(PASSWORD_SET) as Listener;
    await set({}, 'k', 'secret');
    expect(await get({}, 'k')).toEqual({ result: 'secret' });
    await set({}, 'k', 3);
    await set({}, 1, 'x');
    expect(await get({}, 'k')).toEqual({ result: 'secret' });
    expect(await get({}, 1)).toEqual({ result: null });
    await set({}, 'k', null);
    expect(await get({}, 'k')).toEqual({ result: null });
  });
});
