// A file changed both in the editor and on disk, resolved as IntelliJ's File Cache Conflict
// (ConflictResolverDialog.java, its words from UIBundle.properties): load what's on disk, keep the
// edits, or show the difference, the disk's on the left and the edits on the right, where they can
// be merged (an arrow by each change takes the disk's) and saved. Escape keeps the edits, as
// IntelliJ's Cancel.

import { openDialog } from '@cerebro-ide/ui-dialog';
import { DiffEditor, type EditorDocument } from '@cerebro-ide/ui-editor';

/** Asks how to resolve a conflict between a document's edits and its file on disk, and does it. */
export async function resolveConflict(
  path: string,
  doc: EditorDocument,
  disk: string,
): Promise<void> {
  for (;;) {
    const choice = await openDialog<'disk' | 'difference'>({
      title: 'File Cache Conflict',
      content: () => (
        <p class="cerebro-selectable">Changes have been made to ‘{path}’ in memory and on disk.</p>
      ),
      ok: { label: 'Load File System Changes', accept: () => 'disk' },
      choices: [{ label: 'Show Difference', accept: () => 'difference' }],
      cancelLabel: 'Keep Memory Changes',
    }).result;
    if (choice === 'disk') {
      doc.resolve(disk, disk);
      return;
    }
    if (choice === undefined) {
      doc.resolve(doc.content(), disk);
      return;
    }
    const merged = await merge(path, doc.content(), disk);
    if (merged !== undefined) {
      doc.resolve(merged, disk);
      return;
    }
  }
}

/** The disk's text beside the edits, which can take its changes: what's saved, or undefined. */
function merge(path: string, memory: string, disk: string): Promise<string | undefined> {
  let text = memory;
  return openDialog<string>({
    title: `File Cache Conflict ${path}`,
    width: 1000,
    content: () => (
      <div class="playground-conflict">
        <div class="playground-conflict__titles">
          <span>File system content</span>
          <span>Memory content</span>
        </div>
        <div class="playground-conflict__diff">
          <DiffEditor
            path={path}
            original={disk}
            text={memory}
            onEdit={(edited) => {
              text = edited;
            }}
          />
        </div>
      </div>
    ),
    ok: { label: 'Save Memory Content', accept: () => text },
  }).result;
}
