// Randomized tests: long runs of random operations, checking after each step the invariants the
// models promise and what the operation itself promises. Seeded, so a failure names its seed and
// last steps, and reruns the same way.

import { describe, expect, it } from 'vitest';
import {
  ANCHORS,
  EditorArea,
  EditorSplit,
  Environments,
  MAX_SPLIT,
  MIN_AREA_SIZE,
  MIN_SPLIT,
  ToolWindows,
  type Direction,
  type EditorNode,
  type Slot,
} from '../src/index.js';

const SEEDS = 100;
const STEPS = 200;

/** A small seeded generator (an LCG): enough to vary the operations, and repeatable. */
function random(seed: number) {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  return {
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
  };
}

/** Runs `step` many times per seed; a failure reports the seed and the last few steps. */
function run(step: (r: ReturnType<typeof random>, log: (line: string) => void) => void): void {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = random(seed);
    const lines: string[] = [];
    try {
      for (let i = 0; i < STEPS; i++) step(r, (line) => lines.push(`${String(i)}: ${line}`));
    } catch (error) {
      throw new Error(`seed ${String(seed)}, after:\n${lines.slice(-6).join('\n')}`, {
        cause: error,
      });
    }
  }
}

const DIRECTIONS: readonly Direction[] = ['left', 'right', 'up', 'down'];

/** A plain check, much faster than `expect` over thousands of steps. */
function ensure(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** The editor area's invariants: a minimal tree, sound sizes, an active group and tabs. */
function checkArea(area: EditorArea): void {
  const ids = new Set<string>();
  const walk = (node: EditorNode, parent?: EditorSplit) => {
    ensure(!ids.has(node.id), `node ${node.id} appears twice`);
    ids.add(node.id);
    if (node instanceof EditorSplit) {
      ensure(node.children.length >= 2, `split ${node.id} has fewer than 2 children`);
      ensure(node.sizes.length === node.children.length, `split ${node.id} sizes don't match`);
      const total = node.sizes.reduce((a, b) => a + b, 0);
      ensure(Math.abs(total - 1) < 1e-9, `split ${node.id} sizes sum to ${String(total)}`);
      ensure(
        node.sizes.every((size) => size > 0),
        `split ${node.id} has a size of 0 or less`,
      );
      ensure(node.orientation !== parent?.orientation, `split ${node.id} repeats its parent's`);
      for (const child of node.children) walk(child, node);
    } else {
      const tabs = node.tabs.map((t) => t.id);
      ensure(new Set(tabs).size === tabs.length, `group ${node.id} has a tab twice`);
      if (tabs.length === 0) {
        ensure(node.active === undefined, `empty group ${node.id} has an active tab`);
        // Only the last group may be empty.
        ensure(area.root === node, `empty group ${node.id} isn't the only one`);
      } else ensure(tabs.includes(node.active as string), `group ${node.id}'s active tab is gone`);
    }
  };
  walk(area.root);
  ensure(
    area.groups.some((g) => g.id === area.activeGroupId),
    `active group ${area.activeGroupId} is gone`,
  );
}

describe('EditorArea, randomly', () => {
  it('keeps its invariants, and each operation does what it says', () => {
    let area = new EditorArea();
    run((r, log) => {
      if (r.int(50) === 0) area = new EditorArea();
      const groups = area.groups;
      const group = r.pick(groups);
      const tab = group.tabs.length > 0 ? r.pick(group.tabs) : undefined;
      const op = tab ? r.int(6) : 0;
      if (op === 0) {
        const id = `t${String(r.int(8))}`;
        log(`open ${id} in ${group.id}`);
        area.open({ id, title: id }, group.id);
        expect(area.activeGroupId).toBe(group.id);
        expect(area.activeGroup.active).toBe(id);
      } else if (op === 1 && tab) {
        log(`close ${tab.id} in ${group.id}`);
        area.close(group.id, tab.id);
        const still = area.groups.find((g) => g.id === group.id);
        expect(still?.tabs.some((t) => t.id === tab.id) ?? false).toBe(false);
      } else if (op === 2 && tab) {
        const direction = r.pick(DIRECTIONS);
        log(`split ${group.id} ${direction} with ${tab.id}`);
        const created = area.split(group.id, direction, tab.id);
        expect(area.activeGroupId).toBe(created.id);
        expect(created.tabs.map((t) => t.id)).toEqual([tab.id]);
        expect(area.group(group.id).tabs).toContain(tab);
      } else if (op === 3 && tab) {
        const to = r.pick(groups);
        const direction = r.pick(DIRECTIONS);
        log(`moveToSplit ${tab.id} from ${group.id} to ${to.id} ${direction}`);
        const lone = group === to && group.tabs.length === 1;
        area.moveToSplit(tab.id, group.id, to.id, direction);
        if (!lone) expect(area.activeGroup.active).toBe(tab.id);
      } else if (op === 4 && tab) {
        const to = r.pick(groups);
        const index = r.int(6);
        log(`move ${tab.id} from ${group.id} to ${to.id} at ${String(index)}`);
        const already = group !== to && to.tabs.some((t) => t.id === tab.id);
        const before = to.tabs.length;
        area.move(tab.id, group.id, to.id, index);
        const target = area.group(to.id);
        const at = target.tabs.findIndex((t) => t.id === tab.id);
        if (group === to) expect(at).toBe(Math.min(index, before - 1));
        else if (!already) expect(at).toBe(Math.min(index, before));
        if (group !== to) expect(target.active).toBe(tab.id);
      } else if (tab) {
        log(`activate ${tab.id} in ${group.id}`);
        area.activate(group.id, tab.id);
        expect(area.activeGroup.activeTab).toBe(tab);
      }
      checkArea(area);
    });
  });
});

describe('ToolWindows, randomly', () => {
  const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];
  const SLOTS: readonly Slot[] = ['primary', 'secondary'];

  function checkWindows(tools: ToolWindows): void {
    for (const anchor of ANCHORS) {
      const area = tools.areas[anchor];
      ensure(area.size >= MIN_AREA_SIZE, `${anchor} is smaller than the minimum`);
      ensure(
        area.split >= MIN_SPLIT && area.split <= MAX_SPLIT,
        `${anchor}'s split is out of range`,
      );
      for (const slot of SLOTS) {
        const shown = area[slot];
        if (shown === undefined) continue;
        const window = tools.windows.get(shown);
        ensure(window?.anchor === anchor && window.slot === slot, `${shown} shows out of place`);
      }
    }
    // Every window is on exactly one stripe, once.
    const listed = ANCHORS.flatMap((a) => tools.stripe(a).map((w) => w.id)).sort();
    ensure(
      listed.join() === [...tools.windows.keys()].sort().join(),
      `stripes list ${listed.join()}`,
    );
    for (const window of tools.windows.values()) {
      ensure(
        tools.isVisible(window.id) === (tools.areas[window.anchor][window.slot] === window.id),
        `${window.id}'s visibility disagrees with its area`,
      );
    }
  }

  it('keeps its invariants, and each operation does what it says', () => {
    let tools = new ToolWindows();
    run((r, log) => {
      if (r.int(50) === 0) tools = new ToolWindows();
      const id = r.pick(IDS);
      const known = tools.windows.has(id);
      const op = known ? r.int(7) : 0;
      if (op === 0) {
        if (known) return;
        const anchor = r.pick(ANCHORS);
        const slot = r.pick(SLOTS);
        log(`register ${id} at ${anchor} ${slot}`);
        tools.register({ id, title: id, anchor, slot });
        expect(tools.group(anchor, slot).at(-1)?.id).toBe(id);
      } else if (op === 1) {
        const window = tools.windows.get(id);
        const before = window && tools.areas[window.anchor][window.slot];
        log(`show ${id}`);
        tools.show(id);
        expect(tools.isVisible(id)).toBe(true);
        if (before !== undefined && before !== id) expect(tools.isVisible(before)).toBe(false);
      } else if (op === 2) {
        log(`hide ${id}`);
        tools.hide(id);
        expect(tools.isVisible(id)).toBe(false);
      } else if (op === 3) {
        const was = tools.isVisible(id);
        log(`toggle ${id}`);
        tools.toggle(id);
        expect(tools.isVisible(id)).toBe(!was);
      } else if (op === 4) {
        const anchor = r.pick(ANCHORS);
        const slot = r.pick(SLOTS);
        const index = r.int(5);
        const was = tools.isVisible(id);
        const others = tools.group(anchor, slot).filter((w) => w.id !== id).length;
        log(`move ${id} to ${anchor} ${slot} at ${String(index)}`);
        tools.move(id, anchor, slot, index);
        expect(tools.isVisible(id)).toBe(was);
        expect(tools.group(anchor, slot).findIndex((w) => w.id === id)).toBe(
          Math.min(index, others),
        );
      } else if (op === 5) {
        log(`unregister ${id}`);
        tools.unregister(id);
        expect(tools.windows.has(id)).toBe(false);
      } else {
        const anchor = r.pick(ANCHORS);
        log(`resize ${anchor}`);
        tools.areas[anchor].resize(r.int(600) - 100);
        tools.areas[anchor].setSplit(r.int(140) / 100 - 0.2);
      }
      checkWindows(tools);
    });
  });
});

