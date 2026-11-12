// What the playground's tests stand in for: a project's host, answering what each test says, and
// the dialogs and popups a person answers.

import { signal } from '@cerebro-ide/reactive';
import type { EditorDocument } from '@cerebro-ide/ui-editor';
import { expect } from 'vitest';
import { userEvent } from 'vitest/browser';
import { documentFor } from '../src/documents.js';
import type { Host, HostWorktree, ProjectState } from '../src/environments.js';

type Answer = (params: never) => unknown;

/** A host that answers each method as `answers` says, and fails others; it keeps what it's asked. */
export class FakeHost implements Host {
  readonly asked: { method: string; params: unknown }[] = [];

  constructor(readonly answers: Record<string, Answer> = {}) {}

  request(method: string, params?: unknown): Promise<unknown> {
    this.asked.push({ method, params });
    const answer = this.answers[method];
    if (!answer) return Promise.reject(new Error(`No answer for ${method}`));
    return Promise.resolve().then(() => answer(params as never));
  }

  /** The params of each request for `method`, in order. */
  params(method: string): unknown[] {
    return this.asked.filter((a) => a.method === method).map((a) => a.params);
  }
}

/**
 * A file's document, read through `host` and edited, not saved: `host` answers its read and write
 * (`fs.read`, `fs.write`) if it doesn't already, as a disk would.
 */
export async function unsavedEdit(host: FakeHost, path: string): Promise<EditorDocument> {
  const answers = host.answers;
  // A disk that has what was written: an edit after a save isn't a conflict.
  const disk = new Map<string, string>();
  answers['fs.read'] ??= (params: { path: string }) => ({ text: disk.get(params.path) ?? '' });
  answers['fs.write'] ??= (params: { path: string; text: string }) => {
    disk.set(params.path, params.text);
    return null;
  };
  const doc = (await documentFor(path)) as EditorDocument;
  doc.edit([{ from: 0, to: 0, insert: 'x' }]);
  return doc;
}

/** Whether `path` was written (`fs.write`) before the host was first asked for `method`. */
export function savedBefore(host: FakeHost, path: string, method: string): boolean {
  const write = host.asked.findIndex(
    (a) => a.method === 'fs.write' && (a.params as { path: string }).path === path,
  );
  const call = host.asked.findIndex((a) => a.method === method);
  return write !== -1 && call !== -1 && write < call;
}

/** A worktree, as the host lists it. */
export function worktree(path: string, branch?: string, main = false): HostWorktree {
  return { path, branch, main, bare: false };
}

/** A git project open in the window, with its worktrees. */
export function project(
  path: string,
  host: Host | undefined,
  worktrees: { id: string; branch: string }[] = [{ id: path, branch: 'main' }],
): ProjectState {
  return {
    path,
    name: path.split('/').at(-1) as string,
    host,
    main: path,
    git: true,
    worktrees: signal(worktrees.map((w) => ({ ...w, name: w.id.split('/').at(-1) as string }))),
    branches: signal([...new Set(worktrees.map((w) => w.branch))]),
  };
}

/** The open dialog, once there is one. */
export async function dialog(): Promise<HTMLElement> {
  await expect.poll(() => document.querySelector('.cerebro-dialog')).not.toBeNull();
  return document.querySelector('.cerebro-dialog') as HTMLElement;
}

/** The open dialog's text, and its buttons' labels. */
export async function dialogText(): Promise<string> {
  return ((await dialog()).querySelector('.cerebro-dialog__content')?.textContent ?? '').trim();
}

/** Clicks a button of the open dialog, by its label. */
export async function press(label: string): Promise<void> {
  const button = [...(await dialog()).querySelectorAll('.cerebro-dialog__button')].find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`No button ${label} in the dialog`);
  await userEvent.click(button);
  await expect.poll(() => button.isConnected).toBe(false);
}

/** Types into the open prompt, replacing its text. */
export async function answer(text: string): Promise<HTMLInputElement> {
  const input = (await dialog()).querySelector('input') as HTMLInputElement;
  await userEvent.clear(input);
  if (text !== '') await userEvent.type(input, text);
  return input;
}

/** The open popup's items: their labels, and groups where they start. */
export async function popupItems(): Promise<string[]> {
  await expect.poll(() => document.querySelector('.cerebro-popup')).not.toBeNull();
  return [...document.querySelectorAll('.cerebro-popup-item__label')].map((l) => l.textContent);
}

/** The open menu's items' labels. */
export async function menuItems(): Promise<string[]> {
  await expect.poll(() => document.querySelector('.cerebro-menu')).not.toBeNull();
  return [...document.querySelectorAll('.cerebro-menu-item__label')].map((l) => l.textContent);
}

/** The open menu's item labelled `label`. */
export function menuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('.cerebro-menu-item')].find(
    (i) => i.querySelector('.cerebro-menu-item__label')?.textContent === label,
  );
  if (!item) throw new Error(`No item ${label} in the menu`);
  return item;
}

/** Closes whatever dialog or popup a test left open. */
export async function closeAll(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    if (!document.querySelector('.cerebro-dialog, .cerebro-popup, .cerebro-menu')) return;
    await userEvent.keyboard('{Escape}');
  }
}
