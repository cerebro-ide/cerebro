import { describe, expect, it } from 'vitest';
import { COLORS, GraphLayout } from '../src/log-graph.js';

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe('the Log’s graph', () => {
  it('runs a line of commits down one lane, in one colour', () => {
    const layout = new GraphLayout();
    expect(layout.add([c('c', 'b'), c('b', 'a'), c('a')])).toMatchObject([
      { lane: 0, color: 0, up: [], down: [{ from: 0, to: 0, color: 0 }] },
      {
        lane: 0,
        color: 0,
        up: [{ from: 0, to: 0, color: 0 }],
        down: [{ from: 0, to: 0, color: 0 }],
      },
      { lane: 0, color: 0, up: [{ from: 0, to: 0, color: 0 }], down: [] },
    ]);
  });

  it('gives a merge’s second parent a lane and colour of its own, until it joins', () => {
    // m merges s into b; s and b both come from a.
    const layout = new GraphLayout();
    const [m, b, s, a] = layout.add([c('m', 'b', 's'), c('b', 'a'), c('s', 'a'), c('a')]);
    expect(m).toMatchObject({
      lane: 0,
      color: 0,
      up: [],
      down: [
        { from: 0, to: 0, color: 0 },
        { from: 0, to: 1, color: 1 },
      ],
    });
    // The side branch's line runs straight on past b.
    expect(b).toMatchObject({
      lane: 0,
      color: 0,
      up: [
        { from: 0, to: 0, color: 0 },
        { from: 1, to: 1, color: 1 },
      ],
      down: [
        { from: 1, to: 1, color: 1 },
        { from: 0, to: 0, color: 0 },
      ],
    });
    // s is in its own lane, and its line runs on down it to a, where the two lines join.
    expect(s).toMatchObject({
      lane: 1,
      color: 1,
      up: [
        { from: 0, to: 0, color: 0 },
        { from: 1, to: 1, color: 1 },
      ],
      down: [
        { from: 0, to: 0, color: 0 },
        { from: 1, to: 1, color: 1 },
      ],
    });
    expect(a).toMatchObject({
      lane: 0,
      color: 0,
      up: [
        { from: 0, to: 0, color: 0 },
        { from: 1, to: 0, color: 1 },
      ],
      down: [],
    });
    // Each row as wide as the lanes it has lines in: the merge's two, the root's two.
    expect([m, b, s, a].map((row) => row?.width)).toEqual([2, 2, 2, 2]);
  });

  it('joins two heads’ lines at the commit both wait for, and frees the lane', () => {
    const layout = new GraphLayout();
    const [x, y, base, next] = layout.add([c('x', 'base'), c('y', 'base'), c('base', 'root')]);
    expect([x?.lane, y?.lane, base?.lane]).toEqual([0, 1, 0]);
    expect(y?.color).toBe(1);
    expect(base?.up).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 1, to: 0, color: 1 },
    ]);
    expect(base?.down).toEqual([{ from: 0, to: 0, color: 0 }]);
    expect(next).toBeUndefined();
    // The freed lane is the next new head's; a later page goes on where the last left off.
    const [z, root] = layout.add([c('z', 'root'), c('root')]);
    expect(z).toMatchObject({ lane: 1, color: 2 });
    expect(root?.up).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 1, to: 0, color: 2 },
    ]);
  });

  it('draws a merge’s line to a lane already waiting for its parent', () => {
    const layout = new GraphLayout();
    // x waits for a; m merges a in too.
    const [, m] = layout.add([c('x', 'a'), c('m', 'b', 'a')]);
    expect(m?.down).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 1, to: 1, color: 1 },
      { from: 1, to: 0, color: 0 },
    ]);
  });

  it('makes each row as wide as its own lanes, narrower once lines join', () => {
    const layout = new GraphLayout();
    const rows = layout.add([c('x', 'base'), c('y', 'base'), c('base', 'root'), c('root')]);
    expect(rows.map((row) => row.width)).toEqual([1, 2, 2, 1]);
  });

  it('gives each of an octopus merge’s parents a lane', () => {
    const layout = new GraphLayout();
    const [m] = layout.add([c('m', 'p', 'q', 'r')]);
    expect(m?.down).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 0, to: 1, color: 1 },
      { from: 0, to: 2, color: 2 },
    ]);
    expect(m?.width).toBe(3);
  });

  it('takes a gap left by a line that ended before a new lane at the end', () => {
    const layout = new GraphLayout();
    // Three heads; the middle one's line ends at its root, and the next head takes its lane.
    const rows = layout.add([c('a', 'a0'), c('b', 'b0'), c('c', 'c0'), c('b0'), c('d', 'd0')]);
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 2, 1, 1]);
  });

  it('goes round the colours', () => {
    const layout = new GraphLayout();
    const heads = Array.from({ length: COLORS + 1 }, (_, i) => c(`h${String(i)}`));
    expect(layout.add(heads).map((row) => row.color)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
  });
});
