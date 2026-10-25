import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../src/index.js';

let container: HTMLElement;
const disposers: (() => void)[] = [];

function mount(fn: () => Node) {
  container = document.createElement('div');
  document.body.append(container);
  const handle = render(fn, container);
  disposers.push(() => {
    handle.dispose();
    container.remove();
  });
  return container;
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('elements', () => {
  it('builds real DOM', () => {
    const root = mount(() => (
      <section id="s">
        <h1>Title</h1>
        <p>
          {'text'} {42} {10n}
        </p>
      </section>
    ));
    expect(root.innerHTML).toBe(
      '<!----><section id="s"><h1>Title</h1><p>text 42 10</p></section><!---->',
    );
  });

  it('skips null, undefined and booleans, and flattens arrays', () => {
    const root = mount(() => (
      <ul>
        {null}
        {undefined}
        {false}
        {true}
        {[<li>a</li>, [<li>b</li>, 'c']]}
      </ul>
    ));
    expect(root.querySelector('ul')?.innerHTML).toBe('<li>a</li><li>b</li>c');
  });

  it('lays out in a real browser', () => {
    const root = mount(() => <div style={{ width: '120px', height: '10px' }} />);
    expect((root.querySelector('div') as HTMLElement).getBoundingClientRect().width).toBe(120);
  });
});

describe('props', () => {
  it('sets properties the element has, attributes otherwise', () => {
    const root = mount(() => (
      <input id="name" value="hello" data-test="x" aria-label="Name" class="field" disabled />
    ));
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.id).toBe('name');
    expect(input.value).toBe('hello');
    expect(input.getAttribute('data-test')).toBe('x');
    expect(input.getAttribute('aria-label')).toBe('Name');
    expect(input.className).toBe('field');
    expect(input.disabled).toBe(true);
  });

  it('removes attributes for null, undefined and false, and sets true as empty', () => {
    const root = mount(() => (
      <div attr:hidden={true} attr:title={null} data-a={false} data-b={undefined} id={undefined} />
    ));
    const div = root.querySelector('div') as HTMLElement;
    expect(div.outerHTML).toBe('<div hidden=""></div>');
  });

  it('resets a bound property to its default when its value goes null', () => {
    const value = signal<string | null>('abc');
    const checked = signal<boolean | undefined>(true);
    const title = signal<string | null>('tip');
    const root = mount(() => (
      <div>
        <input value={() => value.get()} />
        <input type="checkbox" checked={() => checked.get()} value={() => value.get()} />
        <span title={() => title.get()} />
      </div>
    ));
    const [text, box] = [...root.querySelectorAll('input')] as [HTMLInputElement, HTMLInputElement];
    const span = root.querySelector('span') as HTMLElement;
    value.set(null);
    checked.set(undefined);
    title.set(null);
    // Properties that don't follow their attribute: an input's value, a checkbox's checked.
    expect(text.value).toBe('');
    expect(box.checked).toBe(false);
    // The default for an element like this one: a checkbox's value is "on".
    expect(box.value).toBe('on');
    expect(span.hasAttribute('title')).toBe(false);
    value.set('again');
    expect(text.value).toBe('again');
  });

  it('forces a property or an attribute', () => {
    const root = mount(() => <div prop:custom={{ rich: true }} attr:id="by-attr" />);
    const div = root.querySelector('div') as unknown as HTMLElement & { custom: unknown };
    expect(div.custom).toEqual({ rich: true });
    expect(div.getAttribute('custom')).toBeNull();
    expect(div.id).toBe('by-attr');
  });

  it('sets a select value after its options exist', () => {
    const root = mount(() => (
      <select value="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    ));
    expect((root.querySelector('select') as HTMLSelectElement).value).toBe('b');
  });

  it('binds function values', () => {
    const title = signal('one');
    const hidden = signal(false);
    const root = mount(() => <div title={() => title.get()} attr:hidden={() => hidden.get()} />);
    const div = root.querySelector('div') as HTMLElement;
    expect(div.title).toBe('one');
    title.set('two');
    hidden.set(true);
    expect(div.title).toBe('two');
    expect(div.hidden).toBe(true);
  });

  it('calls ref with the finished element', () => {
    const ref = vi.fn((element: HTMLButtonElement) => {
      expect(element.textContent).toBe('Go');
      expect(element.type).toBe('submit');
    });
    mount(() => (
      <button ref={ref} type="submit">
        Go
      </button>
    ));
    expect(ref).toHaveBeenCalledTimes(1);
  });
});

describe('events', () => {
  it('adds listeners with on:<event>', () => {
    const onClick = vi.fn();
    const root = mount(() => <button on:click={onClick}>Go</button>);
    (root.querySelector('button') as HTMLButtonElement).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
  });

  it('handles custom event names exactly as dispatched', () => {
    const onChange = vi.fn();
    const root = mount(() => <div on:dock-change={onChange} on:missing={undefined} />);
    (root.querySelector('div') as HTMLElement).dispatchEvent(
      new CustomEvent('dock-change', { detail: 7 }),
    );
    expect((onChange.mock.calls[0]?.[0] as CustomEvent).detail).toBe(7);
  });
});

describe('style', () => {
  it('takes a string', () => {
    const root = mount(() => <div style="color: red" />);
    expect((root.querySelector('div') as HTMLElement).style.color).toBe('red');
  });

  it('takes an object with camelCase, kebab-case and custom properties', () => {
    const root = mount(() => (
      <div style={{ fontSize: '12px', 'margin-top': '3px', '--accent': 'blue', color: null }} />
    ));
    const style = (root.querySelector('div') as HTMLElement).style;
    expect(style.fontSize).toBe('12px');
    expect(style.marginTop).toBe('3px');
    expect(style.getPropertyValue('--accent')).toBe('blue');
  });

  it('binds object values and removes falsy ones', () => {
    const width = signal<number | false>(10);
    const root = mount(() => (
      <div style={{ width: () => (width.get() === false ? false : `${String(width.get())}px`) }} />
    ));
    const style = (root.querySelector('div') as HTMLElement).style;
    expect(style.width).toBe('10px');
    width.set(20);
    expect(style.width).toBe('20px');
    width.set(false);
    expect(style.width).toBe('');
  });

  it('binds a whole style, replacing what was there', () => {
    const style = signal<string | Record<string, string> | null>({ color: 'red', width: '1px' });
    const root = mount(() => <div style={() => style.get()} />);
    const div = root.querySelector('div') as HTMLElement;
    expect(div.style.color).toBe('red');
    style.set({ color: 'blue' });
    expect(div.style.color).toBe('blue');
    expect(div.style.width).toBe('');
    style.set('height: 2px');
    expect(div.style.height).toBe('2px');
    style.set(null);
    expect(div.hasAttribute('style')).toBe(false);
  });

  it('removes the style attribute for null', () => {
    const root = mount(() => <div style={null as unknown as string} />);
    expect((root.querySelector('div') as HTMLElement).hasAttribute('style')).toBe(false);
  });
});

describe('SVG', () => {
  it('creates SVG elements in the SVG namespace, with attributes', () => {
    const root = mount(() => (
      <svg viewBox="0 0 10 10" class="icon">
        <g>
          <path d="M0 0L10 10" stroke-width={2} />
        </g>
      </svg>
    ));
    const svg = root.querySelector('svg') as SVGSVGElement;
    const path = root.querySelector('path') as SVGPathElement;
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(path).toBeInstanceOf(SVGPathElement);
    expect(svg.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(svg.getAttribute('class')).toBe('icon');
    expect(path.getAttribute('stroke-width')).toBe('2');
  });

  it('keeps HTML inside foreignObject', () => {
    const root = mount(() => (
      <svg>
        <foreignObject>
          <div>html</div>
        </foreignObject>
      </svg>
    ));
    expect(root.querySelector('div')).toBeInstanceOf(HTMLDivElement);
  });
});

describe('custom elements and shadow DOM', () => {
  class InfoCard extends HTMLElement {
    data: { title: string } | undefined;
    connectedCallback() {
      const shadow = this.attachShadow({ mode: 'open' });
      render(
        () => (
          <h2
            on:click={() =>
              this.dispatchEvent(new CustomEvent('card-open', { composed: true, bubbles: true }))
            }
          >
            {this.data?.title}
          </h2>
        ),
        shadow,
      );
    }
  }
  customElements.define('info-card', InfoCard);

  it('sets rich data as a property and renders into a shadow root', () => {
    const onOpen = vi.fn();
    const root = mount(() => <info-card data={{ title: 'Hello' }} on:card-open={onOpen} />);
    const card = root.querySelector('info-card') as InfoCard;
    expect(card.data).toEqual({ title: 'Hello' });
    const heading = card.shadowRoot?.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toBe('Hello');
    heading.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
