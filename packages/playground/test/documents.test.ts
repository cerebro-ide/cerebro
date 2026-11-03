import { EditorDocument } from '@cerebro-ide/ui-editor';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  documentFor,
  onEdited,
  RELOAD_EVERY,
  reloadAll,
  saveAll,
  saveFiles,
  setupSaving,
  type ConflictResolver,
} from '../src/documents.js';
import { projects, useProjects } from '../src/environments.js';
import { FakeHost, project } from './fakes.js';

/** The files on the host's disk; a read or write of one not there fails, as the host's does. */
const disk = new Map<string, string>();
/** Files the host can't read, though they're there. */
const unreadable = new Set<string>();
const host = new FakeHost({
  'fs.read': ({ path }: { path: string }) => {
    const text = disk.get(path);
    if (text === undefined || unreadable.has(path)) throw new Error(`ENOENT: ${path}`);
    return { text };
  },
  'fs.write': ({ path, text }: { path: string; text: string }) => {
    if (path.includes('readonly')) throw new Error('EACCES');
    disk.set(path, text);
    return null;
  },
  'fs.exists': ({ path }: { path: string }) => disk.has(path),
});

let resolver: ConflictResolver = () => Promise.resolve();
const closed: string[] = [];
const reported: unknown[] = [];
let idle: number | undefined;

beforeAll(() => {
  setupSaving(
    (error) => reported.push(error),
    (path, doc, text) => resolver(path, doc, text),
    (path) => closed.push(path),
    () => idle,
  );
});

afterEach(() => {
  useProjects([project('/r', host)]);
  host.asked.length = 0;
  resolver = () => Promise.resolve();
  vi.useRealTimers();
});

useProjects([project('/r', host)]);

/** A file on disk, and its document. */
async function file(path: string, text: string): Promise<EditorDocument> {
  disk.set(path, text);
  return (await documentFor(path, () => 'sample')) as EditorDocument;
}

function edit(doc: EditorDocument, insert: string): void {
  doc.edit([{ from: doc.text.peek().length, to: doc.text.peek().length, insert }]);
}

/** What was written, to `path` or to any file. */
const writes = (path?: string) =>
  host
    .params('fs.write')
    .filter((w) => path === undefined || (w as { path: string }).path === path);

describe('a file’s document', () => {
  it('is read through the host, once, and outlives its tabs', async () => {
    const doc = await file('/r/a.ts', 'one');
    expect(doc.content()).toBe('one');
    expect(await documentFor('/r/a.ts', () => 'sample')).toBe(doc);
    expect(host.params('fs.read')).toEqual([{ path: '/r/a.ts' }]);
  });

  it('is why it can’t be read, and is read again the next time', async () => {
    expect(await documentFor('/r/none.ts', () => 'sample')).toEqual({
      error: 'ENOENT: /r/none.ts',
    });
    disk.set('/r/none.ts', 'there now');
    await expect
      .poll(async () => {
        const loaded = await documentFor('/r/none.ts', () => '');
        return loaded instanceof EditorDocument ? loaded.content() : loaded.error;
      })
      .toBe('there now');
  });

  it('is the sample’s text in a browser, which isn’t saved', async () => {
    const list = projects.get();
    projects.set([project('cerebro', undefined)]);
    const doc = (await documentFor('cerebro/README.md', () => '# Sample')) as EditorDocument;
    expect(doc.content()).toBe('# Sample');
    edit(doc, '!');
    await saveAll();
    await reloadAll();
    expect(host.asked).toEqual([]);
    projects.set(list);
  });

  it('tells of its edits, not of what’s read from disk', async () => {
    const edited: string[] = [];
    onEdited((path) => edited.push(path));
    const doc = await file('/r/edited.ts', 'one');
    doc.changedOnDisk('two');
    expect(edited).toEqual([]);
    edit(doc, '!');
    expect(edited).toEqual(['/r/edited.ts']);
  });
});

