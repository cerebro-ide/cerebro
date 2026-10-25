// Environments: a worktree with its session, open as tabs, one active. Each has its own editor area;
// the tool window layout is shared by all, so switching doesn't rearrange the window.

import { makeObservable } from '@cerebro-ide/reactive';
import { EditorArea } from './editor-area.js';

export interface EnvironmentSpec {
  id: string;
  name: string;
  branch: string;
}

export class Environment {
  readonly id: string;
  name: string;
  branch: string;
  readonly editor = new EditorArea();

  constructor(spec: EnvironmentSpec) {
    this.id = spec.id;
    this.name = spec.name;
    this.branch = spec.branch;
    makeObservable(this);
  }
}

export class Environments {
  /** The open environments, in tab order. */
  open: readonly Environment[] = [];
  activeId: string | undefined = undefined;

  constructor() {
    makeObservable(this);
  }

  get active(): Environment | undefined {
    return this.open.find((e) => e.id === this.activeId);
  }

  get(id: string): Environment {
    const env = this.open.find((e) => e.id === id);
    if (!env) throw new Error(`Environment "${id}" is not open`);
    return env;
  }

  /** Switches to an open environment, or opens it after the active one. */
  openOrActivate(spec: EnvironmentSpec): Environment {
    const existing = this.open.find((e) => e.id === spec.id);
    if (existing) {
      this.activeId = existing.id;
      return existing;
    }
    const env = new Environment(spec);
    const index = this.open.findIndex((e) => e.id === this.activeId) + 1;
    this.open = [...this.open.slice(0, index), env, ...this.open.slice(index)];
    this.activeId = env.id;
    return env;
  }

  activate(id: string): void {
    this.activeId = this.get(id).id;
  }

  /** Closes an environment; the next one (or the previous, for the last) becomes active. */
  close(id: string): void {
    const index = this.open.findIndex((e) => e.id === id);
    if (index < 0) return;
    const open = this.open.filter((e) => e.id !== id);
    this.open = open;
    if (this.activeId === id) this.activeId = (open[index] ?? open[index - 1])?.id;
  }

  /** Moves an environment's tab to `index`. */
  move(id: string, index: number): void {
    const env = this.get(id);
    const rest = this.open.filter((e) => e !== env);
    const at = Math.min(Math.max(index, 0), rest.length);
    this.open = [...rest.slice(0, at), env, ...rest.slice(at)];
  }
}
