// The Interactive Rebase dialog's list, as IntelliJ's `GitRebaseTodoModel` (read from its source):
// each commit with what's done with it, oldest first, as git lists them. Squash and Fixup unite
// commits: a commit kept (picked, edited or reworded) with the commits after it fixed up into it,
// IntelliJ's "unite group". Here a group is a kept row and the `fixup` rows right after it, which
// is how IntelliJ gives the list to git (`convertToEntries`: a child's command is `fixup`), so each
// of its rules is kept on a flat list. Its `update-ref` rows aren't Cerebro's: its rebase turns
// them off (`interactive-rebase.ts` in the host).

/** A commit the rebase goes through, as the host lists it. */
export interface TodoCommit {
  hash: string;
  subject: string;
  /** Its whole message. */
  message: string;
}

/** What's done with a commit: `fixup` is a row united with the kept one above it. */
export type TodoType = 'pick' | 'edit' | 'reword' | 'drop' | 'fixup';

export interface TodoRow {
  commit: TodoCommit;
  type: TodoType;
  /** A reworded commit's new message. */
  message?: string;
}

/** IntelliJ's types that keep a commit (`KeepCommit`): those a group's first row can be. */
const kept = (type: TodoType) => type === 'pick' || type === 'edit' || type === 'reword';

/** The rows to start with: each commit picked. */
export function initialRows(commits: readonly TodoCommit[]): TodoRow[] {
  return commits.map((commit) => ({ commit, type: 'pick' }));
}

/** A commit's message as the list has it: reworded, or its own (`getCommitMessage`). */
export function messageOf(row: TodoRow): string {
  return row.type === 'reword' ? (row.message as string) : row.commit.message;
}

/** Whether a row is fixed up into the one above (IntelliJ's `UniteChild`). */
export const isChild = (rows: readonly TodoRow[], index: number) => rows[index]?.type === 'fixup';

/** Whether a row has rows fixed up into it (IntelliJ's `UniteRoot`). */
export const isRoot = (rows: readonly TodoRow[], index: number) =>
  !isChild(rows, index) && isChild(rows, index + 1);

/** The group a row is in, as its first and last index: a row on its own is its own group. */
export function groupOf(rows: readonly TodoRow[], index: number): [number, number] {
  let first = index;
  while (isChild(rows, first)) first--;
  let last = first;
  while (isChild(rows, last + 1)) last++;
  return [first, last];
}

/** Rows that are neither a root nor a child (IntelliJ's `Simple`). */
const simple = (rows: readonly TodoRow[], index: number) =>
  !isChild(rows, index) && !isRoot(rows, index);

/** A list being edited: IntelliJ's model's actions, on rows the dialog shows. */
export class RebaseTodo {
  rows: TodoRow[];

  constructor(rows: readonly TodoRow[]) {
    this.rows = rows.map((row) => ({ ...row }));
  }

  canPick(indices: readonly number[]): boolean {
    return indices.some((i) => this.rows[i]?.type !== 'pick');
  }

  pick(indices: readonly number[]): void {
    this.keep(indices, 'pick');
  }

  canEdit(indices: readonly number[]): boolean {
    return indices.some((i) => this.rows[i]?.type !== 'edit');
  }

  edit(indices: readonly number[]): void {
    this.keep(indices, 'edit');
  }

  canReword(index: number): boolean {
    return !isChild(this.rows, index);
  }

  reword(index: number, message: string): void {
    this.keep([index], 'reword', message);
  }

  canDrop(indices: readonly number[]): boolean {
    return indices.some((i) => this.rows[i]?.type !== 'drop');
  }

  /** Drops the rows: a root's group with it, a child taken out of its group (`drop`). */
  drop(indices: readonly number[]): void {
    const rows = this.rows;
    const roots = indices.filter((i) => isRoot(rows, i));
    for (const i of indices) if (simple(rows, i)) this.set(i, 'drop');
    for (const root of roots) {
      const [, last] = groupOf(rows, root);
      for (let i = root; i <= last; i++) this.set(i, 'drop');
    }
    for (const i of [...indices].sort((a, b) => b - a)) {
      if (isChild(rows, i)) this.takeOut(i, 'drop');
    }
  }

  /** Whether the rows, in order, can be united: two or more, not one group already (`canUnite`). */
  canUnite(indices: readonly number[]): boolean {
    if (indices.length < 2) return false;
    const first = indices[0] as number;
    if (simple(this.rows, first)) return true;
    const [root] = groupOf(this.rows, first);
    return indices
      .slice(1)
      .some((i) => !isChild(this.rows, i) || groupOf(this.rows, i)[0] !== root);
  }

