import { describe, expect, it, vi } from 'vitest';
import { effect, makeObservable, observableObject } from '../src/index.js';

function runs(fn: () => unknown) {
  const counter = { count: 0 };
  effect(() => {
    counter.count++;
    fn();
  });
  return counter;
}

let labelCalls = 0;

class Worktree {
  name = 'main';
  branch = 'latest';
  meta = { tags: ['a'] };
  onRename = (name: string) => {
    this.name = name;
    this.branch = name;
  };

  constructor() {
    makeObservable(this);
  }

  get label() {
    labelCalls++;
    return `${this.name} (${this.branch})`;
  }

  get upper() {
    return this.name.toUpperCase();
  }

  set upper(value: string) {
    this.name = value.toLowerCase();
    this.branch = value.toLowerCase();
  }

  rename(name: string) {
    this.name = name;
    this.branch = name;
    return this.label;
  }
}

describe('makeObservable', () => {
  it('makes fields observable', () => {
    const wt = new Worktree();
    const counter = runs(() => wt.name);
    wt.name = 'other';
    expect(counter.count).toBe(2);
    expect(wt.name).toBe('other');
  });

  it('keeps fields enumerable and methods not', () => {
    const wt = new Worktree();
    expect(Object.keys(wt)).toEqual(['name', 'branch', 'meta', 'onRename']);
    expect(Object.keys(wt)).not.toContain('rename');
  });

  it('makes getters cached computed values', () => {
    const wt = new Worktree();
    labelCalls = 0;
    runs(() => wt.label);
    expect(wt.label).toBe('main (latest)');
    expect(wt.label).toBe('main (latest)');
    expect(labelCalls).toBe(1);
  });

  it('makes setters actions', () => {
    const wt = new Worktree();
    const counter = runs(() => `${wt.name}/${wt.branch}`);
    wt.upper = 'DEV';
    expect(wt.name).toBe('dev');
    expect(counter.count).toBe(2);
  });

  it('makes methods actions that keep this and the result', () => {
    const wt = new Worktree();
    const counter = runs(() => `${wt.name}/${wt.branch}`);
    expect(wt.rename('x')).toBe('x (x)');
    expect(counter.count).toBe(2);
  });

  it('tracks methods called from an effect, so query methods work in bindings', () => {
    class Store {
      items = ['a'];
      constructor() {
        makeObservable(this);
      }
      has(item: string) {
        return this.items.includes(item);
      }
    }
    const store = new Store();
    const seen: boolean[] = [];
    effect(() => {
      seen.push(store.has('b'));
      return undefined;
    });
    store.items = ['a', 'b'];
    expect(seen).toEqual([false, true]);
  });

  it('makes function fields actions', () => {
    const wt = new Worktree();
    const counter = runs(() => `${wt.name}/${wt.branch}`);
    wt.onRename('y');
    expect(counter.count).toBe(2);
  });

  it('stores plain objects as-is', () => {
    const wt = new Worktree();
    const counter = runs(() => wt.meta.tags.length);
    wt.meta.tags.push('b');
    expect(counter.count).toBe(1);
    wt.meta = { tags: [] };
    expect(counter.count).toBe(2);
  });

  it('leaves converted members alone when called again', () => {
    const wt = new Worktree();
    const before = Object.getOwnPropertyDescriptors(wt);
    makeObservable(wt);
    const after = Object.getOwnPropertyDescriptors(wt);
    for (const key of Reflect.ownKeys(before) as string[]) {
      expect(after[key]).toEqual(before[key]);
    }
  });

  it('converts setter-only accessors once', () => {
    class Sink {
      received: string[] = [];
      constructor() {
        makeObservable(this);
      }
      set value(v: string) {
        this.received = [...this.received, v];
      }
    }
    const sink = new Sink();
    const before = Object.getOwnPropertyDescriptor(sink, 'value');
    makeObservable(sink);
    expect(Object.getOwnPropertyDescriptor(sink, 'value')).toEqual(before);
    sink.value = 'a';
    expect(sink.received).toEqual(['a']);
  });

  it('supports class hierarchies, each constructor calling it', () => {
    class Base {
      base = 1;
      constructor() {
        makeObservable(this);
      }
      describe() {
        return 'base';
      }
      get doubled() {
        return this.base * 2;
      }
    }
    class Child extends Base {
      child = 10;
      constructor() {
        super();
        makeObservable(this);
      }
      override describe() {
        return 'child';
      }
      get sum() {
        return this.base + this.child;
      }
    }
    const c = new Child();
    const counter = runs(() => c.sum + c.doubled);
    c.child = 20;
    c.base = 2;
    expect(counter.count).toBe(3);
    expect(c.sum).toBe(22);
    expect(c.describe()).toBe('child');
  });

  it('handles symbol keys', () => {
    const key = Symbol('key');
    class WithSymbol {
      [key] = 1;
      constructor() {
        makeObservable(this);
      }
    }
    const w = new WithSymbol();
    const counter = runs(() => w[key]);
    w[key] = 2;
    expect(counter.count).toBe(2);
  });
});

describe('observableObject', () => {
  it('makes values observable, getters computed and methods actions', () => {
    const getter = vi.fn();
    const settings = observableObject({
      fontSize: 13,
      wrap: false,
      get summary() {
        getter();
        return `${String(this.fontSize)}${this.wrap ? ' wrap' : ''}`;
      },
      toggle() {
        this.wrap = !this.wrap;
        this.fontSize++;
      },
    });
    const counter = runs(() => settings.summary);
    settings.toggle();
    expect(settings.summary).toBe('14 wrap');
    expect(counter.count).toBe(2);
    expect(getter).toHaveBeenCalledTimes(2);
  });

  it('has a fixed shape', () => {
    const o = observableObject({ a: 1 }) as Record<string, unknown>;
    expect(() => {
      o['b'] = 2;
    }).toThrow(TypeError);
  });

  it('nests explicitly', () => {
    const outer = observableObject({ editor: observableObject({ fontSize: 13 }) });
    const counter = runs(() => outer.editor.fontSize);
    outer.editor.fontSize = 14;
    outer.editor = observableObject({ fontSize: 15 });
    expect(counter.count).toBe(3);
  });

  it('does not change the object it was given', () => {
    const init = { a: 1 };
    const o = observableObject(init);
    o.a = 2;
    expect(init.a).toBe(1);
  });
});
