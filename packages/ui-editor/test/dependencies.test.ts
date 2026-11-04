// CodeMirror works only with one copy of each of its shared packages: an editor made with one copy
// of @codemirror/view ignores the plugins made with another, highlighting among them (measured
// with yarn, 2026-11-04: it installed a second view, and nothing was highlighted). The root pins
// them to the editor's versions for npm (`overrides`) and yarn (`resolutions`) alike.

import { describe, expect, it } from 'vitest';
import root from '../../../package.json' with { type: 'json' };
import editor from '../package.json' with { type: 'json' };

const SHARED = [
  '@codemirror/autocomplete',
  '@codemirror/language',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/markdown',
];

describe('CodeMirror’s shared packages', () => {
  it('are pinned to the editor’s versions for npm and yarn', () => {
    const versions = editor.dependencies as Record<string, string>;
    const pinned = Object.fromEntries(SHARED.map((name) => [name, versions[name]]));
    const pick = (pins: Record<string, string>) =>
      Object.fromEntries(SHARED.map((name) => [name, pins[name]]));
    expect(pick(root.overrides)).toEqual(pinned);
    expect(pick((root as { resolutions?: Record<string, string> }).resolutions ?? {})).toEqual(
      pinned,
    );
  });

  it('pin the same packages for both', () => {
    expect((root as { resolutions?: unknown }).resolutions).toEqual(root.overrides);
  });
});
