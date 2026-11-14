// Scroll Up and Scroll Down, as IntelliJ's `EditorScrollUp` and `EditorScrollDown` (`ScrollUpAction`,
// `EditorActionUtil.scrollRelatively`, read from its source): the text scrolled a line, the caret
// left where it is; in a read-only editor too.

import type { Command } from '@codemirror/view';

/** A command scrolling the editor `lines` lines down (up, for less than none). */
export function scrollingBy(lines: number): Command {
  return (view) => {
    view.scrollDOM.scrollTop += lines * view.defaultLineHeight;
    return true;
  };
}
