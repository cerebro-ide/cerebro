// The editor's context menu's Git submenu, as IntelliJ's `Git.ContextMenu` (git4idea's plugin.xml,
// read from its source): the file's actions (`Git.FileActions`), Resolve Conflicts, then the
// repository's (`GitRepositoryActions`), each group as IntelliJ's, of the commands Cerebro has.
// They act on the active editor's file, as from Git → Current File.

import type { MenuRegistry } from '@cerebro-ide/commands';

/** IntelliJ's groups, in its order: a command, or a submenu (the Rebase menu, as its own). */
const GROUPS: readonly (readonly (string | { submenu: string; label: string })[])[] = [
  [
    'vcs.annotate',
    'git.file.showDiff',
    'git.file.compareWithRevision',
    'git.file.compareWithBranch',
    'git.file.showHistory',
  ],
  ['vcs.resolveConflicts'],
  ['vcs.push', 'vcs.pull', 'vcs.fetch'],
  [
    'vcs.merge',
    'vcs.commitMerge',
    'vcs.abortMerge',
    'vcs.rebase',
    { submenu: 'main/git/rebase', label: '&Rebase' },
  ],
  ['git.branches', 'git.newBranch', 'git.newTag', 'git.reset'],
  ['vcs.stash', 'vcs.unstash'],
  ['git.manageRemotes'],
  ['vcs.abortRevert', 'vcs.abortCherryPick', 'vcs.continueCherryPick'],
];

/** The Git submenu, after Local History in the editor's context menu. */
export function setupEditorGitMenu(menus: MenuRegistry): void {
  menus.contribute({
    menu: 'editor/content',
    item: { submenu: 'editor/git', label: 'Git' },
    group: 'h-history',
    order: 1,
  });
  GROUPS.forEach((items, group) => {
    for (const item of items) {
      menus.contribute({
        menu: 'editor/git',
        item: typeof item === 'string' ? { command: item } : item,
        group: String.fromCharCode(97 + group),
      });
    }
  });
}
