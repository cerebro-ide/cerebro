// Credentials for git's remote commands, as IntelliJ asks for them: the host's askpass prompts
// (packages/host/src/askpass.ts) answered from the passwords kept, or else a dialog.
//
// Over HTTP, as IntelliJ's GitHttpGuiAuthenticator: git asks for a username, then a password. The
// username's prompt shows the login dialog ("Log In to host", Username, Password, Remember), whose
// password then answers the password's prompt; a login remembered for the URL, with its password
// kept, answers both without asking. A password kept by Remember is in the app's keychain-backed
// store (packages/app/src/passwords.ts), else in memory until the app quits (IntelliJ's
// PasswordSafe, not remembered). When git has a credential helper, the dialog offers it (Use
// credentials helper), which turns on the setting; a login that failed forgets its password.
//
// Over SSH, as IntelliJ's NativeSshGuiAuthenticator: a key's passphrase, a user's password, or a
// PIN, each in its dialog with Remember; asked for the same again in one command, what was kept is
// forgotten. A host's authenticity is a Yes/No question; any other prompt, a dialog of its own.
//
// Silent prompts (the host's checks of a remote) take only what's kept.

import { effect, signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { projects } from './environments.js';
import { globalSettings, save } from './settings.js';

/** A prompt from a host's askpass: the host's `askpass.prompt`. */
export interface Prompt {
  id: string;
  session: string;
  kind: 'git' | 'ssh';
  prompt: string;
  silent: boolean;
  helper: boolean;
}

/** What answers it: the host's `askpass.answer`. */
export interface Answer {
  answer: string | null;
  useCredentialHelper?: boolean;
}

/** The app's passwords (window.cerebro.passwords). */
export interface Passwords {
  get(key: string): Promise<string | null>;
  set(key: string, password: string | null): Promise<unknown>;
}

/** What a command asked for, while it runs. */
interface Session {
  /** The password the login dialog gave with the username, for the password's prompt. */
  password?: { key: string; value: string };
  /** The keys of the HTTP passwords given, forgotten if the login fails. */
  given: string[];
  /** The login to remember for a URL, once it works. */
  login?: { url: string; login: string };
  /** The SSH prompt asked last, by its key. */
  lastKey?: string;
}

/** IntelliJ's GitRememberedInputs: the login last used for each URL. */
const LOGINS = 'cerebro.git.logins';

function logins(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LOGINS) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** The URL in git's prompt, as IntelliJ's GitHttpAuthService reads it: its third word. */
export function promptUrl(prompt: string): string {
  let word = prompt.split(' ')[2] ?? '';
  if (word.endsWith(':')) word = word.slice(0, -1);
  return word.replace(/^'(.*)'$/, '$1');
}

/** A URL without its login, and the login. */
function splitLogin(url: string): { url: string; login: string } {
  try {
    const parsed = new URL(url);
    const login = decodeURIComponent(parsed.username);
    parsed.username = '';
    parsed.password = '';
    return { url: parsed.href.replace(/\/$/, ''), login };
  } catch {
    return { url, login: '' };
  }
}

/** A password's key in the store, as IntelliJ's: the service, and the URL with its login. */
function httpKey(url: string, login: string): string {
  const at = url.indexOf('://');
  return `Git HTTP:${url.slice(0, at + 3)}${encodeURIComponent(login)}@${url.slice(at + 3)}`;
}

/** IntelliJ's SshPrompts: what OpenSSH asks for, and the dialog that asks the user. */
const SSH_PROMPTS = [
  {
    pattern: /^\r?Enter passphrase for(?: key)? '?([^']*)'?:\s?$/,
    title: 'SSH Key Passphrase',
    label: (subject: string) => `Password for the SSH key "${subject}":`,
    service: 'SSH Key Passphrase',
  },
  {
    pattern: /^(.*)'s password:\s?$/,
    title: 'SSH Password Login',
    label: (subject: string) => `Password for user ${subject}:`,
    service: 'SSH Password',
  },
  {
    pattern: /^\r?Enter PIN for '?([^']*)'?:\s?$/,
    title: 'SSH Pin Passphrase',
    label: (subject: string) => `PIN for "${subject}":`,
    service: 'SSH PIN',
  },
];

const CONFIRMATION = 'Are you sure you want to continue connecting';

/** The login dialog's result. */
type Login = { login: string; password: string; remember: boolean } | 'helper';

/**
 * Answers the hosts' prompts, by project and session. `useCredentialHelper` turns on IntelliJ's
 * setting, chosen in the login dialog.
 */
