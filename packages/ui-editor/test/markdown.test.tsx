import '@cerebro-ide/theme/themes.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { tagHighlighter, tags } from '@lezer/highlight';
import { afterEach, describe, expect, it } from 'vitest';
import { drawMarkdown, gfmParser, type MarkdownStyle } from '../src/markdown.js';
import { MarkdownPreview } from '../src/index.js';
import { scrollFor } from '../src/markdown-preview.js';

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

  it('draws nothing for a link’s definition, as GitHub’s page', () => {
    expect(page('[x]: https://x.y "Title"\n\nText').innerHTML).toBe('<p>Text</p>');
  });

  it('shows an image once its source comes, its words until then or without one', async () => {
    const asked: string[] = [];
    const image = (address: string) => {
      asked.push(address);
      if (address === 'gone.png') return Promise.reject(new Error('gone'));
      return Promise.resolve(address === 'cat.png' ? 'data:image/png;base64,AA==' : undefined);
    };
    const body = page('![a cat](cat.png) ![a dog](dog.png) ![gone](gone.png) ![ref][x]', {
      ...style,
      image,
    });
    expect(body.textContent).toBe('a cat a dog gone ref');
    await expect.poll(() => body.querySelector('img')).not.toBeNull();
    const img = body.querySelector('img') as HTMLImageElement;
    expect([img.getAttribute('src'), img.alt]).toEqual(['data:image/png;base64,AA==', 'a cat']);
    expect(body.querySelectorAll('img')).toHaveLength(1);
    expect(body.textContent).toBe(' a dog gone ref');
    expect(asked).toEqual(['cat.png', 'dog.png', 'gone.png']);
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

  it('shows images from where it’s told', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const handle = render(
      () => (
        <MarkdownPreview
          text={() => '![dot](dot.png)'}
          image={() => Promise.resolve('data:image/png;base64,AA==')}
        />
      ),
      container,
    );
    dispose = () => {
      handle.dispose();
    };
    const root = (container.querySelector('.cerebro-markdown-preview') as HTMLElement)
      .shadowRoot as ShadowRoot;
    await expect.poll(() => root.querySelector('img')?.alt).toBe('dot');
  });
});

describe('the preview following the editor', () => {
  it('scrolls to the block a line is in, as far into it as the line is into its lines', () => {
    const blocks = [
      { line: 2, top: 0 },
      { line: 4, top: 100 },
      { line: 10, top: 160 },
    ];
    const end = { line: Number.MAX_SAFE_INTEGER, top: 400 };
    expect(scrollFor(blocks, 0, end)).toBe(0);
    expect(scrollFor(blocks, 3, end)).toBe(50);
    expect(scrollFor(blocks, 7, end)).toBe(130);
    expect(scrollFor(blocks, 10, end)).toBe(160);
    expect(scrollFor(blocks, 40, end)).toBeCloseTo(160, 0);
    expect(
      scrollFor(
        [
          { line: 2, top: 0 },
          { line: 2, top: 30 },
        ],
        2,
        end,
      ),
    ).toBe(30);
  });

  it('shows the editor’s top line’s block at its top', () => {
    const line = signal(0);
    const parts = Array.from({ length: 40 }, (_, i) => `## Part ${String(i)}\n\nText.\n`);
    // A link's definition draws nothing: no block.
    const text = `[x]: https://x.y\n${parts.join('\n')}`;
    const container = document.body.appendChild(document.createElement('div'));
    container.style.cssText = 'position: fixed; left: 0; top: 0; width: 500px; height: 300px;';
    const handle = render(
      () => <MarkdownPreview text={() => text} line={() => line.get()} />,
      container,
    );
    const preview = container.querySelector('.cerebro-markdown-preview') as HTMLElement;
    preview.style.height = '300px';
    const root = preview.shadowRoot as ShadowRoot;
    // Part 10 starts at line 41: four lines a part, after the definition.
    line.set(41);
    const heading = [...root.querySelectorAll('h2')][10] as HTMLElement;
    expect(heading.getBoundingClientRect().top - preview.getBoundingClientRect().top).toBeCloseTo(
      0,
      0,
    );
    expect(preview.scrollTop).toBeGreaterThan(0);
    handle.dispose();
    container.remove();
  });
});
