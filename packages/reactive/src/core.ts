// Signals: sources hold values, computed values derive from them, effects react to them.
//
// Push-pull: a write marks dependents as possibly stale and schedules effects (push); values are
// recomputed only when read and only if a source really changed (pull). Effects run synchronously
// when the outermost batch ends.

export interface Disposable {
  dispose(): void;
}

export type Equals<T> = (a: T, b: T) => boolean;

/** An effect body; it may return a cleanup function. */
export type EffectFn = () => (() => void) | undefined;

export interface Options<T> {
  /** When a new value equals the old one, nothing is notified. Defaults to `Object.is`. */
  equals?: Equals<T>;
}

/** The maximum number of effect passes in one flush before it's treated as a cycle. */
const MAX_PASSES = 100;

let activeTracker: Tracker | undefined;
/** How many computed values are running, untracked parts included: none may write. */
let computingDepth = 0;
let batchDepth = 0;
let flushing = false;
/** Bumped on every write; lets an unobserved computed skip checking its sources. */
let globalVersion = 0;
const pendingEffects: EffectNode[] = [];

/** Something that can be depended on: it has a version that changes when its value does. */
abstract class Source {
  version = 0;
  protected readonly observers = new Set<Tracker>();

  /** Brings the value up to date. Plain sources are always up to date. */
  refresh(): void {}

  protected track(): void {
    activeTracker?.addSource(this);
  }

  protected changed(): void {
    this.version++;
    globalVersion++;
    batchDepth++;
    try {
      for (const observer of [...this.observers]) observer.stale();
    } finally {
      endBatch();
    }
  }

  addObserver(observer: Tracker): void {
    this.observers.add(observer);
    if (this.observers.size === 1) this.onObserved();
  }

  removeObserver(observer: Tracker): void {
    if (this.observers.delete(observer) && this.observers.size === 0) this.onUnobserved();
  }

  protected onObserved(): void {}
  protected onUnobserved(): void {}
}

/** Something that depends on sources and records them while it runs. */
abstract class Tracker extends Source {
  sources = new Map<Source, number>();
  private nextSources: Map<Source, number> | undefined;

  /** A source may have changed. */
  abstract stale(): void;

  /** Whether this tracker currently holds subscriptions to its sources. */
  protected abstract subscribed(): boolean;

  addSource(source: Source): void {
    const next = this.nextSources;
    if (!next || next.has(source) || source === this) return;
    next.set(source, source.version);
    // Subscribe right away, so a write later in the same run is seen.
    if (this.subscribed() && !this.sources.has(source)) source.addObserver(this);
  }

  protected tracked<T>(fn: () => T): T {
    const previous = activeTracker;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the running tracker is global state
    activeTracker = this;
    this.nextSources = new Map();
    let completed = false;
    try {
      const result = fn();
      completed = true;
      return result;
    } finally {
      activeTracker = previous;
      const next = this.nextSources;
      this.nextSources = undefined;
      // A run that threw may not have reached all it depends on: it keeps what it read before too,
      // so a change to any of it runs it again, and it can recover.
      if (!completed) {
        for (const [source, version] of this.sources)
          if (!next.has(source)) next.set(source, version);
      }
      if (this.subscribed()) {
        for (const source of this.sources.keys())
          if (!next.has(source)) source.removeObserver(this);
      }
      this.sources = next;
    }
  }

  protected sourcesChanged(): boolean {
    for (const [source, version] of this.sources) {
      source.refresh();
      if (source.version !== version) return true;
    }
    return false;
  }

  protected unsubscribeAll(): void {
    for (const source of this.sources.keys()) source.removeObserver(this);
    // Sources subscribed during a run that hasn't finished yet.
    for (const source of this.nextSources?.keys() ?? []) source.removeObserver(this);
  }
}

/** A value with no dependencies of its own, for building custom observables. */
export class Atom extends Source {
  /** Records that the running computed or effect depends on this atom. */
  reportObserved(): void {
    this.track();
  }

  /** Notifies everything that depends on this atom. */
  reportChanged(): void {
    assertNotComputing();
    this.changed();
  }
}

export class Signal<T> extends Source {
  private value: T;
  private readonly equals: Equals<T>;

  constructor(value: T, options?: Options<T>) {
    super();
    this.value = value;
    this.equals = options?.equals ?? Object.is;
  }

  get(): T {
    this.track();
    return this.value;
  }

  /** Reads the value without depending on it. */
  peek(): T {
    return this.value;
  }

  set(value: T): void {
    assertNotComputing();
    if (this.equals(this.value, value)) return;
    this.value = value;
    this.changed();
  }
}

export class Computed<T> extends Tracker {
  private readonly fn: () => T;
  private readonly equals: Equals<T>;
  private state: { value: T } | { error: unknown } | undefined;
  private isStale = false;
  private computing = false;
  private seenGlobalVersion = -1;

  constructor(fn: () => T, options?: Options<T>) {
    super();
    this.fn = fn;
    this.equals = options?.equals ?? Object.is;
  }

  get(): T {
    this.refresh();
    this.track();
    const state = this.state as { value: T } | { error: unknown };
    if ('error' in state) throw state.error;
    return state.value;
  }

  /** Reads the value without depending on it. */
  peek(): T {
    return untracked(() => this.get());
  }

