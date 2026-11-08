import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { socketPath } from '../src/agents.js';
import {
  AskPass,
  askPassClient,
  authFailed,
  listenForAskPass,
  writeAskPassScripts,
  type Answer,
  type Prompt,
} from '../src/askpass.js';
import { git, type Git } from '../src/git.js';
import { gitServer } from './git-server.js';

describe('asking for credentials, with real git over HTTP', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-askpass-')));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  const socket = socketPath();
  const client = join(import.meta.dirname, 'fixtures', 'askpass-client.mjs');
  const scripts = writeAskPassScripts([process.execPath, client]);
  /** What the page is asked, and the answers it gives, in turn. */
  let prompts: Prompt[] = [];
  let answers: Answer[] = [];
  let done: boolean[] = [];
  const askPass = new AskPass({
    socket,
    scripts,
    prompt: (prompt) => {
      prompts.push(prompt);
      return Promise.resolve(answers.shift() ?? { answer: null });
    },
    done: (_session, failed) => done.push(failed),
  });
  const listener = listenForAskPass(socket, (message) => askPass.ask(message, git));
  const servers: Server[] = [];
  /** A repository cloned, without a password, from one served at `url/<name>.git`. */
  const setUp = async (name: string) => {
    run(root, 'init', '-q', '--bare', '-b', 'main', `${name}.git`);
    const repo = join(root, name);
    run(root, 'init', '-q', '-b', 'main', repo);
    run(
      repo,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'first',
    );
    const { url, server } = await gitServer(root, 'ido', 'secret');
    servers.push(server);
    run(repo, 'remote', 'add', 'origin', `${url}/${name}.git`);
    prompts = [];
    answers = [];
    done = [];
    return { repo, url, remote: join(root, `${name}.git`) };
  };

  afterAll(() => {
    listener.close();
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(scripts.folder, { recursive: true, force: true });
  });

  it('asks the page for a username and a password, and pushes with them', async () => {
    const { repo, url, remote } = await setUp('push');
    answers = [{ answer: 'ido' }, { answer: 'secret' }];
    await askPass.git(git)(repo, ['push', '-q', 'origin', 'main']);
    const host = url.slice('http://'.length);
    expect(prompts).toEqual([
      expect.objectContaining({ kind: 'git', prompt: `Username for '${url}': ` }),
      expect.objectContaining({ kind: 'git', prompt: `Password for 'http://ido@${host}': ` }),
    ]);
    expect(prompts[0]).toMatchObject({ silent: false, helper: false });
    expect(run(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('first');
    // Done, and it worked: the page may keep the password.
    expect(done).toEqual([false]);
  });

  it('asks once more after a wrong password, which the page forgets', async () => {
    const { repo } = await setUp('wrong');
    answers = [{ answer: 'ido' }, { answer: 'guess' }, { answer: 'ido' }, { answer: 'secret' }];
    await askPass.git(git)(repo, ['ls-remote', 'origin']);
    expect(prompts).toHaveLength(4);
    expect(done).toEqual([true, false]);
  });

  it('gives up after two wrong passwords, with git’s words', async () => {
    const { repo } = await setUp('twice');
    answers = [{ answer: 'ido' }, { answer: 'a' }, { answer: 'ido' }, { answer: 'b' }];
    await expect(askPass.git(git)(repo, ['ls-remote', 'origin'])).rejects.toThrow(
      /Authentication failed/,
    );
    expect(done).toEqual([true, true]);
  });

  it('stops when the page cancels, without calling it a failed login', async () => {
    // Git asks for the password after a cancelled username: answered nothing, the page unasked.
    const { repo } = await setUp('cancel');
    answers = [{ answer: null }];
    await expect(askPass.git(git)(repo, ['ls-remote', 'origin'])).rejects.toThrow();
    expect(prompts).toHaveLength(1);
    expect(done).toEqual([false]);
  });

  it('asks silently when told to, and doesn’t retry', async () => {
    const { repo } = await setUp('silent');
    answers = [{ answer: 'ido' }, { answer: 'guess' }];
    await expect(askPass.git(git, true)(repo, ['ls-remote', 'origin'])).rejects.toThrow();
    expect(prompts.map((p) => p.silent)).toEqual([true, true]);
    expect(done).toEqual([true]);
  });

  it('leaves git’s credential helper out, until the page says to use it', async () => {
    const { repo, url } = await setUp('helper');
    // A helper that knows the password, as a keychain's would.
    const helper = join(root, 'helper.sh');
    execFileSync('sh', [
      '-c',
      `printf '#!/bin/sh\\necho username=ido\\necho password=secret\\n' > ${helper}; chmod +x ${helper}`,
    ]);
    run(repo, 'config', 'credential.helper', helper);
    // The login dialog offers it, and is told to use it: git runs again, with it, asking nothing.
    answers = [{ answer: null, useCredentialHelper: true }];
    await askPass.git(git)(repo, ['ls-remote', 'origin']);
    expect(prompts).toEqual([
      expect.objectContaining({ prompt: `Username for '${url}': `, helper: true }),
    ]);
    expect(askPass.useCredentialHelper).toBe(true);
    await askPass.git(git)(repo, ['ls-remote', 'origin']);
    expect(prompts).toHaveLength(1);
    askPass.useCredentialHelper = false;
  });

  it('asks for an SSH key’s passphrase, through OpenSSH’s askpass', async () => {
    prompts = [];
    done = [];
    const key = join(root, 'key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'pass phrase', '-f', key]);
    answers = [{ answer: 'pass phrase' }];
    // OpenSSH reading the key, as ssh would to log in, with the environment git would give it.
    const sshKeygen: Git = async (_cwd, _args, env) =>
      (
        await promisify(execFile)('ssh-keygen', ['-y', '-f', key], {
          env: { ...process.env, ...env },
        })
      ).stdout;
    expect(await askPass.git(sshKeygen)(root, [])).toMatch(/^ssh-ed25519 /);
    expect(prompts).toEqual([
      expect.objectContaining({ kind: 'ssh', prompt: 'Enter passphrase: ' }),
    ]);
  });

  it('answers nothing to a client whose command isn’t under way', async () => {
    expect(await askPass.ask({ session: 'gone', kind: 'git', prompt: 'Password: ' }, git)).toBe(
      null,
    );
  });

  it('tells a command that fails otherwise from a failed login', async () => {
    const { repo } = await setUp('other');
    answers = [{ answer: 'ido' }, { answer: 'secret' }];
    // No such branch there: exit code 2, after logging in.
    await expect(
      askPass.git(git)(repo, ['ls-remote', '--exit-code', 'origin', 'refs/heads/nothing']),
    ).rejects.toThrow();
    expect(prompts).toHaveLength(2);
    expect(done).toEqual([false]);
    // Failing before asking: nothing to tell.
    await expect(askPass.git(git)(repo, ['no-such-command'])).rejects.toThrow();
    expect(done).toEqual([false]);
  });
});

describe('the askpass client', () => {
  const output = () => {
    const out: string[] = [];
    return { out, stream: { write: (text: string) => out.push(text) } };
  };
  const ask = async (reply: (text: string) => Promise<string | null>, args: string[]) => {
    const path = socketPath();
    const heard: unknown[] = [];
    const server = listenForAskPass(path, (message) => {
      heard.push(message);
      return reply(message.prompt);
    });
    const out = output();
    const err = output();
    const code = await askPassClient(
      args,
      { CEREBRO_ASKPASS_SOCKET: path, CEREBRO_ASKPASS_SESSION: '7' },
      out.stream,
      err.stream,
    );
    server.close();
    return { code, out: out.out, err: err.out, heard };
  };

  it('asks the host and prints its answer', async () => {
    const result = await ask(
      (prompt) => Promise.resolve(`for ${prompt}`),
      ['ssh', "Enter passphrase for key '/k': "],
    );
    expect(result).toEqual({
      code: 0,
      out: ["for Enter passphrase for key '/k': \n"],
      err: [],
      heard: [{ session: '7', kind: 'ssh', prompt: "Enter passphrase for key '/k': " }],
    });
  });

  it('prints nothing when cancelled, as IntelliJ’s', async () => {
    const result = await ask(() => Promise.resolve(null), []);
    expect(result).toEqual({
      code: 0,
      out: [],
      err: ['Authentication request was cancelled\n'],
      heard: [{ session: '7', kind: 'git', prompt: '' }],
    });
  });

  it('fails when the host can’t be reached', async () => {
    const err = output();
    const code = await askPassClient(
      ['git', 'Password: '],
      { CEREBRO_ASKPASS_SOCKET: join(tmpdir(), 'cerebro-nobody.sock') },
      output().stream,
      err.stream,
    );
    expect(code).toBe(1);
    expect(err.out[0]).toMatch(/^Could not communicate with Cerebro: /);
    // Not run by the host's git at all.
    expect(await askPassClient([], {}, output().stream, err.stream)).toBe(1);
    expect(err.out[1]).toBe('Could not communicate with Cerebro: not run by its git\n');
  });

  it('answers a question as a line, the connection left open', async () => {
    // On Windows, a named pipe closed for writing is closed both ways (measured: the reply
    // failed with EPIPE), so the question ends with its line.
    const path = socketPath();
    const server = listenForAskPass(path, (message) => Promise.resolve(`for ${message.prompt}`));
    const reply = await new Promise<string>((resolve) => {
      let text = '';
      const socket = createConnection(path, () => {
        // In two pieces, as a pipe may give it.
        socket.write('{"session":"1","kind":"git",');
        setTimeout(() => socket.write('"prompt":"P"}\n'), 20);
      });
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => (text += chunk));
      socket.on('end', () => {
        resolve(text);
      });
    });
    expect(reply).toBe('{"answer":"for P"}');
    server.close();
  });

  it('lets a client go before its answer', async () => {
    const path = socketPath();
    let answer!: (text: string) => void;
    const asked = new Promise<void>((resolve) => {
      listenForAskPass(path, () => {
        resolve();
        return new Promise((r) => (answer = r));
      });
    });
    const socket = createConnection(path, () =>
      socket.write('{"session":"1","kind":"git","prompt":""}\n'),
    );
    await asked;
    socket.destroy();
    await new Promise((resolve) => socket.on('close', resolve));
    answer('late');
    // Nothing thrown in the host: the test would fail with an unhandled error.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('fails when the host’s reply isn’t one', async () => {
    const path = socketPath();
    const server = createServer((socket) => socket.end('not json'));
    server.listen(path);
    const err = output();
    expect(
      await askPassClient(
        ['git', 'P'],
        { CEREBRO_ASKPASS_SOCKET: path },
        output().stream,
        err.stream,
      ),
    ).toBe(1);
    expect(err.out).toEqual(['Could not communicate with Cerebro: no answer\n']);
    server.close();
  });

  it('is answered null for a garbled question', async () => {
    const path = socketPath();
    const server = listenForAskPass(path, () => Promise.resolve('never'));
    const send = (text: string) =>
      new Promise<string>((resolve) => {
        let reply = '';
        const socket = createConnection(path, () => socket.write(`${text}\n`));
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => (reply += chunk));
        socket.on('end', () => {
          resolve(reply);
        });
      });
    expect(await send('{')).toBe('{"answer":null}');
    // On Windows, a named pipe: no file left to remove first.
    const pipe = listenForAskPass(socketPath(), () => Promise.resolve('piped'), 'win32');
    pipe.close();
    expect(await send('{"session":1,"kind":"git","prompt":""}')).toBe('{"answer":null}');
    expect(await send('{"session":"1","kind":"x","prompt":""}')).toBe('{"answer":null}');
    server.close();
  });
});

