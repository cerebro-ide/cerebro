import { EditorDocument } from '@cerebro-ide/ui-editor';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { resolveConflict } from '../src/conflict.js';
import { closeAll, dialog, dialogText, press } from './fakes.js';

afterEach(closeAll);

/** A document edited to `edits`, its file since changed on disk to `disk`. */
function conflicted(edits: string): EditorDocument {
  const doc = new EditorDocument('base');
  doc.edit([{ from: 0, to: 4, insert: edits }]);
  return doc;
}

describe('a File Cache Conflict', () => {
  it('says what happened, as IntelliJ does', async () => {
    void resolveConflict('/r/a.ts', conflicted('mine'), 'theirs');
    expect(await dialogText()).toBe('Changes have been made to ‘/r/a.ts’ in memory and on disk.');
    expect(
      [...(await dialog()).querySelectorAll('.cerebro-dialog__button')].map((b) => b.textContent),
    ).toEqual(
      expect.arrayContaining([
        'Load File System Changes',
        'Show Difference',
        'Keep Memory Changes',
      ]),
    );
  });

  it('loads what’s on disk', async () => {
    const doc = conflicted('mine');
    const resolved = resolveConflict('/r/a.ts', doc, 'theirs');
    await press('Load File System Changes');
    await resolved;
    expect([doc.content(), doc.modified.peek()]).toEqual(['theirs', false]);
  });

  it('keeps the edits, to be written over the disk’s', async () => {
    const doc = conflicted('mine');
    const resolved = resolveConflict('/r/a.ts', doc, 'theirs');
    await press('Keep Memory Changes');
    await resolved;
    expect([doc.content(), doc.modified.peek(), doc.changedFrom('theirs')]).toEqual([
      'mine',
      true,
      false,
    ]);
  });

  it('shows the difference, where the two are merged and saved, or asks again', async () => {
    const doc = conflicted('mine');
    const resolved = resolveConflict('/r/a.ts', doc, 'theirs');
    await press('Show Difference');
    expect(document.querySelector('.cerebro-dialog__title')?.textContent).toContain(
      'File Cache Conflict /r/a.ts',
    );
    expect(document.querySelector('.playground-conflict__titles')?.textContent).toBe(
      'File system contentMemory content',
    );
    // Closed without saving: asked again.
    await press('Cancel');
    await press('Show Difference');
    const root = (document.querySelector('.cerebro-editor-diff') as HTMLElement)
      .shadowRoot as ShadowRoot;
    const memory = [...root.querySelectorAll<HTMLElement>('.cm-content')].at(-1) as HTMLElement;
    await userEvent.click(memory);
    await userEvent.keyboard('{End}+');
    await press('Save Memory Content');
    await resolved;
    expect([doc.content(), doc.changedFrom('theirs')]).toEqual(['mine+', false]);
  });
});
