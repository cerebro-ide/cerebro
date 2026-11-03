// The page's entry starts once per page, as it's imported: each case is a test file of its own,
// which mocks the two pages it may show (`vi.mock` must be in the test file).

import type { Project } from '../src/bridge.js';

/** The pages shown, as their mocks say. */
export const shown: string[] = [];

/** Starts the page in a window showing these projects, or in a browser. */
export async function boot(projects?: Project[]): Promise<string[]> {
  if (projects) {
    window.cerebro = {
      project: { current: () => Promise.resolve(projects) },
    } as unknown as NonNullable<Window['cerebro']>;
  }
  await import('../src/boot.js');
  return shown;
}