describe('saving', () => {
  it('writes the modified documents, or those asked for, with the history’s label', async () => {
    const a = await file('/r/save-a.ts', 'a');
    const b = await file('/r/save-b.ts', 'b');
    await file('/r/save-c.ts', 'c');
    edit(a, '1');
    edit(b, '2');
    await saveFiles(['/r/save-b.ts'], 'Reformat');
    expect(writes('/r/save-b.ts')).toEqual([
      { path: '/r/save-b.ts', text: 'b2', label: 'Reformat' },
    ]);
    expect(writes('/r/save-a.ts')).toEqual([]);
    await saveAll();
    expect(writes('/r/save-a.ts').at(-1)).toEqual({ path: '/r/save-a.ts', text: 'a1' });
    expect([a.modified.peek(), b.modified.peek()]).toEqual([false, false]);
    expect(disk.get('/r/save-a.ts')).toBe('a1');
  });

  it('keeps an edit made while the file was written, unsaved', async () => {
    const doc = await file('/r/typing.ts', 'a');
    edit(doc, '1');
    const writing = saveAll();
    // The write is asked for after the read that checks the disk: an edit then is after it.
    await expect.poll(() => host.params('fs.read').length).toBeGreaterThan(1);
    edit(doc, '2');
    await writing;
    expect(disk.get('/r/typing.ts')).toBe('a1');
    expect(doc.modified.peek()).toBe(true);
  });

  it('runs one save at a time', async () => {
    const doc = await file('/r/twice.ts', 'a');
    edit(doc, '1');
    // The first save's write is slow, as a large file's is.
    let write: () => void = () => undefined;
    const answer = host.answers['fs.write'] as (p: never) => unknown;
    host.answers['fs.write'] = (params: never) =>
      new Promise((resolve) => {
        write = () => {
          resolve(answer(params));
        };
      });
    const first = saveFiles(['/r/twice.ts']);
    await expect.poll(() => writes('/r/twice.ts').length).toBe(1);
    host.answers['fs.write'] = answer;
    edit(doc, '2');
    const second = saveFiles(['/r/twice.ts']);
    write();
    await Promise.all([first, second]);
    // The second, after the first, wrote over its write; at once, the first would have written last.
    expect(writes('/r/twice.ts').map((w) => (w as { text: string }).text)).toEqual(['a1', 'a12']);
    expect(disk.get('/r/twice.ts')).toBe('a12');
  });

  it('says which files couldn’t be saved, which stay modified, and goes on with the next save', async () => {
    const doc = await file('/r/readonly.ts', 'a');
    edit(doc, '1');
    await expect(saveAll()).rejects.toThrow('Couldn’t save /r/readonly.ts: EACCES');
    expect(doc.modified.peek()).toBe(true);
    await expect(saveAll()).rejects.toThrow('EACCES');
    disk.delete('/r/readonly.ts');
  });

  it('doesn’t make a deleted file again: its tabs close', async () => {
    const doc = await file('/r/deleted.ts', 'a');
    edit(doc, '1');
    disk.delete('/r/deleted.ts');
    await saveAll();
    expect(writes('/r/deleted.ts')).toEqual([]);
    expect(closed).toContain('/r/deleted.ts');
  });

  it('writes over a file it can’t read, and that may not be gone', async () => {
    const doc = await file('/r/locked.ts', 'a');
    edit(doc, '1');
    unreadable.add('/r/locked.ts');
    await saveAll();
    expect(writes('/r/locked.ts')).toEqual([{ path: '/r/locked.ts', text: 'a1' }]);
    unreadable.delete('/r/locked.ts');
    // Can't even tell whether it's there: kept, and written over.
    edit(doc, '2');
    unreadable.add('/r/locked.ts');
    const exists = host.answers['fs.exists'];
    host.answers['fs.exists'] = () => {
      throw new Error('down');
    };
    await saveAll();
    expect(writes('/r/locked.ts').at(-1)).toEqual({ path: '/r/locked.ts', text: 'a12' });
    host.answers['fs.exists'] = exists as never;
    unreadable.delete('/r/locked.ts');
  });

  it('asks about a file changed on disk too, and writes what’s chosen', async () => {
    const doc = await file('/r/both.ts', 'a');
    edit(doc, '1');
    disk.set('/r/both.ts', 'b');
    // Kept as it is: still in conflict, not written.
    resolver = () => Promise.resolve();
    await saveAll();
    expect(writes('/r/both.ts')).toEqual([]);
    // The edits kept over the disk's.
    resolver = (_path, d, text) => {
      d.resolve(d.content(), text);
      return Promise.resolve();
    };
    await saveAll();
    expect(disk.get('/r/both.ts')).toBe('a1');
    // The disk's taken: nothing to write.
    edit(doc, '2');
    disk.set('/r/both.ts', 'c');
    resolver = (_path, d, text) => {
      d.resolve(text, text);
      return Promise.resolve();
    };
    await saveAll();
    expect([doc.content(), doc.modified.peek(), writes('/r/both.ts')]).toEqual([
      'c',
      false,
      [{ path: '/r/both.ts', text: 'a1' }],
    ]);
  });

  it('doesn’t ask twice about one file, nor save it, while it’s asked about', async () => {
    const doc = await file('/r/asking.ts', 'a');
    edit(doc, '1');
    disk.set('/r/asking.ts', 'b');
    let answer: () => void = () => undefined;
    let asked = 0;
    resolver = (_path, d, text) => {
      asked++;
      return new Promise((resolve) => {
        answer = () => {
          d.resolve(d.content(), text);
          resolve();
        };
      });
    };
    const first = reloadAll();
    await expect.poll(() => asked).toBe(1);
    await reloadAll();
    const reads = host.params('fs.read').length;
    const saving = saveFiles(['/r/asking.ts']);
    await expect.poll(() => host.params('fs.read').length).toBe(reads + 1);
    answer();
    await first;
    await saving;
    expect(asked).toBe(1);
    expect(writes('/r/asking.ts')).toEqual([]);
  });

  it('does nothing in a browser', async () => {
    const list = projects.get();
    projects.set([project('cerebro', undefined)]);
    await saveAll();
    projects.set(list);
    expect(host.asked).toEqual([]);
  });

  it('skips a file whose worktree has no host', async () => {
    const doc = await file('/r/elsewhere/x.ts', 'a');
    edit(doc, '1');
    useProjects([project('/r', host), project('/r/elsewhere', undefined)]);
    await saveFiles(['/r/elsewhere/x.ts']);
    await reloadAll();
    expect(writes('/r/elsewhere/x.ts')).toEqual([]);
  });
});