describe('the askpass scripts', () => {
  it('runs the command as Node, with askpass and the kind before the prompt', () => {
    const unix = writeAskPassScripts(['/app/electron', '/app/main.js'], 'linux');
    expect(readFileSync(unix.git, 'utf8')).toBe(
      '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "/app/electron" "/app/main.js" askpass git "$@"\n',
    );
    expect(unix.ssh.endsWith('ssh.sh')).toBe(true);
    if (process.platform !== 'win32') expect(statSync(unix.git).mode & 0o111).toBe(0o111);
    const windows = writeAskPassScripts(['C:\\app\\electron.exe', 'main.js'], 'win32');
    expect(readFileSync(windows.ssh, 'utf8')).toBe(
      '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\app\\electron.exe" "main.js" askpass ssh %*\r\n',
    );
    expect(windows.git.endsWith('git.bat')).toBe(true);
    rmSync(unix.folder, { recursive: true });
    rmSync(windows.folder, { recursive: true });
  });
});

describe('failed authentication', () => {
  it('is told by git’s words, as IntelliJ tells it', () => {
    expect(authFailed("fatal: Authentication failed for 'https://h/r.git/'")).toBe(true);
    expect(authFailed('error: 403 Forbidden')).toBe(true);
    expect(authFailed('but was used to access one of realms')).toBe(true);
    expect(authFailed('error: 400 bad request')).toBe(true);
    expect(authFailed("fatal: repository 'https://h/r.git/' not found")).toBe(true);
    expect(authFailed('fatal: repository is fine')).toBe(false);
    expect(authFailed("fatal: unable to access 'x': The requested URL returned error: 403")).toBe(
      true,
    );
    expect(authFailed("fatal: unable to access 'x': Could not resolve host")).toBe(false);
    expect(
      authFailed(' ! [remote rejected] main -> main ([remote rejected] (permission denied))'),
    ).toBe(true);
    expect(authFailed('error: src refspec x does not match any')).toBe(false);
  });
});
