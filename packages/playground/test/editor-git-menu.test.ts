import { MenuRegistry } from '@cerebro-ide/commands';
import { describe, expect, it } from 'vitest';
import { setupEditorGitMenu } from '../src/editor-git-menu.js';

describe('the editor’s Git submenu', () => {
  it('is after Local History, with IntelliJ’s Git.ContextMenu groups of Cerebro’s commands', () => {
    const menus = new MenuRegistry();
    setupEditorGitMenu(menus);
    expect(menus.entries('editor/content')).toEqual([{ submenu: 'editor/git', label: 'Git' }]);
    expect(menus.contributions.toArray()[0]).toMatchObject({ group: 'h-history', order: 1 });
    const names = menus
      .entries('editor/git')
      .map((e) => ('command' in e ? e.command : 'submenu' in e ? e.submenu : '-'));
    expect(names).toEqual([
      'vcs.annotate',
      'git.file.showDiff',
      'git.file.compareWithRevision',
      'git.file.compareWithBranch',
      'git.file.showHistory',
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
