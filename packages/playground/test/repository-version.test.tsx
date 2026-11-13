import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { revisionOf, revisionTab, tabPath } from '../src/changes.js';
import { RepositoryVersion } from '../src/repository-version.js';
import { FakeHost } from './fakes.js';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

function show(host: FakeHost | undefined, path = 'src/a.ts') {
  const box = document.createElement('div');
  box.style.height = '300px';
  document.body.append(box);
  const handle = render(
    () => (
      <RepositoryVersion
        host={host}
        worktree="/r"
        path={path}
        hash="c0ffee"
        fontSize={() => 13}
        tabSize={() => 4}
      />
    ),
    box,
  );
  dispose = () => {
    handle.dispose();
  };
  return box;
}

const note = () => document.querySelector('.playground-code__note')?.textContent;

describe('a repository version’s tab', () => {
  it('is named as IntelliJ’s, the file’s name and the revision, and shows that file', () => {
    const tab = revisionTab('src/a.ts', 'c0ffee');
    expect(tab).toEqual({ id: 'rev@c0ffee:src/a.ts', title: 'a.ts (c0ffee)' });
    expect(revisionOf(tab.id)).toEqual({ path: 'src/a.ts', hash: 'c0ffee' });
    expect(tabPath(tab.id)).toBe('src/a.ts');
    expect(revisionOf('/r/src/a.ts')).toBeUndefined();
  });
});

describe('a file as it was at a commit', () => {
  it('shows its text read-only', async () => {
    const host = new FakeHost({ 'git.fileAt': () => ({ text: 'const then = 1;' }) });
    show(host);
    expect(note()).toBe('Loading…');
    await expect
      .poll(() =>
        document.querySelector('.cerebro-editor-code')?.shadowRoot?.querySelector('.cm-content'),
      )
      .toBeTruthy();
    const content = document
      .querySelector('.cerebro-editor-code')
      ?.shadowRoot?.querySelector('.cm-content') as HTMLElement;
    expect(content.textContent).toBe('const then = 1;');
    // Typed into, it stays as it was.
    await userEvent.click(content);
    await userEvent.keyboard('x');
    expect(content.textContent).toBe('const then = 1;');
    expect(host.params('git.fileAt')).toEqual([{ path: '/r', hash: 'c0ffee', file: 'src/a.ts' }]);
  });

  it('says why where it can’t show it: binary, not there, or git’s words', async () => {
    show(new FakeHost({ 'git.fileAt': () => ({ binary: true }) }), 'b.png');
    await expect.poll(note).toBe('b.png is binary.');
    dispose?.();
    show(new FakeHost({ 'git.fileAt': () => null }));
    await expect.poll(note).toBe('src/a.ts isn’t in c0ffee.');
    dispose?.();
    show(new FakeHost({}));
    await expect.poll(note).toBe('Can’t open src/a.ts: No answer for git.fileAt');
  });

  it('says it shows in the desktop app, in a browser', () => {
    show(undefined);
    expect(note()).toBe('Repository versions show in the desktop app.');
  });
});
