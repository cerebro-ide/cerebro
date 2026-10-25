import { trackPointer } from './drag.js';

export interface SplitterProps<S> {
  /** The direction of the line the splitter draws. */
  line: 'vertical' | 'horizontal';
  hidden?: () => boolean;
  /** Captured when a drag starts, and passed to every `onDrag`. */
  start: () => S;
  /** `delta` is how far the pointer moved across the line since the drag started. */
  onDrag: (start: S, delta: number, element: HTMLElement) => void;
  /** Called with true when a drag starts, and false when it ends. */
  onResizing?: (active: boolean) => void;
}

/** A 1px line with a wider invisible handle, dragged to resize what's on either side. */
export function Splitter<S>(props: SplitterProps<S>): Node {
  const { line } = props;
  return (
    <div
      class={`cerebro-splitter cerebro-splitter--${line}`}
      role="separator"
      aria-orientation={line}
      hidden={props.hidden ?? false}
      on:pointerdown={(down: PointerEvent) => {
        if (down.button !== 0) return;
        down.preventDefault();
        const element = down.currentTarget as HTMLElement;
        const start = props.start();
        const origin = line === 'vertical' ? down.clientX : down.clientY;
        props.onResizing?.(true);
        trackPointer(
          (move) => {
            const position = line === 'vertical' ? move.clientX : move.clientY;
            props.onDrag(start, position - origin, element);
          },
          () => {
            props.onResizing?.(false);
          },
        );
      }}
    />
  );
}
