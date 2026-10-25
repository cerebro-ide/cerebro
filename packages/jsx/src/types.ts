// Types for JSX: what may appear as a child, components, and the props of each intrinsic element.

/** Anything that can be rendered. A function is a reactive region, re-rendered when what it reads changes. */
export type Child =
  Node | string | number | bigint | boolean | null | undefined | Child[] | (() => Child);

/** Components run once; values that should update are passed as functions. */
export type Component<P = object> = (props: P) => Child;

/** A value, or a function that is re-read whenever what it reads changes. */
export type Reactive<T> = T | (() => T);

type StyleValue = string | number | null | undefined | false;

/** A style string, or an object of properties (camelCase, kebab-case or `--custom`), each reactive. */
export type Style =
  | string
  | Record<string, Reactive<StyleValue>>
  | (() => string | Record<string, StyleValue> | null | undefined);

type AttributeValue = string | number | boolean | null | undefined;

/**
 * Writable-looking, non-function properties of an element, minus those JSX defines itself.
 * `null` or `undefined` removes the attribute.
 */
type ElementProperties<E> = {
  [
    K in keyof E as K extends string
      ? K extends 'children' | 'style' | `on${string}`
        ? never
        : E[K] extends (...args: never[]) => unknown
          ? never
          : K
      : never
  ]?: Reactive<E[K] | null | undefined>;
};

type EventHandlers<M> = {
  [K in keyof M as `on:${K & string}`]?: (event: M[K]) => void;
};

interface BaseProps<E> {
  ref?: (element: E) => void;
  children?: Child;
  class?: Reactive<string | null | undefined>;
  style?: Style;
  // Custom events: any name, the handler typed by the caller.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any event type a custom element dispatches
  [event: `on:${string}`]: ((event: any) => void) | undefined;
  [attribute: `attr:${string}`]: Reactive<AttributeValue>;
  [property: `prop:${string}`]: unknown;
  [data: `data-${string}`]: Reactive<AttributeValue>;
  [aria: `aria-${string}`]: Reactive<AttributeValue>;
}

export type HTMLProps<E extends HTMLElement> = BaseProps<E> &
  EventHandlers<HTMLElementEventMap> &
  ElementProperties<E>;

export type SVGProps<E extends SVGElement> = BaseProps<E> &
  EventHandlers<SVGElementEventMap> & {
    [attribute: string]: unknown;
  };

/** SVG tag names that aren't also HTML tag names; `a`, `script`, `style` and `title` are HTML. */
export type SVGTag = Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>;

export type IntrinsicElements = {
  [K in keyof HTMLElementTagNameMap]: HTMLProps<HTMLElementTagNameMap[K]>;
} & {
  [K in SVGTag]: SVGProps<SVGElementTagNameMap[K]>;
} & {
  // Custom elements: known properties of HTMLElement plus anything the element defines.
  [tag: `${string}-${string}`]: HTMLProps<HTMLElement> & { [name: string]: unknown };
};
