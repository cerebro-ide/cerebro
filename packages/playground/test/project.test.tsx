import '../src/playground.css';
import { render } from '@cerebro-ide/jsx';
import type { Tab } from '@cerebro-ide/layout';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { RELOAD_EVERY } from '../src/documents.js';
import { useProjects, workspace } from '../src/environments.js';
import { fileProblems } from '../src/problems.js';
import {
  ProjectTree,
  projectFile,
  projectNode,
  selectInTree,
  type FileNode,
} from '../src/project.js';
import { FakeHost, project } from './fakes.js';

/** The host's folders, as it lists them. */
const folders: Record<string, FileNode[]> = {
  '/r': [
    { path: '/r/src', name: 'src', kind: 'directory' },
    { path: '/r/dist', name: 'dist', kind: 'directory', ignored: true },
    { path: '/r/README.md', name: 'README.md', kind: 'file' },
  ],
  '/r/src': [{ path: '/r/src/main.ts', name: 'main.ts', kind: 'file' }],
};
const host = new FakeHost({
  'fs.list': ({ path }: { path: string }) => folders[path] ?? [],
  'scratches.folder': () => '/data/scratches',
});
const SAMPLES = ['src/main.ts', 'README.md', 'src/lib/x.ts', 'docs/', 'src/a.ts'];

const opened: Tab[] = [];
const menus: MouseEvent[] = [];
let dispose: (() => void) | undefined;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  useProjects([project('/r', host), project('/s', undefined)]);
});

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  opened.length = 0;
  menus.length = 0;
  host.asked.length = 0;
  vi.restoreAllMocks();
});

function mount(): void {
  const handle = render(
    () => (
      <ProjectTree
        samples={SAMPLES}
        open={(tab) => void opened.push(tab)}
        menu={(event) => void menus.push(event)}
      />
    ),
    document.body,
  );
  dispose = () => {
    handle.dispose();
  };
}

const rows = () =>
  [...document.querySelectorAll('.cerebro-tree-row')].map((row) => row.textContent);
const row = (key: string) => document.querySelector(`[data-key="${key}"]`) as HTMLElement;
const selected = (key: string) =>
  document.querySelector(`[data-key="${key}"]`)?.getAttribute('aria-selected');
const lists = () => host.params('fs.list').length;

describe('the Project tool window', () => {
  it('says there’s no environment open', () => {
    mount();
    expect(document.querySelector('.playground-project')?.textContent).toBe('No environment open');
  });

  it('shows the worktree’s files from the host, under its folder, folders first, what git ignores dimmed', async () => {
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    mount();
    // The worktree's folder at the top, opened: its name in bold, then its path.
    await expect.poll(rows).toEqual(['r/r', 'src', 'dist', 'README.md', 'Scratches and Consoles']);
    expect(host.params('fs.list')).toEqual([{ path: '/r' }]);
    const root = row('/r').querySelector('.playground-project__root') as Element;
    expect([root.textContent, getComputedStyle(root).fontWeight]).toEqual(['r', '600']);
    expect(row('/r').querySelector('.playground-project__location')?.textContent).toBe('/r');
    expect(row('/r/dist').querySelector('.playground-change--ignored')?.textContent).toBe('dist');
    await userEvent.dblClick(row('/r/src'));
    await expect
      .poll(rows)
      .toEqual(['r/r', 'src', 'main.ts', 'dist', 'README.md', 'Scratches and Consoles']);
    await userEvent.dblClick(row('/r/src/main.ts'));
    expect(opened).toEqual([{ id: '/r/src/main.ts', title: 'main.ts' }]);
  });

  it('gives its selected file to the actions while it has the focus', async () => {
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    mount();
    await expect.poll(rows).toContain('README.md');
    expect(projectFile()).toBeUndefined();
    await userEvent.click(row('/r/README.md'));
    expect(projectFile()).toBe('/r/README.md');
    // A folder isn't a file.
    await userEvent.click(row('/r/src'));
    expect(projectFile()).toBeNull();
    // Elsewhere: none of its.
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    expect(projectFile()).toBeUndefined();
  });

  it('opens its menu on a row, selected, the focus left with it', async () => {
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    mount();
    await expect.poll(rows).toContain('README.md');
    await userEvent.click(row('/r/src'), { button: 'right' });
    expect(menus).toHaveLength(1);
    expect(selected('/r/src')).toBe('true');
    expect(projectNode()?.path).toBe('/r/src');
  });

  it('marks a file with errors, and the folders it’s in, with the error’s wave', async () => {
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    mount();
    // As the test before left it: src open.
    await expect
      .poll(rows)
      .toEqual(['r/r', 'src', 'main.ts', 'dist', 'README.md', 'Scratches and Consoles']);
    const marked = () =>
      [...document.querySelectorAll('.playground-problem-file')].map((m) => m.textContent);
    expect(marked()).toEqual([]);
    const error = { from: { line: 0, column: 0 }, to: { line: 0, column: 1 }, message: 'x' };
    fileProblems.set('/r/src/main.ts', [{ ...error, severity: 'warning' }]);
    expect(marked()).toEqual([]);
    fileProblems.set('/r/src/main.ts', [{ ...error, severity: 'error' }]);
    expect(marked()).toEqual(['r', 'src', 'main.ts']);
    const style = getComputedStyle(document.querySelector('.playground-problem-file') as Element);
    expect([style.textDecorationLine, style.textDecorationStyle]).toEqual(['underline', 'wavy']);
    fileProblems.clear();
    expect(marked()).toEqual([]);
  });

  it('reads the folders again as the window gets the focus, and now and then while it has it', async () => {
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    mount();
    await expect.poll(rows).not.toEqual([]);
    const before = lists();
    window.dispatchEvent(new Event('focus'));
    await expect.poll(lists).toBeGreaterThan(before);
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    await expect.poll(() => Promise.resolve(lists())).toBe(lists());
    const now = lists();
    vi.advanceTimersByTime(RELOAD_EVERY);
    expect(lists()).toBe(now);
    focused.mockReturnValue(true);
    vi.advanceTimersByTime(RELOAD_EVERY);
    await expect.poll(lists).toBeGreaterThan(now);
    // Not once it's gone.
    dispose?.();
    dispose = undefined;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = lists();
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(RELOAD_EVERY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lists()).toBe(after);
  });

  it('shows the samples as a tree in a browser, each environment’s its own', async () => {
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    mount();
    // Under the environment's folder, with no path to show.
    await expect.poll(rows).toEqual(['s', 'docs', 'src', 'README.md']);
    await userEvent.dblClick(row('src'));
    await expect.poll(rows).toEqual(['s', 'docs', 'src', 'lib', 'a.ts', 'main.ts', 'README.md']);
    await userEvent.dblClick(row('docs'));
    await expect.poll(rows).toEqual(['s', 'docs', 'src', 'lib', 'a.ts', 'main.ts', 'README.md']);
    // Its folders as they were left, src open.
    workspace.activate('/r');
    await expect
      .poll(rows)
      .toEqual(['r/r', 'src', 'main.ts', 'dist', 'README.md', 'Scratches and Consoles']);
    workspace.activate('/s');
    await expect.poll(rows).toEqual(['s', 'docs', 'src', 'lib', 'a.ts', 'main.ts', 'README.md']);
    // Closed, it hides them all.
    await userEvent.dblClick(row('/s'));
    await expect.poll(rows).toEqual(['s']);
    await userEvent.dblClick(row('/s'));
  });
});

