// Ownership: what a part of the DOM created (bindings, nested regions, cleanups) belongs to an owner,
// and is disposed with it when that part is replaced or removed.

import { effect, type Disposable, type EffectFn } from '@cerebro-ide/reactive';

export class Owner implements Disposable {
  private cleanups: (() => void)[] = [];
  private disposed = false;

  add(cleanup: () => void): void {
    if (this.disposed) cleanup();
    else this.cleanups.push(cleanup);
  }

  /** Runs the cleanups in reverse order of registration. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}

let currentOwner: Owner | undefined;

export function runWithOwner<T>(owner: Owner, fn: () => T): T {
  const previous = currentOwner;
  currentOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = previous;
  }
}

export function requireOwner(what: string): Owner {
  if (!currentOwner) {
    throw new Error(`${what} must be created while rendering: inside render() or a component`);
  }
  return currentOwner;
}

/** Registers `fn` to run when the current component or region is disposed. */
export function onCleanup(fn: () => void): void {
  requireOwner('onCleanup').add(fn);
}

/** An effect owned by the current owner. */
export function bind(fn: EffectFn): void {
  const owner = requireOwner('A reactive binding');
  const handle = effect(fn);
  owner.add(() => {
    handle.dispose();
  });
}
