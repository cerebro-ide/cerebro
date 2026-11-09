// The passwords the page remembers for git (the login dialog's Remember), as IntelliJ's
// PasswordSafe: encrypted by the system's keychain (Electron's safeStorage: macOS's Keychain,
// Windows' DPAPI, a secret service on Linux) in a file in the app's data folder. Where there's no
// keychain to use (on Linux, safeStorage's `basic_text`, which Electron's documentation names for a
// desktop it doesn't recognise), they're kept in memory only, until the app quits.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeStorage } from 'electron';
import { handle } from './ipc.js';

export const PASSWORD_GET = 'cerebro:passwords:get';
export const PASSWORD_SET = 'cerebro:passwords:set';

/** What the store needs of Electron's safeStorage. */
export type Encryption = Pick<
  typeof safeStorage,
  'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'
>;

/** Passwords by key, saved encrypted to a file when the system's keychain can encrypt them. */
export class PasswordStore {
  private readonly memory = new Map<string, string>();
  /** Saved, each encrypted, in base64. */
  private saved: Record<string, string> = {};

  constructor(
    private readonly file: string,
    private readonly encryption: Encryption = safeStorage,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    try {
      const read = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (typeof read === 'object' && read !== null) {
        this.saved = Object.fromEntries(
          Object.entries(read).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        );
      }
    } catch {
      // None saved yet, or unreadable: none.
    }
  }

  /** Whether passwords outlast the app: the keychain encrypts them. */
  get lasting(): boolean {
    return (
      this.encryption.isEncryptionAvailable() &&
      (this.platform !== 'linux' || this.encryption.getSelectedStorageBackend() !== 'basic_text')
    );
  }

  get(key: string): string | null {
    const kept = this.memory.get(key);
    if (kept !== undefined) return kept;
    const saved = this.saved[key];
    if (saved === undefined || !this.lasting) return null;
    try {
      return this.encryption.decryptString(Buffer.from(saved, 'base64'));
    } catch {
      // Encrypted by another keychain, or by one whose key changed: gone.
      return null;
    }
  }

  /** Keeps a password, or with null, forgets it. */
  set(key: string, password: string | null): void {
    this.memory.delete(key);
    this.saved = Object.fromEntries(Object.entries(this.saved).filter(([saved]) => saved !== key));
    if (password !== null) {
      if (this.lasting) {
        this.saved[key] = this.encryption.encryptString(password).toString('base64');
      } else {
        this.memory.set(key, password);
      }
    }
    if (this.lasting || password === null) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.saved));
    }
  }
}

/** Lets pages read, keep and forget passwords. */
export function installPasswords(store: PasswordStore): void {
  handle(PASSWORD_GET, (_event, key: unknown) => (typeof key === 'string' ? store.get(key) : null));
  handle(PASSWORD_SET, (_event, key: unknown, password: unknown) => {
    if (typeof key === 'string' && (typeof password === 'string' || password === null)) {
      store.set(key, password);
    }
  });
}
