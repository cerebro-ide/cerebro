// Lines of a file drawn as code, highlighted as the editor highlights them, each with its number:
// Recent Locations' rows, as IntelliJ's (`RecentLocationsRenderer`, read from its source).

import { highlightCode, type Highlighter } from '@lezer/highlight';
import { codeColours } from './colours.js';
import { fileLanguage } from './languages.js';

/** The editor's colours as classes, their rules added to the document the first time. */
let colours: Highlighter | undefined;
function highlighter(): Highlighter {
  if (colours) return colours;
  const { highlighter, rules } = codeColours();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(rules);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  colours = highlighter;
  return highlighter;
}

/**
 * Lines `first` to `last` (zero-based, both in the text, both drawn) of a file's text, its language
 * by its path; plain for one without.
 */
export function codeSnippet(path: string, text: string, first: number, last: number): HTMLElement {
  const lines = text.split('\n');
  const from = lines.slice(0, first).reduce((at, line) => at + line.length + 1, 0);
  const to = lines.slice(0, last + 1).reduce((at, line) => at + line.length + 1, 0) - 1;
  const snippet = document.createElement('div');
  snippet.className = 'cerebro-snippet';
  let number = first;
  let code!: HTMLElement;
  const line = () => {
    const row = document.createElement('div');
    row.className = 'cerebro-snippet__line';
    const gutter = document.createElement('span');
    gutter.className = 'cerebro-snippet__number';
    gutter.textContent = String(number + 1);
    code = document.createElement('span');
    code.className = 'cerebro-snippet__code';
    row.append(gutter, code);
    snippet.append(row);
    number++;
  };
  line();
  const language = fileLanguage(path);
  if (!language) {
    code.textContent = lines[first] as string;
    for (let i = first + 1; i <= last; i++) {
      line();
      code.textContent = lines[i] as string;
    }
    return snippet;
  }
  highlightCode(
    text,
    language.parser.parse(text),
    highlighter(),
    (part, classes) => {
      if (!classes) {
        code.append(part);
        return;
      }
      const span = document.createElement('span');
      span.textContent = part;
      span.className = classes;
      code.append(span);
    },
    line,
    from,
    Math.max(from, to),
  );
  return snippet;
}
