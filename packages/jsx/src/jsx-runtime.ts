// The automatic JSX runtime: TypeScript compiles `<div />` to `jsx('div', props)` imported from here
// (`"jsx": "react-jsx"`, `"jsxImportSource": "@cerebro-ide/jsx"`).

import { callComponent, createElement, type Props } from './dom.js';
import type { Child, Component, IntrinsicElements as Intrinsic } from './types.js';

export function jsx(type: string | Component<Props>, props: Props): Node {
  return typeof type === 'function' ? callComponent(type, props) : createElement(type, props);
}

export { jsx as jsxs };

export function Fragment(props: { children?: Child }): Child {
  return props.children;
}

// TypeScript looks up the JSX types in a namespace named JSX exported by the runtime.
// eslint-disable-next-line @typescript-eslint/no-namespace -- required by TypeScript's JSX lookup
export declare namespace JSX {
  type Element = Node;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each component declares its own props
  type ElementType = string | ((props: any) => Child);
  interface ElementChildrenAttribute {
    children: unknown;
  }
  type IntrinsicElements = Intrinsic;
}
