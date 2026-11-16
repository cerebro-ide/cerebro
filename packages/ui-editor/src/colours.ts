// The editor's highlight style as classes and the rules that colour them, for code drawn outside an
// editor (whose classes live in its shadow root): Markdown's code blocks, Recent Locations' lines.

import { tagHighlighter, type Highlighter } from '@lezer/highlight';
import { highlight } from './editor.js';

/** The editor's highlight style, as classes and the rules that colour them. */
export function codeColours(): { highlighter: Highlighter; rules: string } {
  const rules: string[] = [];
  const highlighter = tagHighlighter(
    highlight.specs.map(({ tag, ...style }, index) => {
      const name = `cerebro-code-${String(index)}`;
      // Its rules are a colour and a weight: CSS properties, in camel case.
      const declarations = Object.entries(style).map(
        ([key, value]) =>
          `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${String(value)};`,
      );
      rules.push(`.${name} { ${declarations.join(' ')} }`);
      return { tag, class: name };
    }),
  );
  return { highlighter, rules: rules.join('\n') };
}