export class Credentials {
  /** Passwords given without Remember: until the app quits. */
  private readonly memory = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly passwords: Passwords,
    private readonly useCredentialHelper: () => void,
  ) {}

  /** Answers a prompt; with null when cancelled, or when nothing kept answers a silent one. */
  async answer(project: string, prompt: Prompt): Promise<Answer> {
    const id = `${project}\n${prompt.session}`;
    const session = this.sessions.get(id) ?? { given: [] };
    this.sessions.set(id, session);
    try {
      return prompt.kind === 'git'
        ? await this.http(session, prompt)
        : { answer: await this.ssh(session, prompt) };
    } catch (error) {
      console.error('Couldn’t answer git’s prompt:', error);
      return { answer: null };
    }
  }

  /** A command that asked has ended: a failed login forgets the passwords it was given. */
  async done(project: string, session: string, failed: boolean): Promise<void> {
    const id = `${project}\n${session}`;
    const state = this.sessions.get(id);
    this.sessions.delete(id);
    if (!state) return;
    if (failed) {
      for (const key of state.given) await this.forget(key);
    } else if (state.login) {
      localStorage.setItem(
        LOGINS,
        JSON.stringify({ ...logins(), [state.login.url]: state.login.login }),
      );
    }
  }

  private async http(session: Session, prompt: Prompt): Promise<Answer> {
    const { url, login } = splitLogin(promptUrl(prompt.prompt));
    if (prompt.prompt.toLowerCase().startsWith('username')) {
      // IntelliJ's askUsername: the login and password at once.
      const remembered = logins()[url];
      if (remembered !== undefined) {
        const kept = await this.kept(httpKey(url, remembered));
        if (kept !== null) {
          this.give(session, url, remembered, kept);
          return { answer: remembered };
        }
      }
      if (prompt.silent) return { answer: null };
      return this.logIn(session, url, remembered ?? '', true, prompt.helper, 'login');
    }
    // Its askPassword: for the login git was given, or that's in the URL.
    const key = httpKey(url, login);
    if (session.password?.key === key) return { answer: session.password.value };
    const kept = await this.kept(key);
    if (kept !== null) {
      this.give(session, url, login, kept);
      return { answer: kept };
    }
    if (prompt.silent) return { answer: null };
    return this.logIn(session, url, login, login === '', prompt.helper, 'password');
  }

  /**
   * Asks with the login dialog, answering the username or the password, as git asked; the
   * password is kept for the prompt that follows the username's.
   */
  private async logIn(
    session: Session,
    url: string,
    login: string,
    editable: boolean,
    helper: boolean,
    asked: 'login' | 'password',
  ): Promise<Answer> {
    const result = await loginDialog(url, login, editable, helper);
    if (result === undefined) return { answer: null };
    if (result === 'helper') {
      this.useCredentialHelper();
      return { answer: null, useCredentialHelper: true };
    }
    const key = httpKey(url, result.login);
    await this.keep(key, result.password, result.remember);
    this.give(session, url, result.login, result.password);
    return { answer: asked === 'login' ? result.login : result.password };
  }

  private give(session: Session, url: string, login: string, password: string): void {
    const key = httpKey(url, login);
    session.password = { key, value: password };
    session.given.push(key);
    session.login = { url, login };
  }

  private async ssh(session: Session, prompt: Prompt): Promise<string | null> {
    const text = prompt.prompt;
    if (text.includes(CONFIRMATION)) {
      if (prompt.silent) return null;
      return (await confirm(text)) ? 'yes' : 'no';
    }
    for (const known of SSH_PROMPTS) {
      const match = known.pattern.exec(text);
      if (!match) continue;
      const subject = match[1] as string;
      const key = `${known.service}:${subject}`;
      // Asked again: what was kept didn't do.
      if (session.lastKey === key) await this.forget(key);
      session.lastKey = key;
      const kept = await this.kept(key);
      if (kept !== null) return kept;
      if (prompt.silent) return null;
      const result = await passwordDialog(known.title, known.label(subject), true);
      if (result === undefined) return null;
      await this.keep(key, result.password, result.remember);
      return result.password;
    }
    if (prompt.silent) return null;
    return (await passwordDialog('SSH Keyboard Interactive', text.trim(), false))?.password ?? null;
  }

  private async kept(key: string): Promise<string | null> {
    return this.memory.get(key) ?? (await this.passwords.get(key));
  }

  private async keep(key: string, password: string, remember: boolean): Promise<void> {
    if (remember) {
      this.memory.delete(key);
      await this.passwords.set(key, password);
    } else {
      this.memory.set(key, password);
    }
  }

  private async forget(key: string): Promise<void> {
    this.memory.delete(key);
    await this.passwords.set(key, null);
  }
}

/**
 * IntelliJ's GitHttpLoginDialog: "Log In to host", Username, Password and Remember; with git's
 * credential helper configured, Enter credentials or Use credentials helper. OK says what's
 * missing.
 */
