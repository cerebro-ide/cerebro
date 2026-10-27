// A file's text while it's open, as IntelliJ's documents: it outlives the editors that show it, so
// switching tabs keeps the edits, the selection and the undo history. It knows the text last read
// from or saved to disk, and so whether it's modified. Lines are joined as the file joined them:
// CodeMirror reads either separator, and writes `\n` unless told otherwise.

import { historyField } from '@codemirror/commands';
import { ChangeSet, Text } from '@codemirror/state';
import { computed, signal, type Computed, type Signal } from '@cerebro-ide/reactive';

/** The fields an editor's state is kept with between editors: the undo history with the rest. */
export const KEPT = { history: historyField };

export class EditorDocument {
  /** The text in the editor. */
  readonly text: Signal<Text>;
  /** The text on disk, as last read or saved. */
  readonly disk: Signal<Text>;
  /** Whether the text differs from what's on disk. */
  readonly modified: Computed<boolean>;
  /** How the file joins its lines. */
  readonly lineSeparator: '\n' | '\r\n';
  /** The last editor's state (selection, history), for the next one; undefined before any. */
  state: unknown;
  /** The last change made through `edit`: an editor showing the text it was made to takes it as an edit. */
  lastEdit: { before: Text; changes: ChangeSet } | undefined;

  constructor(content: string) {
    this.lineSeparator = content.includes('\r\n') ? '\r\n' : '\n';
    const text = textOf(content);
    this.text = signal(text);
    this.disk = signal(text);
    this.modified = computed(() => !this.text.get().eq(this.disk.get()));
  }

  /** The text as the file holds it, with its line separator. */
  content(): string {
    return this.text.peek().sliceString(0, undefined, this.lineSeparator);
  }

  /** The text was saved: it's what's on disk now. */
  saved(text: Text = this.text.peek()): void {
    this.disk.set(text);
  }

  /**
   * Changes the text from outside an editor (Replace in Files), at offsets into the text as it is.
   * An editor showing it takes the change as an edit, which undo takes back.
   */
  edit(changes: readonly { from: number; to: number; insert: string }[]): void {
    const before = this.text.peek();
    const set = ChangeSet.of(changes, before.length);
    this.lastEdit = { before, changes: set };
    this.text.set(set.apply(before));
  }

  /** Whether the file's content on disk is other than the text last read from or saved to it. */
  changedFrom(content: string): boolean {
    return !textOf(content).eq(this.disk.peek());
  }

  /**
   * A conflict between the edits and the file changed on disk, resolved, as IntelliJ's File Cache
   * Conflict: the text becomes `content` (the disk's, the edits', or a merge of both), as an edit undo
   * takes back, and the disk's is `disk`, so the next save writes the text over it.
   */
  resolve(content: string, disk: string): void {
    const before = this.text.peek().toString();
    const text = textOf(content).toString();
    // Only the part that differs is replaced, so a caret outside it stays where it was.
    let from = 0;
    while (from < before.length && from < text.length && before[from] === text[from]) from++;
    let end = 0;
    while (
      end < before.length - from &&
      end < text.length - from &&
      before[before.length - 1 - end] === text[text.length - 1 - end]
    ) {
      end++;
    }
    if (before !== text) {
      this.edit([{ from, to: before.length - end, insert: text.slice(from, text.length - end) }]);
    }
    this.disk.set(textOf(disk));
  }

  /**
   * The file changed on disk: its text replaces the document's unless that's modified, in which
   * case the edits are kept. Returns whether the text was replaced.
   */
  changedOnDisk(content: string): boolean {
    if (this.modified.peek()) return false;
    const text = textOf(content);
    if (text.eq(this.disk.peek())) return false;
    this.disk.set(text);
    this.text.set(text);
    return true;
  }
}

/** A file's content as CodeMirror's text, its lines split on either separator. */
function textOf(content: string): Text {
  return Text.of(content.split(/\r\n?|\n/));
}
