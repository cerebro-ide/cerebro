// What the playground's tests stand in for: a project's host, answering what each test says, and
// the dialogs and popups a person answers.

import { signal } from '@cerebro-ide/reactive';
import { expect } from 'vitest';
import { userEvent } from 'vitest/browser';
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

/** Closes whatever dialog or popup a test left open. */
export async function closeAll(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    if (!document.querySelector('.cerebro-dialog, .cerebro-popup')) return;
    await userEvent.keyboard('{Escape}');
  }
}
