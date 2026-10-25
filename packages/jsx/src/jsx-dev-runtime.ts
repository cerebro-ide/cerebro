// The development variant of the runtime (`"jsx": "react-jsxdev"`); the extra arguments are ignored.

import { jsx } from './jsx-runtime.js';
import type { Props } from './dom.js';
import type { Component } from './types.js';

export { Fragment, type JSX } from './jsx-runtime.js';

export function jsxDEV(type: string | Component<Props>, props: Props): Node {
  return jsx(type, props);
}
