// A Markdown file's preview, as IntelliJ's Markdown editor shows beside its text: the text drawn as
// a page (markdown.ts), again as it changes. It lives in a shadow root, its styles a constructable
// stylesheet (the page's policy allows no <style> element). Code blocks take the editor's colours:
// its highlight style's rules, as classes of the preview's own. The element itself scrolls, so the
// page's own scrollbars draw over it.

import { onCleanup, render } from '@cerebro-ide/jsx';
import { effect } from '@cerebro-ide/reactive';
import { tagHighlighter, type Highlighter } from '@lezer/highlight';
import { highlight } from './editor.js';
import { drawMarkdown, gfmParser, type MarkdownStyle } from './markdown.js';

export interface MarkdownPreviewProps {
  /** The Markdown, read reactively. */
  text: () => string;
  /**
   * The editor's top line, zero-based, read reactively: the preview scrolls to show what it's
   * drawn from at its top, as IntelliJ's auto-scroll (MarkdownEditorWithPreview).
   */
  line?: () => number;
  /** Opens a link to somewhere else than the page itself (`#heading`, which it goes to). */
  link?: (address: string) => void;
  /** An image's source for its address, as `MarkdownStyle`'s. */
  image?: MarkdownStyle['image'];
}

/**
 * Where to scroll to show a line at the top: the block drawn from it, or the part of the block
 * that holds it, by how far into the block's lines it is. Blocks are the page's elements, each with
 * the line it starts at.
 */
export function scrollFor(
  blocks: readonly { line: number; top: number }[],
  line: number,
  end: { line: number; top: number },
): number {
  const index = blocks.findLastIndex((block) => block.line <= line);
  if (index < 0) return 0;
  const block = blocks[index] as { line: number; top: number };
  const next = blocks[index + 1] ?? end;
  // Blocks start on lines of their own: the next starts after this one.
  const share = Math.min(1, (line - block.line) / (next.line - block.line));
  return block.top + share * (next.top - block.top);
}

/** A heading's anchor, as GitHub makes it: lower case, its spaces hyphens, its punctuation gone. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
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
.cerebro-markdown img { max-width: 100%; }
.cerebro-doc__link { color: var(--cerebro-link); }
.cerebro-doc__link--opens { cursor: pointer; }
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
  /** Goes to a heading of the page by its anchor, as GitHub's page does. */
  const goTo = (anchor: string) => {
    const heading = [...body.querySelectorAll('h1, h2, h3, h4, h5, h6')].find(
      (element) => slug(element.textContent) === anchor,
    );
    if (heading) {
      container.scrollTop +=
        heading.getBoundingClientRect().top - container.getBoundingClientRect().top;
    }
  };
  const style: MarkdownStyle = {
    highlighter: colours.highlighter,
    headings: true,
    link: (address) => {
      if (address.startsWith('#')) goTo(decodeURIComponent(address.slice(1)).toLowerCase());
      else props.link?.(address);
    },
    ...(props.image ? { image: props.image } : {}),
  };
  /** Each top-level block's first line, by its element. */
  const lines = new WeakMap<Element, number>();
  // Drawn by `page` before anything follows the editor.
  let body!: HTMLElement;
  /** Scrolls to the editor's top line. */
  const follow = (line: number) => {
    const origin = body.getBoundingClientRect().top - container.scrollTop;
    const blocks = [...body.children].map((element) => ({
      line: lines.get(element) as number,
      top: element.getBoundingClientRect().top - origin,
    }));
    const end = { line: Number.MAX_SAFE_INTEGER, top: body.scrollHeight };
    container.scrollTop = scrollFor(blocks, line, end);
  };
  const page = () => {
    const text = props.text();
    body = document.createElement('div');
    body.className = 'cerebro-markdown';
    const tree = gfmParser.parse(text);
    let line = 0;
    let at = 0;
    for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
      for (; at < child.from; at++) if (text[at] === '\n') line++;
      const before = body.lastElementChild;
      drawMarkdown(child, text, body, style);
      const drawn = body.lastElementChild;
      if (drawn && drawn !== before) lines.set(drawn, line);
    }
    return body;
  };
  const handle = render(() => <>{page}</>, shadow);
  const following = effect(() => {
    const line = props.line?.();
    if (line !== undefined) follow(line);
    return undefined;
  });
  onCleanup(() => {
    following.dispose();
    handle.dispose();
  });
  return container;
}
