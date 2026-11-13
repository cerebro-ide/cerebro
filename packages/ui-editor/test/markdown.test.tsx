import '@cerebro-ide/theme/themes.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { tagHighlighter, tags } from '@lezer/highlight';
import { afterEach, describe, expect, it } from 'vitest';
import { drawMarkdown, gfmParser, type MarkdownStyle } from '../src/markdown.js';
import { MarkdownPreview } from '../src/index.js';

const style: MarkdownStyle = {
  highlighter: tagHighlighter([{ tag: tags.keyword, class: 'kw' }]),
  headings: true,
};

/** Markdown drawn as a page. */
function page(text: string, drawn: MarkdownStyle = style): HTMLElement {
  const body = document.createElement('div');
  const tree = gfmParser.parse(text);
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    drawMarkdown(child, text, body, drawn);
  }
  return body;
}

describe('Markdown drawn as a page', () => {
  it('has headings of each level, or paragraphs set apart for a tooltip', () => {
    expect(page('# One\n\n### Three\n\nTwo\n---\n').innerHTML).toBe(
      '<h1>One</h1><h3>Three</h3><h2>Two</h2>',
    );
    expect(page('# One', { ...style, headings: false }).innerHTML).toBe(
      '<p class="cerebro-doc__heading">One</p>',
    );
  });

  it('has GitHub’s tables, strikethrough and task lists', () => {
    expect(page('| a | b |\n|---|---|\n| 1 | ~~x~~ |\n').innerHTML).toBe(
      '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td><s>x</s></td></tr></table>',
    );
    const tasks = page('- [x] done\n- [ ] not\n');
    expect(
      [...tasks.querySelectorAll('input')].map((box) => [box.type, box.checked, box.disabled]),
    ).toEqual([
      ['checkbox', true, true],
      ['checkbox', false, true],
    ]);
    expect(tasks.querySelector('li')?.textContent).toBe(' done');
  });

  it('shows links in the link colour, a bare address too, and an image’s words', () => {
    const body = page('[site](https://a.b) and https://c.d, ![a cat](cat.png)');
    const links = [...body.querySelectorAll('.cerebro-doc__link')] as HTMLElement[];
    expect(links.map((link) => [link.textContent, link.title])).toEqual([
      ['site', 'https://a.b'],
      ['https://c.d', 'https://c.d'],
    ]);
    expect(body.textContent).toBe('site and https://c.d, a cat');
  });

  it('highlights code in a language it knows', () => {
    const code = page('```ts\nconst a = 1;\n```').querySelector('pre') as HTMLElement;
    expect(code.querySelector('.kw')?.textContent).toBe('const');
  });
});

describe('a Markdown preview', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
  });

  it('draws the text as a page, again as it changes, its code in the editor’s colours', () => {
    const text = signal('# Title\n\n```ts\nconst a = 1;\n```\n');
    const container = document.body.appendChild(document.createElement('div'));
    const handle = render(() => <MarkdownPreview text={() => text.get()} />, container);
    dispose = () => {
      handle.dispose();
    };
    const root = (container.querySelector('.cerebro-markdown-preview') as HTMLElement)
      .shadowRoot as ShadowRoot;
    expect(root.querySelector('h1')?.textContent).toBe('Title');
    const keyword = root.querySelector('pre span') as HTMLElement;
    expect(keyword.textContent).toBe('const');
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cerebro-syntax-keyword)';
    expect(getComputedStyle(keyword).color).toBe(getComputedStyle(probe).color);
    text.set('## Changed');
    expect(root.querySelector('h1')).toBeNull();
    expect(root.querySelector('h2')?.textContent).toBe('Changed');
  });
});
