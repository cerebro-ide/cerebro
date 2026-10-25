// Building DOM: elements with their props, children, and reactive regions.
//
// Props: `on:<event>` adds a listener; `ref` is called with the finished element; `style` takes a
// string or an object; `prop:<name>` and `attr:<name>` force a property or an attribute. Otherwise
// a name the element has as a property is set as a property, anything else as an attribute (always
// attributes on SVG elements). A function value is a binding, re-applied when what it reads changes.

import { untracked } from '@cerebro-ide/reactive';
import { bind, Owner, requireOwner, runWithOwner } from './owner.js';
import type { Child, Component, SVGTag } from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const SVG_TAG_LIST = [
  'animate',
  'animateMotion',
  'animateTransform',
  'circle',
  'clipPath',
  'defs',
  'desc',
  'ellipse',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
  'filter',
  'foreignObject',
  'g',
  'image',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'metadata',
  'mpath',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'set',
  'stop',
  'svg',
  'switch',
  'symbol',
  'text',
  'textPath',
  'tspan',
  'use',
  'view',
] as const satisfies readonly SVGTag[];

/** Fails to compile, naming the missing tags, if the list misses an SVG tag the DOM types know. */
function tagSet<T extends readonly SVGTag[]>(
  tags: T &
    (Exclude<SVGTag, T[number]> extends never ? unknown : { missing: Exclude<SVGTag, T[number]> }),
): Set<string> {
  return new Set(tags);
}

const SVG_TAGS = tagSet(SVG_TAG_LIST);

export type Props = Record<string, unknown> & { children?: Child };

export function createElement(tag: string, props: Props): Element {
  const element = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  // Children first, so props that depend on them (such as a <select>'s value) apply correctly.
  appendChildren(element, props.children);
  let ref: ((element: Element) => void) | undefined;
  for (const [name, value] of Object.entries(props)) {
    if (name === 'children') continue;
    if (name === 'ref') ref = value as (element: Element) => void;
    else if (name.startsWith('on:')) {
      if (value != null) element.addEventListener(name.slice(3), value as EventListener);
    } else if (name === 'style') setStyle(element, value);
    else if (typeof value === 'function') {
      bind(() => {
        assign(element, name, (value as () => unknown)());
        return undefined;
      });
    } else assign(element, name, value);
  }
  ref?.(element);
  return element;
}

/** Calls a component untracked, so what its body reads doesn't re-render the region around it. */
export function callComponent<P>(component: Component<P>, props: P): Node {
  return toNode(untracked(() => component(props)));
}

export function toNode(child: Child): Node {
  const nodes = toNodes(child);
  if (nodes.length === 1) return nodes[0] as Node;
  const fragment = new DocumentFragment();
  for (const node of nodes) fragment.append(node);
  return fragment;
}

export function toNodes(child: Child, out: Node[] = []): Node[] {
  if (child == null || typeof child === 'boolean') return out;
  if (Array.isArray(child)) {
    for (const item of child) toNodes(item, out);
  } else if (typeof child === 'function') {
    out.push(...region(child).childNodes);
  } else if (child instanceof DocumentFragment) {
    out.push(...child.childNodes);
  } else if (child instanceof Node) {
    out.push(child);
  } else {
    out.push(new Text(String(child)));
  }
  return out;
}

/** Removes the nodes between two markers, exclusive. */
export function clearBetween(start: Node, end: Node): void {
  while (start.nextSibling && start.nextSibling !== end) start.nextSibling.remove();
}

function appendChildren(parent: Element, children: Child): void {
  for (const node of toNodes(children)) parent.appendChild(node);
}

/**
 * A reactive region: the nodes between two comment markers, re-rendered when what `fn` reads
 * changes. Whatever a run creates is owned by that run and disposed before the next one.
 */
function region(fn: () => Child): DocumentFragment {
  const start = new Comment('');
  const end = new Comment('');
  const fragment = new DocumentFragment();
  fragment.append(start, end);
  let owner: Owner | undefined;
  requireOwner('A reactive region').add(() => owner?.dispose());
  bind(() => {
    owner?.dispose();
    const next = (owner = new Owner());
    const value = runWithOwner(next, fn);
    const text = start.nextSibling;
    const isText =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint';
    if (isText && text instanceof Text && text.nextSibling === end) {
      // Text replacing text keeps the same node.
      text.data = String(value);
      return undefined;
    }
    const nodes = runWithOwner(next, () => toNodes(value));
    clearBetween(start, end);
    const parent = end.parentNode as ParentNode;
    for (const node of nodes) parent.insertBefore(node, end);
    return undefined;
  });
  return fragment;
}

function assign(element: Element, name: string, value: unknown): void {
  if (name.startsWith('prop:')) {
    (element as unknown as Record<string, unknown>)[name.slice(5)] = value;
  } else if (name.startsWith('attr:')) {
    setAttribute(element, name.slice(5), value);
  } else if (value != null && !(element instanceof SVGElement) && name in element) {
    (element as unknown as Record<string, unknown>)[name] = value;
  } else {
    setAttribute(element, name, value);
  }
}

function setAttribute(element: Element, name: string, value: unknown): void {
  if (value == null || value === false) element.removeAttribute(name);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- converts like the DOM itself would
  else element.setAttribute(name, value === true ? '' : String(value));
}

function setStyle(element: HTMLElement | SVGElement, style: unknown): void {
  if (typeof style === 'function') {
    bind(() => {
      element.removeAttribute('style');
      applyStyle(element, (style as () => unknown)());
      return undefined;
    });
    return;
  }
  if (style !== null && typeof style === 'object') {
    for (const [key, value] of Object.entries(style)) {
      if (typeof value === 'function') {
        bind(() => {
          setStyleProperty(element, key, (value as () => unknown)());
          return undefined;
        });
      } else setStyleProperty(element, key, value);
    }
    return;
  }
  applyStyle(element, style);
}

function applyStyle(element: HTMLElement | SVGElement, style: unknown): void {
  if (style == null) element.removeAttribute('style');
  else if (typeof style === 'string') element.setAttribute('style', style);
  else for (const [key, value] of Object.entries(style)) setStyleProperty(element, key, value);
}

function setStyleProperty(element: HTMLElement | SVGElement, key: string, value: unknown): void {
  const name = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  if (value == null || value === false) element.style.removeProperty(name);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- converts like the DOM itself would
  else element.style.setProperty(name, String(value));
}