describe('reading again', () => {
  it('takes what changed on disk where there are no edits', async () => {
    const doc = await file('/r/changed.ts', 'a');
    disk.set('/r/changed.ts', 'b');
    await reloadAll();
    expect(doc.content()).toBe('b');
  });

  it('asks about a file changed on disk and in the editor', async () => {
    const doc = await file('/r/conflict.ts', 'a');
    edit(doc, '1');
    disk.set('/r/conflict.ts', 'b');
    const asked: string[] = [];
    resolver = (path) => {
      if (path === '/r/conflict.ts') asked.push(path);
      return Promise.resolve();
    };
    await reloadAll();
    expect([asked, doc.content()]).toEqual([['/r/conflict.ts'], 'a1']);
  });

  it('closes a deleted file’s tabs, and keeps one it can’t read', async () => {
    const gone = await file('/r/gone.ts', 'a');
    const locked = await file('/r/unreadable.ts', 'a');
    disk.delete('/r/gone.ts');
    unreadable.add('/r/unreadable.ts');
    await reloadAll();
    expect(closed).toContain('/r/gone.ts');
    expect(closed).not.toContain('/r/unreadable.ts');
    expect([gone.content(), locked.content()]).toEqual(['a', 'a']);
    unreadable.delete('/r/unreadable.ts');
  });

  it('takes nothing read while the file was saved, or across a save', async () => {
    const path = '/r/racing.ts';
    const doc = await file(path, 'a');
    edit(doc, '1');
    const asked: string[] = [];
    resolver = (p) => {
      if (p === path) asked.push(p);
      return Promise.resolve();
    };
    /**
     * Holds the host's next answer to `method` for this file until `release` is called: done then
     * (a write), or as it was when asked (`now`: a read).
     */
    const hold = (method: string, now = false) => {
      const answer = host.answers[method] as (p: { path: string }) => unknown;
      let release: () => void = () => undefined;
      host.answers[method] = (params: { path: string }) => {
        if (params.path !== path) return answer(params);
        host.answers[method] = answer;
        const answered = now ? answer(params) : undefined;
        return new Promise((resolve) => {
          release = () => {
            resolve(now ? answered : answer(params));
          };
        });
      };
      return {
        release: () => {
          release();
        },
      };
    };
    // A read while the save writes, finding half of it.
    const write = hold('fs.write');
    const saving = saveFiles([path]);
    await expect.poll(() => writes(path).length).toBe(1);
    disk.set(path, 'a1 half');
    await reloadAll();
    write.release();
    await saving;
    // A read that starts before a save and ends after it, with the text from before.
    edit(doc, '2');
    const read = hold('fs.read', true);
    const reloading = reloadAll();
    await expect
      .poll(
        () => host.params('fs.read').filter((r) => (r as { path: string }).path === path).length,
      )
      .toBe(3);
    await saveFiles([path]);
    read.release();
    await reloading;
    expect(asked).toEqual([]);
    expect([doc.content(), doc.modified.peek(), disk.get(path)]).toEqual(['a12', false, 'a12']);
  });
});

