import { makeObservable, signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsxDEV } from '../src/jsx-dev-runtime.js';
import { Fragment, jsx, jsxs } from '../src/jsx-runtime.js';
import { onCleanup, render, type Child } from '../src/index.js';
import { Owner } from '../src/owner.js';

const disposers: (() => void)[] = [];

function mount(fn: () => Child) {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = render(fn, container);
  disposers.push(() => {
    handle.dispose();
    container.remove();
  });
  return {
    container,
    dispose: () => {
      handle.dispose();
    },
  };
}

const text = (node: Node) => node.textContent;

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('reactive regions', () => {
  it('updates text, keeping the same node', () => {
    const count = signal(1);
    const { container } = mount(() => <p>{() => count.get()}</p>);
    const p = container.querySelector('p') as HTMLElement;
    const node = p.childNodes[1];
    count.set(2);
    expect(text(p)).toBe('2');
    expect(p.childNodes[1]).toBe(node);
  });

  it('swaps between nodes, text and nothing', () => {
    const mode = signal<'node' | 'text' | 'none' | 'list'>('node');
    const { container } = mount(() => (
      <div>
        {() => {
          switch (mode.get()) {
            case 'node':
              return <b>bold</b>;
            case 'text':
              return 'plain';
            case 'list':
              return [<i>a</i>, 'b'];
            default:
              return null;
          }
        }}
      </div>
    ));
    const div = container.querySelector('div') as HTMLElement;
    expect(div.innerHTML).toBe('<!----><b>bold</b><!---->');
    mode.set('text');
    expect(div.innerHTML).toBe('<!---->plain<!---->');
    mode.set('none');
    expect(div.innerHTML).toBe('<!----><!---->');
    mode.set('list');
    expect(div.innerHTML).toBe('<!----><i>a</i>b<!---->');
    mode.set('node');
    expect(div.innerHTML).toBe('<!----><b>bold</b><!---->');
  });

  it('keeps nested regions correct when the inner one changes first', () => {
    const outer = signal('a');
    const inner = signal(1);
    const { container } = mount(() => (
      <div>
        {() => (
          <span>
            {outer.get()}
            {() => (inner.get() > 1 ? <em>many</em> : 'one')}
          </span>
        )}
      </div>
    ));
    const div = container.querySelector('div') as HTMLElement;
    inner.set(2);
    expect(text(div)).toBe('amany');
    outer.set('b');
    expect(text(div)).toBe('bmany');
    expect(div.querySelectorAll('span')).toHaveLength(1);
  });

  it('renders a region as the top-level child', () => {
    const name = signal('x');
    const { container } = mount(() => () => name.get());
    name.set('y');
    expect(text(container)).toBe('y');
  });

  it('works with models', () => {
    class Worktree {
      name = 'main';
      branch = 'latest';
      constructor() {
        makeObservable(this);
      }
      get label() {
        return `${this.name} (${this.branch})`;
      }
      rename(name: string) {
        this.name = name;
        this.branch = name;
      }
    }
    const wt = new Worktree();
    const { container } = mount(() => <span>{() => wt.label}</span>);
    wt.rename('dev');
    expect(text(container)).toBe('dev (dev)');
  });
});

describe('components', () => {
  it('run once and receive reactive values as functions', () => {
    const body = vi.fn();
    function Label(props: { text: () => string; static: string }) {
      body();
      return (
        <span>
          {props.static}:{props.text}
        </span>
      );
    }
    const value = signal('a');
    const { container } = mount(() => <Label text={() => value.get()} static="s" />);
    value.set('b');
    expect(text(container)).toBe('s:b');
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('do not make the surrounding region depend on what their body reads', () => {
    const read = signal(1);
    const regionRuns = vi.fn();
    function Reader() {
      return <i>{read.get()}</i>;
    }
    mount(() => () => {
      regionRuns();
      return <Reader />;
    });
    read.set(2);
    expect(regionRuns).toHaveBeenCalledTimes(1);
  });

  it('receive children, and may return any child', () => {
    function Box(props: { children?: Child }) {
      return <div class="box">{props.children}</div>;
    }
    function Many() {
      return ['x', <b>y</b>];
    }
    function Nothing() {
      return null;
    }
    const { container } = mount(() => (
      <Box>
        <Many />
        <Nothing />
        <>
          <i>f</i>
        </>
      </Box>
    ));
    expect((container.querySelector('.box') as HTMLElement).innerHTML).toBe('x<b>y</b><i>f</i>');
  });
});

describe('ownership and cleanup', () => {
  it('runs cleanups when a region replaces a component, and on dispose', () => {
    const log: string[] = [];
    function Item(props: { name: string }) {
      onCleanup(() => log.push(`cleanup ${props.name}`));
      return <li>{props.name}</li>;
    }
    const which = signal('a');
    const { dispose } = mount(() => <ul>{() => <Item name={which.get()} />}</ul>);
    which.set('b');
    expect(log).toEqual(['cleanup a']);
    dispose();
    expect(log).toEqual(['cleanup a', 'cleanup b']);
  });

  it('stops bindings after dispose and removes what it rendered', () => {
    const value = signal('a');
    const getter = vi.fn(() => value.get());
    const { container, dispose } = mount(() => <p title={getter}>{getter}</p>);
    expect(getter).toHaveBeenCalledTimes(2);
    dispose();
    value.set('b');
    expect(getter).toHaveBeenCalledTimes(2);
    expect(container.childNodes).toHaveLength(0);
  });

  it('disposes nested regions with their parent', () => {
    const outer = signal(1);
    const inner = signal(1);
    const innerRuns = vi.fn();
    mount(() => () => {
      outer.get();
      return (
        <div>
          {() => {
            innerRuns();
            return inner.get();
          }}
        </div>
      );
    });
    outer.set(2);
    innerRuns.mockClear();
    inner.set(2);
    expect(innerRuns).toHaveBeenCalledTimes(1);
  });

  it('runs a cleanup added after dispose immediately, and disposes once', () => {
    const owner = new Owner();
    const first = vi.fn();
    owner.add(first);
    owner.dispose();
    owner.dispose();
    const late = vi.fn();
    owner.add(late);
    expect(first).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('requires an owner for bindings and cleanups', () => {
    expect(() => <p>{() => 'x'}</p>).toThrow('must be created while rendering');
    expect(() => {
      onCleanup(() => undefined);
    }).toThrow('must be created while rendering');
  });

  it('allows static elements outside render', () => {
    expect((<p>static</p>).textContent).toBe('static');
  });
});

describe('runtime entry points', () => {
  it('jsx, jsxs, jsxDEV and Fragment', () => {
    const { container } = mount(() =>
      jsxs(Fragment, {
        children: [jsx('b', { children: 'a' }), jsxDEV('i', { children: 'b' })],
      }),
    );
    expect(text(container)).toBe('ab');
  });
});
