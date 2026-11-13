// A Markdown file's preview, as IntelliJ's Markdown editor shows beside its text: the text drawn as
// a page (markdown.ts), again as it changes. It lives in a shadow root, its styles a constructable
// stylesheet (the page's policy allows no <style> element). Code blocks take the editor's colours:
// its highlight style's rules, as classes of the preview's own. The element itself scrolls, so the
// page's own scrollbars draw over it.

import { onCleanup, render } from '@cerebro-ide/jsx';
import { tagHighlighter, type Highlighter } from '@lezer/highlight';
import { highlight } from './editor.js';
import { drawMarkdown, gfmParser, type MarkdownStyle } from './markdown.js';

export interface MarkdownPreviewProps {
  /** The Markdown, read reactively. */
  text: () => string;
}

/** The page's look, from the theme's variables. A claim: not measured from IntelliJ's. */
const STYLES = `
:host { display: block; overflow: auto; background: var(--cerebro-background); }
.cerebro-markdown {
  box-sizing: border-box;
  max-width: 900px;
  padding: 16px 24px;
  color: var(--cerebro-text);
  font-family: var(--cerebro-font);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: break-word;
}
.cerebro-markdown > :first-child { margin-top: 0; }
.cerebro-markdown h1, .cerebro-markdown h2 {
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--cerebro-border);
}
.cerebro-markdown h1, .cerebro-markdown h2, .cerebro-markdown h3, .cerebro-markdown h4,
.cerebro-markdown h5, .cerebro-markdown h6 { margin: 24px 0 16px; line-height: 1.25; }
.cerebro-markdown p, .cerebro-markdown ul, .cerebro-markdown ol, .cerebro-markdown blockquote,
.cerebro-markdown table, .cerebro-markdown pre { margin: 0 0 16px; }
.cerebro-markdown ul, .cerebro-markdown ol { padding-left: 2em; }
.cerebro-markdown li > p { margin: 0; }
.cerebro-markdown li > input { margin: 0 0.4em 0 -1.4em; vertical-align: middle; }
.cerebro-markdown blockquote {
  padding: 0 1em;
  color: var(--cerebro-text-muted);
  border-left: 3px solid var(--cerebro-border);
}
.cerebro-markdown code, .cerebro-markdown pre { font-family: var(--cerebro-font-mono); font-size: 13px; }
.cerebro-markdown code {
  padding: 0.1em 0.3em;
  border-radius: 4px;
  background: var(--cerebro-hover);
}
.cerebro-markdown pre {
  padding: 12px 16px;
  overflow: auto;
  border-radius: 6px;
  background: var(--cerebro-hover);
  white-space: pre;
}
.cerebro-markdown table { border-collapse: collapse; }
.cerebro-markdown th, .cerebro-markdown td {
  padding: 6px 13px;
  border: 1px solid var(--cerebro-border);
}
.cerebro-markdown th { font-weight: 600; }
.cerebro-markdown hr { height: 1px; margin: 24px 0; border: 0; background: var(--cerebro-border); }
.cerebro-doc__link { color: var(--cerebro-link); }
`;

/** The editor's highlight style, as classes of the preview's and the rules that colour them. */
function codeColours(): { highlighter: Highlighter; rules: string } {
  const rules: string[] = [];
  const highlighter = tagHighlighter(
    highlight.specs.map(({ tag, ...style }, index) => {
      const name = `cerebro-markdown-code-${String(index)}`;
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

/** A Markdown text drawn as a page, again as it changes. */
export function MarkdownPreview(props: MarkdownPreviewProps): Node {
  const container = document.createElement('div');
  container.className = 'cerebro-markdown-preview';
  const shadow = container.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  const colours = codeColours();
  sheet.replaceSync(`${STYLES}\n${colours.rules}`);
  shadow.adoptedStyleSheets = [sheet];
  const style: MarkdownStyle = { highlighter: colours.highlighter, headings: true };
  const page = () => {
    const text = props.text();
    const body = document.createElement('div');
    body.className = 'cerebro-markdown';
    const tree = gfmParser.parse(text);
    for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
      drawMarkdown(child, text, body, style);
    }
    return body;
  };
  const handle = render(() => <>{page}</>, shadow);
  onCleanup(() => {
    handle.dispose();
  });
  return container;
}
