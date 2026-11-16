import '@cerebro-ide/theme/themes.css';
import { describe, expect, it } from 'vitest';
import { codeSnippet } from '../src/index.js';

const lines = (snippet: HTMLElement) =>
  [...snippet.querySelectorAll('.cerebro-snippet__line')].map(
    (line) =>
      `${String(line.querySelector('.cerebro-snippet__number')?.textContent)}|${String(line.querySelector('.cerebro-snippet__code')?.textContent)}`,
  );

describe('codeSnippet', () => {
  it('draws a file’s lines, each with its number, highlighted as the editor highlights them', () => {
    const text = 'const a = 1;\nlet b = 2;\nconst c = 3;\nreturn;\n';
    const snippet = codeSnippet('/r/a.ts', text, 1, 2);
    document.body.append(snippet);
    expect(lines(snippet)).toEqual(['2|let b = 2;', '3|const c = 3;']);
    const keyword = [...snippet.querySelectorAll('.cerebro-snippet__code span')].find(
      (span) => span.textContent === 'const',
    ) as HTMLElement;
    // The editor's colour for a keyword, from rules the document was given once.
    expect(getComputedStyle(keyword).color).not.toBe(getComputedStyle(snippet).color);
    const sheets = document.adoptedStyleSheets.length;
    codeSnippet('/r/a.ts', text, 0, 0);
    expect(document.adoptedStyleSheets.length).toBe(sheets);
    snippet.remove();
  });

  it('draws a plain file’s lines as they are, and an empty one as one empty line', () => {
    expect(lines(codeSnippet('/r/notes', 'one\ntwo\nthree', 0, 1))).toEqual(['1|one', '2|two']);
    expect(lines(codeSnippet('/r/notes', '', 0, 0))).toEqual(['1|']);
    expect(lines(codeSnippet('/r/a.ts', '', 0, 0))).toEqual(['1|']);
  });
});
