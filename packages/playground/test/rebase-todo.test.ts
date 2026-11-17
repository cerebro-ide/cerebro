import { describe, expect, it } from 'vitest';
import {
  groupOf,
  initialRows,
  isChild,
  isRoot,
  messageOf,
  prettySquash,
  RebaseTodo,
  type TodoCommit,
} from '../src/rebase-todo.js';

const commit = (name: string): TodoCommit => ({ hash: name, subject: name, message: name });
/** A list of commits a, b, c… picked. */
const todo = (names = 'abcde') => new RebaseTodo(initialRows(names.split('').map(commit)));
/** The list as `hash:type` words, a reword with its message. */
const shown = (list: RebaseTodo) =>
  list.rows
    .map((row) => `${row.commit.hash}:${row.type}${row.message ? `(${row.message})` : ''}`)
    .join(' ');

describe('the Interactive Rebase dialog’s list, as IntelliJ’s GitRebaseTodoModel', () => {
  it('starts with each commit picked, and says what each action can do', () => {
    const list = todo('abc');
    expect(shown(list)).toBe('a:pick b:pick c:pick');
    expect(list.canPick([0, 1])).toBe(false);
    expect(list.canEdit([0])).toBe(true);
    expect(list.canDrop([2])).toBe(true);
    expect(list.canReword(1)).toBe(true);
    list.edit([0, 1]);
    list.drop([2]);
    expect(shown(list)).toBe('a:edit b:edit c:drop');
    expect(list.canEdit([0, 1])).toBe(false);
    expect(list.canPick([0])).toBe(true);
    expect(list.canDrop([2])).toBe(false);
    list.pick([1]);
    list.reword(0, 'A');
    expect(shown(list)).toBe('a:reword(A) b:pick c:drop');
    expect(messageOf(list.rows[0] as never)).toBe('A');
    expect(messageOf(list.rows[1] as never)).toBe('b');
    // Picked again, the message goes.
    list.pick([0]);
    expect(shown(list)).toBe('a:pick b:pick c:drop');
  });

  it('unites rows, those below fixed up into the first, moved after it', () => {
    const list = todo();
    expect(list.canUnite([1])).toBe(false);
    expect(list.canUnite([1, 3])).toBe(true);
    expect(list.unite([1, 3])).toBe(1);
    expect(shown(list)).toBe('a:pick b:pick d:fixup c:pick e:pick');
    expect([isRoot(list.rows, 1), isChild(list.rows, 2), isRoot(list.rows, 3)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(groupOf(list.rows, 2)).toEqual([1, 2]);
    expect(groupOf(list.rows, 0)).toEqual([0, 0]);
    // One group already: nothing to unite.
    expect(list.canUnite([1, 2])).toBe(false);
    // Another row, from its child: into the same group, after its last child.
    expect(list.canUnite([2, 4])).toBe(true);
    expect(list.unite([2, 4])).toBe(1);
    expect(shown(list)).toBe('a:pick b:pick d:fixup e:fixup c:pick');
    // The root, a child of its own and another: the child stays where it is.
    expect(list.unite([1, 2, 4])).toBe(1);
    expect(shown(list)).toBe('a:pick b:pick d:fixup e:fixup c:fixup');
  });

  it('unites a dropped row as the root, picked; another group whole, its message gone', () => {
    const list = todo();
    list.drop([0]);
    list.unite([2, 3]);
    list.reword(4, 'E');
    expect(shown(list)).toBe('a:drop b:pick c:pick d:fixup e:reword(E)');
    expect(list.unite([0, 2, 4])).toBe(0);
    expect(shown(list)).toBe('a:pick c:fixup d:fixup e:fixup b:pick');
    expect(list.entries()).toEqual([
      { action: 'pick', hash: 'a' },
      { action: 'fixup', hash: 'c' },
      { action: 'fixup', hash: 'd' },
      { action: 'fixup', hash: 'e' },
      { action: 'pick', hash: 'b' },
    ]);
  });

  it('finds the rows Squash and Fixup unite: those selected, or one with the kept row above', () => {
    const list = todo('abcd');
    expect(list.toUnite([1, 2])).toEqual([1, 2]);
    expect(list.toUnite([2])).toEqual([1, 2]);
    // None kept above: a dropped one doesn't count, nor the first row.
    expect(list.toUnite([0])).toBeUndefined();
    list.drop([0]);
    expect(list.toUnite([1])).toBeUndefined();
    // A child alone: its group already, nothing to unite.
    list.unite([2, 3]);
    expect(list.toUnite([3])).toBeUndefined();
    expect(list.toUnite([1, 2, 3])).toEqual([1, 2, 3]);
    expect(list.toUnite([])).toBeUndefined();
  });

  it('takes a child out of its group when it’s given its own action, after the group', () => {
    const list = todo();
    list.unite([0, 1, 2, 3]);
    expect(shown(list)).toBe('a:pick b:fixup c:fixup d:fixup e:pick');
    list.edit([1]);
    expect(shown(list)).toBe('a:pick c:fixup d:fixup b:edit e:pick');
    list.reword(1, 'C');
    expect(shown(list)).toBe('a:pick d:fixup c:reword(C) b:edit e:pick');
    // A child can't be reworded where it is; its root can.
    expect(list.canReword(1)).toBe(false);
    expect(list.canReword(0)).toBe(true);
    // The last child out: the root's on its own again, its action kept.
    list.edit([0]);
    list.pick([1]);
    expect(shown(list)).toBe('a:edit d:pick c:reword(C) b:edit e:pick');
    expect(isRoot(list.rows, 0)).toBe(false);
  });

  it('drops a group with its root, and a child out of its group', () => {
    const list = todo();
    list.unite([0, 1, 2]);
    list.drop([0]);
    expect(shown(list)).toBe('a:drop b:drop c:drop d:pick e:pick');
    const other = todo();
    other.unite([0, 1, 2]);
    // From the last: each child taken out to its group's end, where it is.
    other.drop([1, 2, 3]);
    expect(shown(other)).toBe('a:pick b:drop c:drop d:drop e:pick');
  });

  it('moves a row, a root with its group, a child out of it, and into a group above a child', () => {
    const list = todo();
    list.move(4, 0);
    expect(shown(list)).toBe('e:pick a:pick b:pick c:pick d:pick');
    list.unite([1, 2]);
    // The root moves its group.
    list.move(1, 3);
    expect(shown(list)).toBe('e:pick c:pick d:pick a:pick b:fixup');
    // A row moved in above a child joins its group: the index is where it ends up.
    list.move(0, 3);
    expect(shown(list)).toBe('c:pick d:pick a:pick e:fixup b:fixup');
    // A child moved up: out of its group, picked, where it's put.
    list.move(3, 0);
    expect(shown(list)).toBe('e:pick c:pick d:pick a:pick b:fixup');
    // A child moved down to where it's taken out to: back in, last.
    list.move(0, 4);
    list.unite([2, 4]);
    expect(shown(list)).toBe('c:pick d:pick a:pick b:fixup e:fixup');
    list.move(3, 4);
    expect(shown(list)).toBe('c:pick d:pick a:pick e:fixup b:fixup');
    // Past either end: kept at it.
    list.move(0, -3);
    list.move(0, 99);
    expect(shown(list)).toBe('d:pick a:pick e:fixup b:fixup c:pick');
  });

  it('gives git a reword with its message', () => {
    const list = todo('ab');
    list.reword(1, 'B\n\nwhy');
    expect(list.entries()).toEqual([
      { action: 'pick', hash: 'a' },
      { action: 'reword', hash: 'b', message: 'B\n\nwhy' },
    ]);
  });
});

describe('the squashed message, as IntelliJ’s GitSquashedCommitsMessage.prettySquash', () => {
  // IntelliJ's own tests (GitSquashedCommitsMessageTest), each a case here.
  it('leaves out duplicates', () => {
    expect(prettySquash(['fix', 'fix', 'fix!!!', 'fix'])).toBe('fix\n\n\nfix!!!');
  });

  it('takes off autosquash subjects', () => {
    expect(
      prettySquash([
        'amend! test commit\n\namend message',
        'squash! test commit\n\nsquash message',
        'fixup! test commit',
        'test commit',
      ]),
    ).toBe('amend message\n\n\nsquash message\n\n\ntest commit');
  });

  it('squashes two fixup commits, and with their commit', () => {
    expect(prettySquash(['fixup! msg', 'fixup! msg'])).toBe('fixup! msg');
    expect(prettySquash(['fixup! msg', 'fixup! msg', 'msg'])).toBe('msg');
  });

  it('keeps an autosquash subject whose commit isn’t there', () => {
    expect(prettySquash(['???', 'fixup! msg'])).toBe('???\n\n\nfixup! msg');
  });
});