describe('on its own', () => {
  it('saves when the window loses the focus, and says why it couldn’t', async () => {
    const doc = await file('/r/blur.ts', 'a');
    edit(doc, '1');
    window.dispatchEvent(new Event('blur'));
    await expect.poll(() => disk.get('/r/blur.ts')).toBe('a1');
    const failing = await file('/r/readonly-blur.ts', 'a');
    edit(failing, '1');
    window.dispatchEvent(new Event('blur'));
    await expect.poll(() => reported.length).toBe(1);
    failing.resolve('a', 'a');
  });

  it('reads again when the window gets the focus', async () => {
    const doc = await file('/r/focus.ts', 'a');
    disk.set('/r/focus.ts', 'b');
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => doc.content()).toBe('b');
  });

  it('saves after the idle time set, counted from the last key or move, and not when it’s off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const doc = await file('/r/idle.ts', 'a');
    edit(doc, '1');
    idle = 1000;
    window.dispatchEvent(new KeyboardEvent('keydown'));
    vi.advanceTimersByTime(900);
    window.dispatchEvent(new PointerEvent('pointerdown'));
    vi.advanceTimersByTime(900);
    expect(writes('/r/idle.ts')).toEqual([]);
    vi.advanceTimersByTime(100);
    vi.useRealTimers();
    await expect.poll(() => disk.get('/r/idle.ts')).toBe('a1');
    idle = undefined;
    edit(doc, '2');
    window.dispatchEvent(new WheelEvent('wheel'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(disk.get('/r/idle.ts')).toBe('a1');
  });

  it('reads again every few seconds while the window has the focus', async () => {
    expect(RELOAD_EVERY).toBe(2000);
    const doc = await file('/r/every.ts', 'a');
    disk.set('/r/every.ts', 'b');
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    await new Promise((resolve) => setTimeout(resolve, RELOAD_EVERY + 200));
    expect(doc.content()).toBe('a');
    focused.mockReturnValue(true);
    await expect.poll(() => doc.content(), { timeout: RELOAD_EVERY + 1000 }).toBe('b');
  });
});
