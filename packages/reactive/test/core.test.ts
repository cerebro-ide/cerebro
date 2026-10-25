import { describe, expect, it, vi } from 'vitest';
import {
  action,
  Atom,
  autoAction,
  batch,
  computed,
  effect,
  signal,
  untracked,
} from '../src/index.js';

/** Runs `fn` in an effect and returns how many times it ran, plus its disposer. */
function track(fn: () => unknown) {
  const runs = { count: 0 };
  const handle = effect(() => {
    runs.count++;
    fn();
  });
  return {
    runs,
    dispose: () => {
      handle.dispose();
    },
  };
}

describe('signal', () => {
  it('reads, writes and peeks', () => {
    const s = signal(1);
    expect(s.get()).toBe(1);
    s.set(2);
    expect(s.get()).toBe(2);
    expect(s.peek()).toBe(2);
  });

  it('notifies only when the value changes', () => {
    const s = signal(1);
    const { runs } = track(() => s.get());
    s.set(1);
    expect(runs.count).toBe(1);
    s.set(2);
    expect(runs.count).toBe(2);
  });

  it('uses a custom equality', () => {
    const s = signal({ id: 1 }, { equals: (a, b) => a.id === b.id });
    const { runs } = track(() => s.get());
    s.set({ id: 1 });
    expect(runs.count).toBe(1);
    s.set({ id: 2 });
    expect(runs.count).toBe(2);
  });

  it('peek does not create a dependency', () => {
    const s = signal(1);
    const { runs } = track(() => s.peek());
    s.set(2);
    expect(runs.count).toBe(1);
  });
});