describe('Scratches and Consoles', () => {
  it('lists the scratch files, under Scratches once there’s one, as IntelliJ’s', async () => {
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    mount();
    await expect.poll(rows).toContain('Scratches and Consoles');
    // Asked for only once it's opened; with no scratch file, nothing under it.
    expect(host.params('scratches.folder')).toEqual([]);
    await userEvent.dblClick(row('scratches-and-consoles'));
    await expect.poll(() => host.params('scratches.folder')).toHaveLength(1);
    expect(rows().at(-1)).toBe('Scratches and Consoles');
    // A group is nothing for the actions to act on.
    expect(projectNode()).toBeNull();
    folders['/data/scratches'] = [
      { path: '/data/scratches/scratch.ts', name: 'scratch.ts', kind: 'file' },
    ];
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => rows().slice(-2)).toEqual(['Scratches and Consoles', 'Scratches']);
    await userEvent.dblClick(row('/data/scratches'));
    await expect.poll(() => rows().at(-1)).toBe('scratch.ts');
    await userEvent.dblClick(row('/data/scratches/scratch.ts'));
    expect(opened).toEqual([{ id: '/data/scratches/scratch.ts', title: 'scratch.ts' }]);
    await userEvent.click(row('/data/scratches/scratch.ts'));
    expect(projectFile()).toBe('/data/scratches/scratch.ts');
    // Without a folder for them, none.
    host.answers['scratches.folder'] = () => null;
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => rows().at(-1)).toBe('Scratches and Consoles');
    await userEvent.dblClick(row('scratches-and-consoles'));
    host.answers['scratches.folder'] = () => '/data/scratches';
  });
});

describe('selecting a file in the tree', () => {
  it('opens the folders down to it, in the app or the samples', async () => {
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    mount();
    expect(await selectInTree('/r/src/main.ts', SAMPLES)).toBe(true);
    await expect.poll(() => selected('/r/src/main.ts')).toBe('true');
    // Not a file of the worktree.
    expect(await selectInTree('/elsewhere/a.ts', SAMPLES)).toBe(false);
    workspace.activate('/s');
    expect(await selectInTree('src/lib/x.ts', SAMPLES)).toBe(true);
    await expect.poll(() => selected('src/lib/x.ts')).toBe('true');
  });

  it('selects nothing with no environment', async () => {
    for (const id of ['/r', '/s']) workspace.close(id);
    expect(await selectInTree('src/main.ts', SAMPLES)).toBe(false);
  });
});
