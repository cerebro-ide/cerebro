import { beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { diffSource } from '@cerebro-ide/ui-editor';
import type { DiffSpec } from '../src/bridge.js';

// A diff window of a file as it is (diff-window.test has one between commits): its right side is
// its opener's document, told by the opener and edited there, as IntelliJ's diff edits the file's
// one document. Made once, as it's imported: each test goes on from where the last left it.

/** What the diff window asked of its opener: a document (null), or an edit. */
const asked: [string, string | null][] = [];
let told: (path: string, text: string | null) => void = () => undefined;
const FILE = '/r/w/src/a.ts';
// At a line, as Show Diff opens it from the editor's caret: its first, not the change at its second.
const SPEC: DiffSpec = { project: '/r', env: '/r/w', path: 'src/a.ts', line: 0 };

beforeAll(async () => {
  window.cerebro = {
    app: true,
    platform: 'linux',
    window: { setColours: () => undefined },
    host: {
      // As on disk: the document has its edits, unsaved.
      request: () => Promise.resolve({ original: 'one\ntwo\n', text: 'one\nsaved\n' }),
    },
    diff: {
      document: (path: string, text: string | null) => {
        asked.push([path, text]);
        if (text === null) {
          queueMicrotask(() => {
            told(path, 'one\nedited\n');
          });
        }
        return Promise.resolve();
      },
      onDocument: (listener: typeof told) => {
        told = listener;
        return () => undefined;
      },
      onMove: () => () => undefined,
    },
  } as unknown as NonNullable<Window['cerebro']>;
  location.hash = `#diff=${encodeURIComponent(JSON.stringify(SPEC))}`;
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/diff-window.js');
});

const root = () => document.querySelector('.cerebro-editor-diff')?.shadowRoot;
const sides = () =>
  [...(root()?.querySelectorAll('.cm-content') ?? [])].map((side) => side.textContent);
const right = () => root()?.querySelectorAll('.cm-content')[1] as HTMLElement;

describe('a diff window of a file as it is', () => {
  it('shows its opener’s document on the right, its edits unsaved too', async () => {
    await expect.poll(sides).toEqual(['onetwo', 'oneedited']);
    expect(asked).toEqual([[FILE, null]]);
  });

  it('starts at the line it was opened at', () => {
    expect(diffSource(root()?.host as Element)).toEqual({ line: 0, column: 0 });
  });

  it('edits the document through its opener, its own edits told back no news', async () => {
    await userEvent.click(right().querySelectorAll('.cm-line')[1] as Element);
    await userEvent.keyboard('{End}!');
    expect(asked.at(-1)).toEqual([FILE, 'one\nedited!\n']);
    await userEvent.keyboard('?');
    // Told back the first edit while the second is on its way: kept as typed.
    told(FILE, 'one\nedited!\n');
    told(FILE, 'one\nedited!?\n');
    expect(sides()).toEqual(['onetwo', 'oneedited!?']);
    // The caret where it was: the same editor.
    await userEvent.keyboard('.');
    expect(asked.at(-1)).toEqual([FILE, 'one\nedited!?.\n']);
    // Another text before it's told back: the edit will replace it, so it isn't shown.
    told(FILE, 'one\nelsewhere\n');
    expect(sides()).toEqual(['onetwo', 'oneedited!?.']);
    told(FILE, 'one\nedited!?.\n');
  });

  it('shows the document as it’s changed elsewhere (its file’s tab)', async () => {
    told(FILE, 'one\nretyped\n');
    await expect.poll(sides).toEqual(['onetwo', 'oneretyped']);
  });
});
