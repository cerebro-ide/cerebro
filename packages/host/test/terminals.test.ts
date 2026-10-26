import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUFFER_LIMIT, defaultShell, Terminals, type Pty } from '../src/index.js';

/** A pretend pty: its output and exit are driven by the test. */
function fakePty() {
  let data: (data: string) => void = () => undefined;
  let exit: (event: { exitCode: number }) => void = () => undefined;
  const pty = {
    onData: (listener: typeof data) => (data = listener),
    onExit: (listener: typeof exit) => (exit = listener),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  } satisfies Pty;
  return {
    pty,
    output: (text: string) => {
      data(text);
    },
    exit: (code: number) => {
      exit({ exitCode: code });
    },
  };
}

function setup() {
  const ptys: ReturnType<typeof fakePty>[] = [];
  const spawn = vi.fn(() => {
    const fake = fakePty();
    ptys.push(fake);
    return fake.pty;
  });
  const notify = vi.fn();
  const terminals = new Terminals(spawn, notify, () => '/bin/zsh');
  return { terminals, spawn, notify, ptys };
}

const open = { key: 'k', cwd: '/w', cols: 100, rows: 30 };

afterEach(() => {
  vi.useRealTimers();
});

describe('terminals', () => {
  it('runs the shell by default, else the command, in the folder and size asked for', () => {
    const { terminals, spawn } = setup();
    expect(terminals.open(open)).toEqual({ id: 1, buffer: '', exitCode: undefined });
    expect(spawn).toHaveBeenLastCalledWith(
      '/bin/zsh',
      [],
      expect.objectContaining({
        cwd: '/w',
        cols: 100,
        rows: 30,
        env: expect.objectContaining({ TERM: 'xterm-256color' }) as unknown,
      }),
    );
    terminals.open({ ...open, key: 'agent', command: 'claude', args: ['--continue'] });
    expect(spawn).toHaveBeenLastCalledWith('claude', ['--continue'], expect.anything());
  });

  it('sends output in batches, and the exit after the last of it', () => {
    vi.useFakeTimers();
    const { terminals, notify, ptys } = setup();
    terminals.open(open);
    ptys[0]?.output('a');
    ptys[0]?.output('b');
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4);
    expect(notify).toHaveBeenCalledWith('terminal.data', { id: 1, data: 'ab' });
    vi.advanceTimersByTime(4);
    expect(notify).toHaveBeenCalledTimes(1);
    ptys[0]?.output('c');
    ptys[0]?.exit(2);
    expect(notify.mock.calls).toEqual([
      ['terminal.data', { id: 1, data: 'ab' }],
      ['terminal.data', { id: 1, data: 'c' }],
      ['terminal.exit', { id: 1, exitCode: 2 }],
    ]);
    // The batch's timer finds nothing left to send.
    vi.advanceTimersByTime(4);
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it('gives the running terminal and its recent output for a key opened again', () => {
    vi.useFakeTimers();
    const { terminals, spawn, ptys } = setup();
    terminals.open(open);
    ptys[0]?.output('x'.repeat(BUFFER_LIMIT));
    ptys[0]?.output('tail');
    const again = terminals.open({ ...open, cols: 120, rows: 40 });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(again.id).toBe(1);
    expect(again.buffer).toHaveLength(BUFFER_LIMIT);
    expect(again.buffer.endsWith('tail')).toBe(true);
    expect(ptys[0]?.pty.resize).toHaveBeenCalledWith(120, 40);
    ptys[0]?.exit(0);
    expect(terminals.open(open).exitCode).toBe(0);
  });

  it('writes, resizes while running, and closes', () => {
    const { terminals, spawn, ptys } = setup();
    terminals.open(open);
    terminals.write(1, 'ls\r');
    expect(ptys[0]?.pty.write).toHaveBeenCalledWith('ls\r');
    terminals.resize(1, 90, 20);
    expect(ptys[0]?.pty.resize).toHaveBeenCalledWith(90, 20);
    terminals.close(1);
    expect(ptys[0]?.pty.kill).toHaveBeenCalled();
    expect(() => {
      terminals.write(1, 'x');
    }).toThrow('No terminal 1');
    // Its key is free again.
    terminals.open(open);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('neither resizes nor kills a terminal whose process has ended', () => {
    const { terminals, ptys } = setup();
    terminals.open(open);
    ptys[0]?.exit(0);
    terminals.resize(1, 90, 20);
    terminals.close(1);
    expect(ptys[0]?.pty.resize).not.toHaveBeenCalled();
    expect(ptys[0]?.pty.kill).not.toHaveBeenCalled();
  });

  it('closes them all', () => {
    const { terminals, ptys } = setup();
    terminals.open(open);
    terminals.open({ ...open, key: 'other' });
    terminals.closeAll();
    expect(ptys.map((p) => p.pty.kill.mock.calls.length)).toEqual([1, 1]);
  });
});

describe('the default shell', () => {
  it('is $SHELL, else bash; on Windows %COMSPEC%, else PowerShell', () => {
    expect(defaultShell('linux', { SHELL: '/bin/zsh' })).toBe('/bin/zsh');
    expect(defaultShell('darwin', {})).toBe('/bin/bash');
    expect(defaultShell('win32', { COMSPEC: 'cmd.exe' })).toBe('cmd.exe');
    expect(defaultShell('win32', {})).toBe('powershell.exe');
    expect(defaultShell()).toBe(defaultShell(process.platform, process.env));
  });
});
