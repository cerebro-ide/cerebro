// Randomized: long runs of set, reset and load across the three layers, compared after each step
// with a plain model of what each layer holds and what an environment should see.

import { describe, it } from 'vitest';
import {
  SCOPES,
  Settings,
  SettingsLayer,
  SettingsRegistry,
  type Scope,
  type SettingSpec,
} from '../src/index.js';

const SPECS: SettingSpec[] = [
  { id: 'n', title: 'N', page: 'p', type: 'number', default: 5, min: 0, max: 10, integer: true },
  { id: 'b', title: 'B', page: 'p', type: 'boolean', default: false },
  { id: 's', title: 'S', page: 'p', type: 'string', default: '' },
  {
    id: 'e',
    title: 'E',
    page: 'p',
    type: 'enum',
    default: 'x',
    options: [
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
    ],
  },
  { id: 'g', title: 'G', page: 'p', type: 'boolean', default: true, scopes: ['global'] },
];

/** Candidate values: valid and invalid ones for each type. */
const VALUES: unknown[] = [0, 3, 10, 11, -1, 2.5, true, false, '', 'y', 'x', 'z', null, {}];

function random(seed: number) {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  return {
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
  };
}

/** Whether a value is valid for a spec, as the model sees it. */
function valid(spec: SettingSpec, value: unknown): boolean {
  switch (spec.type) {
    case 'number':
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'enum':
      return value === 'x' || value === 'y';
  }
}

const allowed = (spec: SettingSpec, scope: Scope) => spec.scopes?.includes(scope) ?? true;

describe('Settings, randomly', () => {
  it('match a plain model of the layers', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = random(seed);
      const registry = new SettingsRegistry();
      for (const spec of SPECS) registry.register(spec);
      const layers = {
        global: new SettingsLayer(registry, 'global'),
        repo: new SettingsLayer(registry, 'repo'),
        worktree: new SettingsLayer(registry, 'worktree'),
      };
      const settings = new Settings(registry, layers);
      const model: Record<Scope, Map<string, unknown>> = {
        global: new Map(),
        repo: new Map(),
        worktree: new Map(),
      };
      const log: string[] = [];
      for (let step = 0; step < 200; step++) {
        const scope = r.pick(SCOPES);
        const spec = r.pick(SPECS);
        const op = r.int(3);
        if (op === 0) {
          const value = r.pick(VALUES);
          log.push(`set ${scope} ${spec.id} ${JSON.stringify(value)}`);
          const ok = layers[scope].set(spec.id, value);
          const expected = allowed(spec, scope) && valid(spec, value);
          if (ok !== expected) throw new Error(`seed ${String(seed)}: ${log.slice(-5).join('; ')}`);
          if (expected) model[scope].set(spec.id, value);
        } else if (op === 1) {
          log.push(`reset ${scope} ${spec.id}`);
          layers[scope].reset(spec.id);
          model[scope].delete(spec.id);
        } else {
          // A file's contents: some known settings with good or bad values, and an unknown one.
          const file: Record<string, unknown> = { unknown: r.pick(VALUES) };
          for (const s of SPECS) if (r.int(2) === 0) file[s.id] = r.pick(VALUES);
          log.push(`load ${scope} ${JSON.stringify(file)}`);
          layers[scope].load(file);
          model[scope] = new Map(
            Object.entries(file).filter(([id, value]) => {
              const known = SPECS.find((s) => s.id === id);
              return !known || (allowed(known, scope) && valid(known, value));
            }),
          );
        }
        for (const s of SCOPES) {
          if (JSON.stringify(layers[s].toJSON()) !== JSON.stringify(Object.fromEntries(model[s]))) {
            throw new Error(`seed ${String(seed)}, ${s} layer: ${log.slice(-5).join('; ')}`);
          }
        }
        for (const s of SPECS) {
          const from = SCOPES.find((sc) => model[sc].has(s.id));
          const expected = from === undefined ? s.default : model[from].get(s.id);
          if (settings.get(s.id) !== expected || settings.scopeOf(s.id) !== from) {
            throw new Error(`seed ${String(seed)}, ${s.id}: ${log.slice(-5).join('; ')}`);
          }
        }
      }
    }
  });
});