  /**
   * The rows Squash and Fixup unite (`getIndicesToUnite`): those selected, or one with the
   * nearest kept row above it (`findNewRoot`); undefined if none.
   */
  toUnite(indices: readonly number[]): number[] | undefined {
    if (this.canUnite(indices)) return [...indices];
    if (indices.length !== 1) return undefined;
    const index = indices[0] as number;
    const above = this.rows.slice(0, index).findLastIndex((row) => kept(row.type));
    const both = [above, index];
    return above >= 0 && this.canUnite(both) ? both : undefined;
  }

  /**
   * Unites the rows (`unite`): the first's group is the root's (a dropped row picked), and the
   * others, a root with its group, are fixed up into it, moved after it. Gives the root's index.
   */
  unite(indices: readonly number[]): number {
    const rows = this.rows;
    const first = indices[0] as number;
    const [root, last] = groupOf(rows, first);
    if (!kept((rows[root] as TodoRow).type)) this.set(root, 'pick');
    const joining = new Set<number>();
    for (const i of indices.slice(1)) {
      if (isChild(rows, i) && groupOf(rows, i)[0] === root) continue;
      const [from, to] = isRoot(rows, i) ? groupOf(rows, i) : [i, i];
      for (let j = from; j <= to; j++) joining.add(j);
    }
    // All after the root's group: the first row is the lowest, its root above it.
    const moved = [...joining].sort((a, b) => a - b).map((i) => rows[i] as TodoRow);
    const rest = rows.filter((_, i) => !joining.has(i));
    for (const row of moved) {
      row.type = 'fixup';
      delete row.message;
    }
    rest.splice(last + 1, 0, ...moved);
    this.rows = rest;
    return root;
  }

  /**
   * Moves a row to another index (`exchangeIndices`), as Move Up and Move Down do: a root with its
   * group; a child out of its group first, picked. A row moved in above a child joins its group.
   */
  move(from: number, to: number): void {
    const rows = this.rows;
    let group: number[];
    if (isChild(rows, from)) {
      const at = this.takeOut(from, 'pick');
      // Moved to where it was taken out to, the group's last place: back in, last.
      if (at === to) {
        this.set(at, 'fixup');
        return;
      }
      group = [at];
    } else {
      const [first, last] = groupOf(rows, from);
      group = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    }
    const moving = group.map((i) => this.rows[i] as TodoRow);
    const rest = this.rows.filter((_, i) => !group.includes(i));
    const at = Math.min(Math.max(to, 0), rest.length);
    rest.splice(at, 0, ...moving);
    this.rows = rest;
    // `addToUniteGroupIfNeeded`: followed by a child, the rows join that group.
    if (isChild(this.rows, at + moving.length)) {
      for (let i = at; i < at + moving.length; i++) this.set(i, 'fixup');
    }
  }

  /** The list for git, oldest first: each commit with its action, a reword with its message. */
  entries(): { action: TodoType; hash: string; message?: string }[] {
    return this.rows.map((row) => ({
      action: row.type,
      hash: row.commit.hash,
      ...(row.type === 'reword' ? { message: row.message as string } : {}),
    }));
  }

  /** IntelliJ's `keepCommitAction`: each row given a kept type, a child taken out of its group. */
  private keep(indices: readonly number[], type: TodoType, message?: string): void {
    for (const i of [...indices].sort((a, b) => b - a)) {
      if (isChild(this.rows, i)) this.takeOut(i, type, message);
      else this.set(i, type, message);
    }
  }

  private set(index: number, type: TodoType, message?: string): void {
    const row = this.rows[index] as TodoRow;
    row.type = type;
    if (message === undefined) delete row.message;
    else row.message = message;
  }

  /**
   * A child out of its group (`removeAndMoveUniteChild`), given `type`, and moved to just after
   * the group: gives its index then.
   */
  private takeOut(index: number, type: TodoType, message?: string): number {
    const [, last] = groupOf(this.rows, index);
    const [row] = this.rows.splice(index, 1) as [TodoRow];
    this.rows.splice(last, 0, row);
    this.set(last, type, message);
    return last;
  }
}

const AUTOSQUASH = /^(fixup|squash|amend)! (.+)/;
const subjectOf = (message: string) => message.split('\n')[0] as string;

/**
 * IntelliJ's `GitSquashedCommitsMessage.prettySquash`: the messages, each once, blank lines between;
 * an autosquash commit's subject taken off where the commit it names is among them.
 */
export function prettySquash(messages: readonly string[]): string {
  const subjects = new Set(
    messages.filter((m) => !AUTOSQUASH.test(subjectOf(m))).map((m) => subjectOf(m)),
  );
  const kept = new Set<string>();
  for (const message of messages) {
    const target = AUTOSQUASH.exec(subjectOf(message))?.[2];
    if (target === undefined || !subjects.has(target)) {
      kept.add(message);
      continue;
    }
    const rest = message.includes('\n') ? message.slice(message.indexOf('\n') + 1).trim() : '';
    if (rest.trim() !== '') kept.add(rest);
  }
  return [...kept].join('\n\n\n');
}
