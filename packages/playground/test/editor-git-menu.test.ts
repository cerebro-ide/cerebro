import { MenuRegistry } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import { describe, expect, it } from 'vitest';
import { setupEditorGitMenu } from '../src/editor-git-menu.js';

describe('the editor’s Git submenu', () => {
  it('is after Local History, with IntelliJ’s Git.ContextMenu groups of Cerebro’s commands', () => {
    const menus = new MenuRegistry();
    const git = signal(true);
    setupEditorGitMenu(menus, () => git.get());
    expect(menus.entries('editor/content')).toEqual([{ submenu: 'editor/git', label: 'Git' }]);
    expect(menus.contributions.toArray()[0]).toMatchObject({ group: 'h-history', order: 1 });
    // A tab's and the Project view's too, after their Local History.
    expect(menus.entries('editor/tab')).toEqual([{ submenu: 'editor/git', label: 'Git' }]);
    expect(menus.contributions.toArray()[1]).toMatchObject({ group: 'h-history', order: 1 });
    expect(menus.entries('project/node')).toEqual([{ submenu: 'editor/git', label: 'Git' }]);
    expect(menus.contributions.toArray()[2]).toMatchObject({ group: 'f-vcs', order: 1 });
    // Not in a git repository: none.
    git.set(false);
    expect(menus.entries('editor/content')).toEqual([]);
    expect(menus.entries('editor/tab')).toEqual([]);
    expect(menus.entries('project/node')).toEqual([]);
    git.set(true);
    expect(menus.entries('editor/content')).toHaveLength(1);
    const names = menus
      .entries('editor/git')
      .map((e) => ('command' in e ? e.command : 'submenu' in e ? e.submenu : '-'));
    expect(menus.entries('editor/git/ignore')).toEqual([
      { command: 'git.file.ignore' },
      { command: 'git.file.exclude' },
    ]);
    expect(names).toEqual([
      'git.file.commit',
      'git.file.add',
      'editor/git/ignore',
      '-',
      'vcs.annotate',
      'git.file.showDiff',
      'git.file.compareWithRevision',
      'git.file.compareWithBranch',
      'git.file.showHistory',
      'git.file.showCurrentRevision',
      'git.file.rollback',
      '-',
      'vcs.resolveConflicts',
      '-',
      'vcs.push',
      'vcs.pull',
      'vcs.fetch',
      '-',
      'vcs.merge',
      'vcs.commitMerge',
      'vcs.abortMerge',
      'vcs.rebase',
      'main/git/rebase',
      '-',
      'git.branches',
      'git.newBranch',
      'git.newTag',
      'git.reset',
      '-',
      'vcs.stash',
      'vcs.unstash',
      '-',
      'git.manageRemotes',
      '-',
      'vcs.abortRevert',
      'vcs.abortCherryPick',
      'vcs.continueCherryPick',
    ]);
  });
});