describe('computed', () => {
  it('is lazy and cached', () => {
    const s = signal(1);
    const fn = vi.fn(() => s.get() * 2);
    const c = computed(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(c.get()).toBe(2);
    expect(c.get()).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
    s.set(2);
    expect(c.get()).toBe(4);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('unobserved, skips recomputing when an unrelated value changed', () => {
    const s = signal(1);
    const other = signal(1);
    const fn = vi.fn(() => s.get());
    const c = computed(fn);
    c.get();
    other.set(2);
    expect(c.get()).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('observed, recomputes only when a source changed', () => {
    const s = signal(1);
    const other = signal(1);
    const fn = vi.fn(() => s.get());
    const c = computed(fn);
    const { runs } = track(() => c.get());
    other.set(2);
    expect(c.get()).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    s.set(2);
    expect(runs.count).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops propagation when its value is unchanged', () => {
    const s = signal(1);
    const parity = computed(() => s.get() % 2);
    const { runs } = track(() => parity.get());
    s.set(3);
    expect(runs.count).toBe(1);
    s.set(4);
    expect(runs.count).toBe(2);
  });

  it('settles a chain whose inner value is unchanged', () => {
    const s = signal(1);
    const parity = computed(() => s.get() % 2);
    const outerFn = vi.fn(() => parity.get() * 10);
    const outer = computed(outerFn);
    const { runs } = track(() => outer.get());
    s.set(3);
    expect(outer.get()).toBe(10);
    expect(outerFn).toHaveBeenCalledTimes(1);
    expect(runs.count).toBe(1);
  });

  it('uses a custom equality', () => {
    const s = signal(1);
    const c = computed(() => ({ big: s.get() > 10 }), { equals: (a, b) => a.big === b.big });
    const { runs } = track(() => c.get());
    s.set(2);
    expect(runs.count).toBe(1);
    s.set(11);
    expect(runs.count).toBe(2);
  });

  it('marks dependents stale once per change', () => {
    const a = signal(1);
    const b = signal(1);
    const sum = computed(() => a.get() + b.get());
    const { runs } = track(() => sum.get());
    batch(() => {
      a.set(2);
      b.set(2);
    });
    expect(runs.count).toBe(2);
    expect(sum.get()).toBe(4);
  });

  it('rethrows errors and recovers', () => {
    const s = signal(0);
    const c = computed(() => {
      if (s.get() < 0) throw new Error(`negative: ${String(s.get())}`);
      return s.get();
    });
    expect(c.get()).toBe(0);
    s.set(-1);
    expect(() => c.get()).toThrow('negative: -1');
    s.set(-2);
    expect(() => c.get()).toThrow('negative: -2');
    s.set(3);
    expect(c.get()).toBe(3);
  });

  it('detects a computed that depends on itself', () => {
    const c: { get(): number } = computed((): number => c.get() + 1);
    expect(() => c.get()).toThrow('Cycle detected');
  });

  it('detects a cycle between two computed values', () => {
    const a: { get(): number } = computed((): number => b.get());
    const b: { get(): number } = computed((): number => a.get());
    expect(() => a.get()).toThrow('Cycle detected');
  });

  it('must not write to observables', () => {
    const s = signal(1);
    const atom = new Atom();
    expect(() => {
      computed(() => {
        s.set(2);
      }).get();
    }).toThrow('must not write');
    expect(() => {
      computed(() => {
        atom.reportChanged();
      }).get();
    }).toThrow('must not write');
  });

  it('peek does not create a dependency', () => {
    const s = signal(1);
    const c = computed(() => s.get());
    const { runs } = track(() => c.peek());
    s.set(2);
    expect(runs.count).toBe(1);
    expect(c.peek()).toBe(2);
  });

  it('stays correct after its last observer goes away, and when observed again', () => {
    const s = signal(1);
    const c = computed(() => s.get());
    const first = track(() => c.get());
    first.dispose();
    s.set(2);
    expect(c.get()).toBe(2);
    const second = track(() => c.get());
    s.set(3);
    expect(second.runs.count).toBe(2);
    expect(c.get()).toBe(3);
  });

  it('subscribes a chain of computed values when first observed', () => {
    const s = signal(1);
    const inner = computed(() => s.get());
    const outer = computed(() => inner.get());
    outer.get();
    const { runs } = track(() => outer.get());
    s.set(2);
    expect(runs.count).toBe(2);
  });

  it('drops dependencies it no longer reads', () => {
    const useA = signal(true);
    const a = signal('a');
    const b = signal('b');
    const c = computed(() => (useA.get() ? a.get() : b.get()));
    const { runs } = track(() => c.get());
    useA.set(false);
    expect(runs.count).toBe(2);
    a.set('a2');
    expect(runs.count).toBe(2);
    b.set('b2');
    expect(runs.count).toBe(3);
  });
});

describe('effect', () => {
  it('runs now and again on change', () => {
    const s = signal(1);
    const seen: number[] = [];
    effect(() => {
      seen.push(s.get());
    });
    s.set(2);
    expect(seen).toEqual([1, 2]);
  });

  it('runs cleanup before each rerun and on dispose', () => {
    const s = signal(1);
    const log: string[] = [];
    const handle = effect(() => {
      const value = s.get();
      log.push(`run ${String(value)}`);
      return () => log.push(`cleanup ${String(value)}`);
    });
    s.set(2);
    handle.dispose();
    handle.dispose();
    s.set(3);
    expect(log).toEqual(['run 1', 'cleanup 1', 'run 2', 'cleanup 2']);
  });

  it('ignores a returned value that is not a function', () => {
    const s = signal(1);
    // @ts-expect-error -- the types reject a non-function return; this checks the runtime guard too
    const handle = effect(() => s.get());
    s.set(2);
    expect(() => {
      handle.dispose();
    }).not.toThrow();
  });

  it('is disposed if its first run throws', () => {
    const s = signal(1);
    const fn = vi.fn(() => {
      s.get();
      throw new Error('boom');
    });
    expect(() => effect(fn)).toThrow('boom');
    s.set(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps running other effects when one throws, then throws the first error', () => {
    const s = signal(1);
    effect(() => {
      if (s.get() > 1) throw new Error('first');
    });
    effect(() => {
      if (s.get() > 1) throw new Error('second');
    });
    const { runs } = track(() => s.get());
    expect(() => {
      s.set(2);
    }).toThrow('first');
    expect(runs.count).toBe(2);
  });

  it('settles when it writes a value it reads', () => {
    const s = signal(15);
    effect(() => {
      if (s.get() > 10) s.set(10);
    });
    expect(s.get()).toBe(10);
    s.set(20);
    expect(s.get()).toBe(10);
  });

  it('reports a cycle and recovers', () => {
    const s = signal(0);
    const handle = effect(() => {
      s.set(s.get() + 1);
    });
    expect(() => {
      s.set(100);
    }).toThrow('did not settle');
    handle.dispose();
    const { runs } = track(() => s.get());
    s.set(0);
    expect(runs.count).toBe(2);
  });

  it('runs writes made by other effects in the same flush', () => {
    const a = signal(1);
    const b = signal(0);
    effect(() => {
      b.set(a.get() * 2);
    });
    const { runs } = track(() => b.get());
    a.set(2);
    expect(b.get()).toBe(4);
    expect(runs.count).toBe(2);
  });

  it('can dispose itself mid-run, without leaking new dependencies', () => {
    const s = signal(1);
    const late = signal(1);
    const cleanup = vi.fn();
    const fn = vi.fn();
    const handle = effect(() => {
      fn();
      if (s.get() === 2) {
        late.get();
        handle.dispose();
        return cleanup;
      }
      return undefined;
    });
    s.set(2);
    expect(cleanup).toHaveBeenCalledTimes(1);
    late.set(2);
    s.set(3);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not run when disposed while scheduled', () => {
    const s = signal(1);
    const fn = vi.fn();
    const handle = effect(() => {
      fn();
      s.get();
    });
    batch(() => {
      s.set(2);
      handle.dispose();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('batch', () => {
  it('defers effects to the end of the outermost batch', () => {
    const a = signal(1);
    const b = signal(1);
    const { runs } = track(() => a.get() + b.get());
    const result = batch(() => {
      a.set(2);
      batch(() => {
        b.set(2);
      });
      expect(runs.count).toBe(1);
      return 'done';
    });
    expect(result).toBe('done');
    expect(runs.count).toBe(2);
  });

  it('flushes even when the batch throws', () => {
    const s = signal(1);
    const { runs } = track(() => s.get());
    expect(() =>
      batch(() => {
        s.set(2);
        throw new Error('oops');
      }),
    ).toThrow('oops');
    expect(runs.count).toBe(2);
  });
});

describe('untracked', () => {
  it('reads without creating dependencies', () => {
    const s = signal(1);
    const { runs } = track(() => untracked(() => s.get()));
    s.set(2);
    expect(runs.count).toBe(1);
  });
});

describe('action', () => {
  it('batches, untracks, and keeps this, arguments and the result', () => {
    const a = signal(1);
    const b = signal(1);
    const target = {
      factor: 10,
      update: action(function (this: { factor: number }, x: number) {
        a.set(x * this.factor);
        b.set(x);
        return a.get() + b.get();
      }),
    };
    const { runs } = track(() => a.get() + b.get());
    expect(target.update(2)).toBe(22);
    expect(runs.count).toBe(2);
  });

  it('does not make the calling effect depend on what it reads', () => {
    const s = signal(1);
    const read = action(() => s.get());
    const { runs } = track(() => read());
    s.set(2);
    expect(runs.count).toBe(1);
  });
});

describe('autoAction', () => {
  it('is an action outside effects and computed values', () => {
    const a = signal(1);
    const b = signal(1);
    const update = autoAction((x: number) => {
      a.set(x);
      b.set(x);
    });
    const { runs } = track(() => a.get() + b.get());
    update(2);
    expect(runs.count).toBe(2);
  });

  it('is a plain, tracked call inside them', () => {
    const s = signal(1);
    const read = autoAction(() => s.get());
    const { runs } = track(() => read());
    expect(computed(() => read() * 2).get()).toBe(2);
    s.set(2);
    expect(runs.count).toBe(2);
  });
});

describe('Atom', () => {
  it('builds a custom observable', () => {
    const atom = new Atom();
    const { runs } = track(() => {
      atom.reportObserved();
    });
    atom.reportChanged();
    expect(runs.count).toBe(2);
  });
});