function loginDialog(
  url: string,
  initialLogin: string,
  editable: boolean,
  helper: boolean,
): Promise<Login | undefined> {
  const login = signal(initialLogin);
  const password = signal('');
  const remember = signal(true);
  const useHelper = signal(false);
  const loginError = signal<string | undefined>(undefined);
  const passwordError = signal<string | undefined>(undefined);
  const field = (
    label: string,
    value: typeof login,
    error: typeof loginError,
    type: 'text' | 'password',
    first: boolean,
  ) => (
    <label class="playground-form__row">
      <span>{label}</span>
      <input
        class={() =>
          error.get() === undefined
            ? 'cerebro-dialog-field__input'
            : 'cerebro-dialog-field__input cerebro-dialog-field__input--invalid'
        }
        type={type}
        spellcheck={false}
        value={value.peek()}
        readOnly={type === 'text' && !editable}
        disabled={() => useHelper.get()}
        aria-invalid={() => String(error.get() !== undefined)}
        ref={(input) => {
          if (!first) return;
          queueMicrotask(() => {
            input.focus();
          });
        }}
        on:input={(event) => {
          value.set((event.currentTarget as HTMLInputElement).value);
          error.set(undefined);
        }}
      />
      <span class="cerebro-dialog-field__error" role="alert">
        {() => error.get() ?? ''}
      </span>
    </label>
  );
  const choice = (label: string, helperChoice: boolean) => (
    <label class="playground-form__check">
      <input
        type="radio"
        name="playground-login-mode"
        checked={useHelper.peek() === helperChoice}
        on:change={() => {
          useHelper.set(helperChoice);
        }}
      />
      {label}
    </label>
  );
  // As IntelliJ's: the focus in the username while it's blank, else in the password.
  const loginFirst = initialLogin === '';
  return openDialog<Login>({
    title: `Log In to ${url.replace(/^[a-z]+:\/\//i, '')}`,
    width: 420,
    ok: {
      label: 'Log In',
      check: () => {
        if (useHelper.peek()) return Promise.resolve(true);
        if (login.peek() === '') loginError.set('Username cannot be empty');
        else if (password.peek() === '') passwordError.set('Password cannot be empty');
        return Promise.resolve(login.peek() !== '' && password.peek() !== '');
      },
      accept: () =>
        useHelper.peek()
          ? 'helper'
          : { login: login.peek(), password: password.peek(), remember: remember.peek() },
    },
    content: () => (
      <div class="playground-form">
        {helper ? choice('Enter credentials', false) : null}
        {field('Username:', login, loginError, 'text', loginFirst)}
        {field('Password:', password, passwordError, 'password', !loginFirst)}
        <label class="playground-form__check">
          <input
            type="checkbox"
            checked={remember.peek()}
            disabled={() => useHelper.get()}
            on:change={(event) => {
              remember.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Remember
        </label>
        {helper ? choice('Use credentials helper', true) : null}
      </div>
    ),
  }).result;
}

/** IntelliJ's askPassword (credentialPromt.kt): the prompt, a password field, and Remember. */
function passwordDialog(
  title: string,
  label: string,
  rememberable: boolean,
): Promise<{ password: string; remember: boolean } | undefined> {
  const password = signal('');
  const remember = signal(true);
  return openDialog<{ password: string; remember: boolean }>({
    title,
    width: 420,
    ok: { accept: () => ({ password: password.peek(), remember: remember.peek() }) },
    content: () => (
      <div class="playground-form">
        <label class="playground-form__row">
          <span>{label}</span>
          <input
            class="cerebro-dialog-field__input"
            type="password"
            ref={(input) => {
              queueMicrotask(() => {
                input.focus();
              });
            }}
            on:input={(event) => {
              password.set((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
        {rememberable ? (
          <label
            class="playground-form__check"
            title="The password will be stored between application sessions."
          >
            <input
              type="checkbox"
              checked={remember.peek()}
              on:change={(event) => {
                remember.set((event.currentTarget as HTMLInputElement).checked);
              }}
            />
            Remember
          </label>
        ) : null}
      </div>
    ),
  }).result;
}

/** IntelliJ's SSH Confirmation: OpenSSH's question, its options left out, as Yes or No. */
async function confirm(question: string): Promise<boolean> {
  const message = question.replace(/\s*\(yes\/no[^)]*\)\s*\??\s*$/, '?');
  const yes = await openDialog<true>({
    title: 'SSH Confirmation',
    width: 520,
    ok: { label: 'Yes', accept: () => true },
    cancelLabel: 'No',
    content: () => <p class="playground-ssh-question">{message}</p>,
  }).result;
  return yes === true;
}

/**
 * Answers the hosts' prompts in the app, and tells them whether to use git's credential helper, as
 * the setting says.
 */
export function setupCredentials(app: NonNullable<Window['cerebro']>): void {
  const credentials = new Credentials(app.passwords, () => {
    globalSettings.layers.global.set('git.useCredentialHelper', true);
    save(globalSettings, ['global']);
  });
  app.host.onNotification((project, method, params) => {
    if (method === 'askpass.prompt') {
      const prompt = params as Prompt;
      void credentials.answer(project, prompt).then((answer) =>
        app.host.request(project, 'askpass.answer', { id: prompt.id, ...answer }).catch(() => {
          // The host is gone, and its git with it.
        }),
      );
    } else if (method === 'askpass.done') {
      const { session, failed } = params as { session: string; failed: boolean };
      void credentials.done(project, session, failed);
    }
  });
  effect(() => {
    const useCredentialHelper = globalSettings.get('git.useCredentialHelper') === true;
    for (const project of projects.get()) {
      void app.host
        .request(project.path, 'askpass.configure', { useCredentialHelper })
        .catch(() => undefined);
    }
  });
}
