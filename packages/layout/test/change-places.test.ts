import { describe, expect, it } from 'vitest';
import { ChangePlaces, MAX_CHANGE_PLACES, type Place } from '../src/index.js';

const place = (id: string, line: number): Place => ({
  tab: { id, title: id },
  at: { line, column: 0 },
});
const name = (p: Place | undefined) => p && `${p.tab.id}:${String(p.at?.line)}`;

/** Change places, and where each step went. */
function setup() {
  const went: string[] = [];
  const changes = new ChangePlaces((p) => went.push(name(p) as string));
  return { changes, went, places: () => changes.places.map(name) };
}

describe('ChangePlaces', () => {
  it('keeps a change’s place, the last one replaced by one within 4 lines of it, as IntelliJ’s', () => {
    const { changes, places } = setup();
    changes.changed(place('a', 10));
    changes.changed(place('a', 13));
    changes.changed(place('a', 17));
    changes.changed(place('b', 17));
    expect(places()).toEqual(['a:13', 'a:17', 'b:17']);
    // A tab with no caret is at its top.
    changes.changed({ tab: { id: 'c', title: 'c' } });
    changes.changed({ tab: { id: 'c', title: 'c' }, at: { line: 2, column: 0 } });
    expect(places()).toEqual(['a:13', 'a:17', 'b:17', 'c:2']);
    changes.changed({ tab: { id: 'c', title: 'c' } });
    expect(places()).toEqual(['a:13', 'a:17', 'b:17', 'c:undefined']);
  });

  it('goes back through them, past where the caret is, and on again', () => {
    const { changes, went } = setup();
    expect(changes.canGoBack).toBe(false);
    changes.changed(place('a', 1));
    changes.changed(place('b', 1));
    changes.changed(place('c', 1));
    expect([changes.canGoBack, changes.canGoForward]).toEqual([true, false]);
    // At the last change: the one before it.
    changes.goBack(place('c', 2));
    changes.goBack(place('b', 1));
    expect(went).toEqual(['b:1', 'a:1']);
    expect(changes.canGoBack).toBe(false);
    changes.goBack(place('a', 1));
    expect(went).toHaveLength(2);
    changes.goForward(place('a', 1));
    changes.goForward(undefined);
    expect(went).toEqual(['b:1', 'a:1', 'b:1', 'c:1']);
    expect(changes.canGoForward).toBe(false);
    changes.goForward(undefined);
    expect(went).toHaveLength(4);
    // Back from elsewhere: the last one gone to, then on back.
    changes.goBack(undefined);
    changes.goBack(undefined);
    expect(went.slice(-2)).toEqual(['c:1', 'b:1']);
    // A change starts again from the end.
    changes.changed(place('d', 1));
    changes.goBack(place('x', 0));
    expect(went.at(-1)).toBe('d:1');
  });

  it('goes nowhere when the only places are where the caret is', () => {
    const { changes, went } = setup();
    changes.changed(place('a', 1));
    changes.goBack(place('a', 2));
    changes.index = 0;
    changes.goForward(place('a', 0));
    expect(went).toEqual([]);
  });

  it('keeps the latest 150', () => {
    const { changes, places } = setup();
    for (let i = 0; i <= MAX_CHANGE_PLACES; i++) changes.changed(place(String(i), 0));
    expect(places()).toHaveLength(MAX_CHANGE_PLACES);
    expect(places()[0]).toBe('1:0');
  });
});
