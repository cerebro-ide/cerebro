// Compile-time checks: each @ts-expect-error must be an error, or type-checking fails.
// The checks are never run (bindings need an owner); the test only keeps the file in the run.

import { expect, it } from 'vitest';
import type { Child } from '../src/index.js';

function Label(props: { text: () => string; count?: number }): Child {
  return props.text();
}

export const checks = (): Node[] => [
  // Events are typed by name.
  <button on:click={(event) => event.clientX} />,
  <input on:input={(event) => event.target} />,
  // Custom events take any handler.
  <div on:dock-change={(event: CustomEvent<number>) => event.detail} />,
  // @ts-expect-error -- a click is a MouseEvent, not a KeyboardEvent
  <button on:click={(event: KeyboardEvent) => event.key} />,

  // Element properties are typed, and may be reactive.
  <input value="x" disabled={() => true} />,
  // @ts-expect-error -- value is a string
  <input value={5} />,
  // @ts-expect-error -- unknown names are rejected on HTML elements
  <div colour="red" />,
  // data-, aria-, attr: and prop: are open-ended.
  <div data-id={1} aria-label="x" attr:for="y" prop:anything={{}} />,

  // `ref` receives the element's own type.
  <canvas ref={(canvas) => canvas.getContext('2d')} />,

  // SVG takes attributes by any name.
  <svg viewBox="0 0 1 1">
    <path d="M0 0" stroke-width={1} />
  </svg>,

  // Custom elements take any props.
  <cerebro-dock layout={{ panes: 2 }} />,

  // Components check their props.
  <Label text={() => 'x'} />,
  // @ts-expect-error -- text must be a function
  <Label text="x" />,
  // @ts-expect-error -- text is required
  <Label count={1} />,
];

it('type checks', () => {
  expect(typeof checks).toBe('function');
});
