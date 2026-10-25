import { effect } from '@cerebro-ide/reactive';
import { describe, expect, it } from 'vitest';
import { Environments } from '../src/index.js';

const spec = (id: string) => ({ id, name: id, branch: `feat/${id}` });
const ids = (envs: Environments) => envs.open.map((e) => e.id);

describe('Environments', () => {
  it('opens after the active environment and activates it', () => {
    const envs = new Environments();
    expect(envs.active).toBeUndefined();
    envs.openOrActivate(spec('a'));
    envs.openOrActivate(spec('b'));
    envs.activate('a');
    const c = envs.openOrActivate(spec('c'));
    expect(ids(envs)).toEqual(['a', 'c', 'b']);
    expect(envs.active).toBe(c);
    expect(c.branch).toBe('feat/c');
  });

  it('switches to an environment that is already open', () => {
    const envs = new Environments();
    const a = envs.openOrActivate(spec('a'));
    envs.openOrActivate(spec('b'));
    expect(envs.openOrActivate(spec('a'))).toBe(a);
    expect(ids(envs)).toEqual(['a', 'b']);
    expect(envs.activeId).toBe('a');
  });

  it('gives each environment its own editor area', () => {
    const envs = new Environments();
    const a = envs.openOrActivate(spec('a'));
    const b = envs.openOrActivate(spec('b'));
    a.editor.open({ id: 'x.ts', title: 'x.ts' });
    expect(a.editor).not.toBe(b.editor);
    expect(b.editor.activeGroup.tabs).toEqual([]);
  });

  it('closes, activating the next environment or the previous for the last', () => {
    const envs = new Environments();
    for (const id of ['a', 'b', 'c']) envs.openOrActivate(spec(id));
    envs.activate('b');
    envs.close('b');
    expect(envs.activeId).toBe('c');
    envs.close('c');
    expect(envs.activeId).toBe('a');
    envs.openOrActivate(spec('d'));
    envs.activate('a');
    envs.close('d');
    expect(envs.activeId).toBe('a');
    envs.close('nope');
    envs.close('a');
    expect(envs.open).toEqual([]);
    expect(envs.activeId).toBeUndefined();
  });

  it('reorders, clamping the index', () => {
    const envs = new Environments();
    for (const id of ['a', 'b', 'c']) envs.openOrActivate(spec(id));
    envs.move('a', 2);
    expect(ids(envs)).toEqual(['b', 'c', 'a']);
    envs.move('a', -3);
    expect(ids(envs)).toEqual(['a', 'b', 'c']);
    envs.move('b', 99);
    expect(ids(envs)).toEqual(['a', 'c', 'b']);
  });

  it('rejects unknown environments', () => {
    const envs = new Environments();
    expect(() => {
      envs.activate('nope');
    }).toThrow('is not open');
    expect(() => {
      envs.move('nope', 0);
    }).toThrow('is not open');
  });

  it('is reactive', () => {
    const envs = new Environments();
    const seen: string[] = [];
    effect(() => {
      seen.push(`${envs.active?.name ?? '-'}:${envs.active?.branch ?? '-'}`);
      return undefined;
    });
    const a = envs.openOrActivate(spec('a'));
    a.branch = 'main';
    expect(seen).toEqual(['-:-', 'a:feat/a', 'a:main']);
  });
});
