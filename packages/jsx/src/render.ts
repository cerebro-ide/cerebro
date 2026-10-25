import { untracked, type Disposable } from '@cerebro-ide/reactive';
import { clearBetween, toNodes } from './dom.js';
import { Owner, runWithOwner } from './owner.js';
import type { Child } from './types.js';

/**
 * Renders `fn()` at the end of `container`. `fn` runs once, untracked. Disposing removes what was
 * rendered and disposes everything it owns.
 */
export function render(fn: () => Child, container: ParentNode): Disposable {
  const owner = new Owner();
  const start = new Comment('');
  const end = new Comment('');
  const nodes = runWithOwner(owner, () => untracked(() => toNodes(fn())));
  container.append(start);
  for (const node of nodes) container.append(node);
  container.append(end);
  return {
    dispose() {
      owner.dispose();
      clearBetween(start, end);
      start.remove();
      end.remove();
    },
  };
}
