// The Log's graph: which lane each commit's dot is in, and the lines through each row, from its top
// to the dot and from the dot to the bottom. Lanes are laid out a page of commits at a time, newest
// first, as the Log loads them: each lane waits for a commit (a parent of one above), a commit takes
// the first lane waiting for it, and its first parent takes its lane on down; lines waiting for the
// same commit run side by side and join at it. A lane that ends
// leaves a gap the next new one takes, so lines run straight down.
//
// A line's colour is its branch's, as IntelliJ colours its graph by branch: a branch's first-parent
// line keeps its colour, and each new one takes the next. IntelliJ's colours come from its
// DefaultColorGenerator; here there are eight of them, as theme tokens (`--cerebro-log-graph-N`).

/** A line in a row's half: from a lane at one edge to a lane at the other, in a branch's colour. */
export interface Edge {
  from: number;
  to: number;
  color: number;
}

/** A row of the graph. */
export interface GraphRow {
  /** The lane its dot is in. */
  lane: number;
  color: number;
  /** From the row's top to its dot (or straight through). */
  up: Edge[];
  /** From its dot (or straight through) to the row's bottom. */
  down: Edge[];
  /** How many lanes it spans: its text starts after them, as IntelliJ's. */
  width: number;
}

/** How many colours there are: a branch's is its number, round these. */
export const COLORS = 8;

interface Lane {
  /** The commit it waits for. */
  hash: string;
  color: number;
}

export class GraphLayout {
  private lanes: (Lane | undefined)[] = [];
  private colors = 0;

  private newColor(): number {
    return this.colors++ % COLORS;
  }

  /** A lane free for a new line: the first gap, or a new one at the end. */
  private free(): number {
    const gap = this.lanes.indexOf(undefined);
    return gap < 0 ? this.lanes.length : gap;
  }

  /** The rows of the next commits, in order after those added before. */
  add(commits: readonly { hash: string; parents: readonly string[] }[]): GraphRow[] {
    return commits.map((commit) => {
      const waiting: number[] = [];
      this.lanes.forEach((lane, i) => {
        if (lane?.hash === commit.hash) waiting.push(i);
      });
      const first = waiting[0];
      const lane = first ?? this.free();
      const color = first === undefined ? this.newColor() : (this.lanes[first] as Lane).color;
      const up: Edge[] = [];
      const down: Edge[] = [];
      this.lanes.forEach((other, i) => {
        if (!other) return;
        if (other.hash === commit.hash) up.push({ from: i, to: lane, color: other.color });
        else {
          up.push({ from: i, to: i, color: other.color });
          down.push({ from: i, to: i, color: other.color });
        }
      });
      for (const i of waiting) this.lanes[i] = undefined;
      commit.parents.forEach((parent, k) => {
        // A first parent's line runs on down its lane, to join others at the parent, as
        // IntelliJ draws two heads on one base; another's goes to a lane awaiting it already.
        const there = k === 0 ? -1 : this.lanes.findIndex((other) => other?.hash === parent);
        if (there >= 0) {
          down.push({ from: lane, to: there, color: (this.lanes[there] as Lane).color });
          return;
        }
        const at = k === 0 ? lane : this.free();
        const own = k === 0 ? color : this.newColor();
        this.lanes[at] = { hash: parent, color: own };
        down.push({ from: lane, to: at, color: own });
      });
      while (this.lanes.length > 0 && this.lanes.at(-1) === undefined) this.lanes.pop();
      const lanes = [lane, ...up.map((e) => e.from), ...down.map((e) => e.to)];
      return { lane, color, up, down, width: Math.max(...lanes) + 1 };
    });
  }
}
