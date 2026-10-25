import { effect, signal } from '@cerebro-ide/reactive';
import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../src/index.js';

describe('CommandRegistry', () => {
  it('registers and runs commands with their context', () => {
    const commands = new CommandRegistry();
    const run = vi.fn();
    commands.register({ id: 'file.open', label: '&Open', dialog: true, run });
    expect(commands.get('file.open')?.dialog).toBe(true);
    expect(commands.execute('file.open', { path: 'a' })).toBe(true);
    expect(run).toHaveBeenCalledWith({ path: 'a' });
  });

  it('rejects a duplicate id', () => {
    const commands = new CommandRegistry();
    commands.register({ id: 'a', label: 'A', run: () => undefined });
    expect(() => commands.register({ id: 'a', label: 'A', run: () => undefined })).toThrow(
      'already registered',
    );
  });

  it('unregisters on dispose, leaving a later registration alone', () => {
    const commands = new CommandRegistry();
    const first = commands.register({ id: 'a', label: 'A', run: () => undefined });
    first.dispose();
    expect(commands.get('a')).toBeUndefined();
    const second = commands.register({ id: 'a', label: 'A2', run: () => undefined });
    first.dispose();
    expect(commands.get('a')?.label).toBe('A2');
    second.dispose();
  });

  it('runs only enabled, known commands', () => {
    const commands = new CommandRegistry();
    const run = vi.fn();
    commands.register({ id: 'a', label: 'A', run, enabled: (c) => c === 'yes' });
    expect(commands.isEnabled('a', 'no')).toBe(false);
    expect(commands.execute('a', 'no')).toBe(false);
    expect(commands.execute('a', 'yes')).toBe(true);
    expect(commands.isEnabled('missing')).toBe(false);
    expect(commands.execute('missing')).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports checked state for toggles', () => {
    const commands = new CommandRegistry();
    commands.register({ id: 'a', label: 'A', run: () => undefined });
    commands.register({ id: 'b', label: 'B', run: () => undefined, checked: () => true });
    expect(commands.isChecked('a')).toBeUndefined();
    expect(commands.isChecked('b')).toBe(true);
    expect(commands.isChecked('missing')).toBeUndefined();
  });

  it('is reactive', () => {
    const commands = new CommandRegistry();
    const allowed = signal(false);
    commands.register({ id: 'a', label: 'A', run: () => undefined, enabled: () => allowed.get() });
    const seen: boolean[] = [];
    effect(() => {
      seen.push(commands.isEnabled('a'));
      return undefined;
    });
    allowed.set(true);
    expect(seen).toEqual([false, true]);
  });
});
