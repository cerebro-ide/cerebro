// The MobX-style layer: `makeObservable(this)` turns a class instance into an observable model.
// Fields become observable, getters become computed values and methods become actions. Values are
// stored as-is: a plain object in a field is not made observable; wrap it with `observableObject`.

import { action, Computed, Signal } from './core.js';

/** Accessors and actions this module defined, so a second call leaves them alone. */
const defined = new WeakSet<object>();

/**
 * Converts `target`'s own fields and its prototype chain's getters and methods, in place.
 * Call it once in each constructor of a class hierarchy; later calls convert only new fields.
 */
export function makeObservable<T extends object>(target: T): T {
  for (const key of Reflect.ownKeys(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key) as PropertyDescriptor;
    if (isDefined(descriptor)) continue;
    Object.defineProperty(target, key, convert(target, descriptor));
  }
  for (
    let proto: object | null = Object.getPrototypeOf(target) as object | null;
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const key of Reflect.ownKeys(proto)) {
      // An own property, or a subclass's member found earlier on the chain, takes precedence.
      if (key === 'constructor' || Object.prototype.hasOwnProperty.call(target, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, key) as PropertyDescriptor;
      Object.defineProperty(target, key, convert(target, descriptor));
    }
  }
  return target;
}

/**
 * Creates an observable object with the keys of `init`: values become observable, getters computed
 * values and methods actions. The shape is fixed: the object is sealed, so adding a key throws.
 * Use an `ObservableMap` for dynamic keys.
 */
export function observableObject<T extends object>(init: T): T {
  const target = Object.defineProperties({}, Object.getOwnPropertyDescriptors(init)) as T;
  return Object.seal(makeObservable(target));
}

function isDefined(descriptor: PropertyDescriptor): boolean {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- only compared, never called
  const fn: unknown = descriptor.get ?? descriptor.set ?? descriptor.value;
  return typeof fn === 'function' && defined.has(fn);
}

function convert(target: object, descriptor: PropertyDescriptor): PropertyDescriptor {
  const enumerable = descriptor.enumerable === true;
  if (descriptor.get || descriptor.set) {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with `target` as `this`
    const { get: getter, set: setter } = descriptor;
    const value = getter ? new Computed(() => getter.call(target) as unknown) : undefined;
    const get = value ? () => value.get() : undefined;
    const set = setter
      ? action((v: unknown) => {
          setter.call(target, v);
        })
      : undefined;
    const result: PropertyDescriptor = { enumerable, configurable: true };
    if (get) defined.add((result.get = get));
    if (set) defined.add((result.set = set));
    return result;
  }
  if (typeof descriptor.value === 'function') {
    const method = action(descriptor.value as (...args: unknown[]) => unknown);
    defined.add(method);
    return { value: method, enumerable, writable: true, configurable: true };
  }
  const value = new Signal<unknown>(descriptor.value);
  const get = () => value.get();
  defined.add(get);
  return {
    get,
    set: (v: unknown) => {
      value.set(v);
    },
    enumerable,
    configurable: true,
  };
}