  override refresh(): void {
    if (this.computing) {
      this.state = { error: new Error('Cycle detected: a computed value depends on itself') };
      return;
    }
    if (this.state) {
      if (this.observers.size > 0) {
        // Observed: kept current by stale() notifications.
        if (!this.isStale) return;
      } else if (this.seenGlobalVersion === globalVersion) {
        // Unobserved: nothing has been written since the last check.
        return;
      }
      this.seenGlobalVersion = globalVersion;
      if (!this.sourcesChanged()) {
        this.isStale = false;
        return;
      }
    }
    this.recompute();
  }

  stale(): void {
    if (this.isStale) return;
    this.isStale = true;
    for (const observer of [...this.observers]) observer.stale();
  }

  protected subscribed(): boolean {
    return this.observers.size > 0;
  }

  protected override onObserved(): void {
    for (const source of this.sources.keys()) source.addObserver(this);
  }

  protected override onUnobserved(): void {
    this.unsubscribeAll();
    // Stale notifications stop now, so the next read checks the sources again.
    this.seenGlobalVersion = -1;
  }

  private recompute(): void {
    const previous = this.state;
    this.computing = true;
    computingDepth++;
    let next: { value: T } | { error: unknown };
    try {
      next = { value: this.tracked(this.fn) };
    } catch (error) {
      next = { error };
    } finally {
      this.computing = false;
      computingDepth--;
    }
    this.isStale = false;
    this.seenGlobalVersion = globalVersion;
    this.state = next;
    const unchanged =
      previous && 'value' in previous && 'value' in next && this.equals(previous.value, next.value);
    if (unchanged) this.state = previous;
    else this.version++;
  }
}

class EffectNode extends Tracker implements Disposable {
  private readonly fn: EffectFn;
  private cleanup: (() => void) | undefined;
  private scheduled = false;
  private disposed = false;

  constructor(fn: EffectFn) {
    super();
    this.fn = fn;
  }

  stale(): void {
    // Never called once disposed: dispose() unsubscribes first.
    if (this.scheduled) return;
    this.scheduled = true;
    pendingEffects.push(this);
  }

  protected subscribed(): boolean {
    return !this.disposed;
  }

  run(): void {
    this.runCleanup();
    // TypeScript lets `() => value` pass as `() => void`, so only a function counts as cleanup.
    const result: unknown = this.tracked(this.fn);
    const cleanup = typeof result === 'function' ? (result as () => void) : undefined;
    // The effect may have disposed itself while running.
    if (this.disposed) cleanup?.();
    else this.cleanup = cleanup;
  }

  runIfChanged(): void {
    this.scheduled = false;
    if (this.disposed || !this.sourcesChanged()) return;
    this.run();
  }

  unschedule(): void {
    this.scheduled = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeAll();
    this.sources.clear();
    this.runCleanup();
  }

  private runCleanup(): void {
    const cleanup = this.cleanup;
    this.cleanup = undefined;
    cleanup?.();
  }
}

/** Computed values derive; they must not write, not even from an untracked part or an action. */
function assertNotComputing(): void {
  if (computingDepth > 0) {
    throw new Error('A computed value must not write to observables');
  }
}

function endBatch(): void {
  batchDepth--;
  if (batchDepth > 0 || flushing) return;
  flush();
}

function flush(): void {
  flushing = true;
  let failure: { error: unknown } | undefined;
  try {
    for (let pass = 1; pendingEffects.length > 0; pass++) {
      if (pass > MAX_PASSES) {
        for (const effect of pendingEffects.splice(0)) effect.unschedule();
        throw new Error(
          `Effects did not settle after ${String(MAX_PASSES)} passes; is there a cycle?`,
        );
      }
      for (const effect of pendingEffects.splice(0)) {
        try {
          effect.runIfChanged();
        } catch (error) {
          failure ??= { error };
        }
      }
    }
  } finally {
    flushing = false;
  }
  if (failure) throw failure.error;
}

export function signal<T>(value: T, options?: Options<T>): Signal<T> {
  return new Signal(value, options);
}

export function computed<T>(fn: () => T, options?: Options<T>): Computed<T> {
  return new Computed(fn, options);
}

/**
 * Runs `fn` now, and again whenever a value it read changes. `fn` may return a cleanup function,
 * which runs before the next run and on dispose.
 */
export function effect(fn: EffectFn): Disposable {
  const node = new EffectNode(fn);
  try {
    node.run();
  } catch (error) {
    node.dispose();
    throw error;
  }
  return node;
}

/** Runs `fn` with effects deferred until the outermost batch ends. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    endBatch();
  }
}

/** Runs `fn` without recording what it reads as dependencies. */
export function untracked<T>(fn: () => T): T {
  const previous = activeTracker;
  activeTracker = undefined;
  try {
    return fn();
  } finally {
    activeTracker = previous;
  }
}

/** Wraps `fn` so each call is batched and untracked, as a MobX action is. */
export function action<This, Args extends unknown[], R>(
  fn: (this: This, ...args: Args) => R,
): (this: This, ...args: Args) => R {
  return function (this: This, ...args: Args): R {
    return batch(() => untracked(() => fn.apply(this, args)));
  };
}

/**
 * Like `action`, except when called while a computed value or effect is running: then it's a plain,
 * tracked call, so a method that only reads can be used in a binding. MobX's `autoAction`, which
 * `makeObservable` uses for methods.
 */
export function autoAction<This, Args extends unknown[], R>(
  fn: (this: This, ...args: Args) => R,
): (this: This, ...args: Args) => R {
  const asAction = action(fn);
  return function (this: This, ...args: Args): R {
    return activeTracker ? fn.apply(this, args) : asAction.apply(this, args);
  };
}