describe('Environments, randomly', () => {
  const IDS = ['a', 'b', 'c', 'd', 'e'];

  it('matches a plain model of tabs and the active one', () => {
    let envs = new Environments();
    let model: { order: string[]; active: string | undefined } = { order: [], active: undefined };
    run((r, log) => {
      if (r.int(50) === 0) {
        envs = new Environments();
        model = { order: [], active: undefined };
      }
      const id = r.pick(IDS);
      const isOpen = model.order.includes(id);
      const op = r.int(4);
      if (op === 0) {
        log(`openOrActivate ${id}`);
        envs.openOrActivate({ id, name: id, branch: 'main' });
        if (!isOpen) {
          const at = model.order.indexOf(model.active as string) + 1;
          model.order.splice(at, 0, id);
        }
        model.active = id;
      } else if (op === 1 && isOpen) {
        log(`activate ${id}`);
        envs.activate(id);
        model.active = id;
      } else if (op === 2) {
        log(`close ${id}`);
        envs.close(id);
        const index = model.order.indexOf(id);
        if (index >= 0) {
          model.order.splice(index, 1);
          if (model.active === id) model.active = model.order[index] ?? model.order[index - 1];
        }
      } else if (op === 3 && isOpen) {
        const index = r.int(7) - 1;
        log(`move ${id} to ${String(index)}`);
        envs.move(id, index);
        model.order.splice(model.order.indexOf(id), 1);
        model.order.splice(Math.min(Math.max(index, 0), model.order.length), 0, id);
      } else return;
      expect(envs.open.map((e) => e.id)).toEqual(model.order);
      expect(envs.activeId).toBe(model.active);
      expect(envs.active?.id).toBe(model.active);
    });
  });
});
