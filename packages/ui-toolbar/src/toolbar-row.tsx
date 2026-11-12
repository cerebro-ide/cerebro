// A row of toolbar items that keeps to its width, as IntelliJ's toolbars (ActionToolbarImpl, its
// NOWRAP layout): the items that don't fit are hidden, from the last, and a » shows at the row's
// end. Pointing at the » (or pressing it) shows the whole row in a popup over it, which
// goes when the pointer leaves it, on a click outside or on Escape, but not while a dropdown in it
// is open (IntelliJ's isActionPopupStackEmpty). A vertical one (IntelliJ's vertical toolbars, as
// the Log's branches pane's) keeps to its height the same way, its » at the bottom.

import { onCleanup, render, type Child } from '@cerebro-ide/jsx';

export interface ToolbarRowProps {
  /** For screen readers: what the row's items act on. */
  label: string;
  /** The items, rendered in the row and again in the popup. */
  items: () => Child;
  /** A row, or a column; a row to start with. */
  orientation?: 'horizontal' | 'vertical';
}

export function ToolbarRow(props: ToolbarRowProps): Node {
  /** Closes the popup, while it's open. */
  let popup: (() => void) | undefined;
  const vertical = props.orientation === 'vertical';
  /** Whether the items take more room than the row has. */
  const over = () =>
    vertical ? items.scrollHeight > items.clientHeight : items.scrollWidth > items.clientWidth;
  const items = (<div class="cerebro-toolbar-row__items">{props.items()}</div>) as HTMLElement;
  const more = (
    <button
      type="button"
      class="cerebro-toolbar-row__more"
      aria-label="Show Hidden Items"
      aria-haspopup="true"
      hidden
      on:pointerenter={() => {
        show();
      }}
      on:click={() => {
        show();
      }}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M4 4.5l3.5 3.5L4 11.5M8.5 4.5L12 8l-3.5 3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  ) as HTMLElement;
  const row = (
    <div
      class={vertical ? 'cerebro-toolbar-row cerebro-toolbar-row--vertical' : 'cerebro-toolbar-row'}
      role="group"
      aria-label={props.label}
    >
      {items}
      {more}
    </div>
  ) as HTMLElement;

  /** Shows every item, then hides from the last while they don't fit, the » shown. */
  const fit = () => {
    const children = [...items.children] as HTMLElement[];
    for (const child of children) child.hidden = false;
    more.hidden = true;
    if (!over()) return;
    more.hidden = false;
    for (let i = children.length - 1; i >= 0 && over(); i--) {
      (children[i] as HTMLElement).hidden = true;
    }
  };
  // In the next frame: showing the » resizes the items, which would otherwise be measured again in
  // the same one (the browser's "ResizeObserver loop" error).
  let frame = 0;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  const resizes = new ResizeObserver(later);
  resizes.observe(items);
  // An item's text changed (a filter's value), or items came or went.
  const changes = new MutationObserver(later);
  changes.observe(items, { childList: true, subtree: true, characterData: true });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    resizes.disconnect();
    changes.disconnect();
    popup?.();
  });

  const show = () => {
    if (popup) return;
    const element = document.createElement('div');
    element.className = vertical
      ? 'cerebro-toolbar-row__popup cerebro-toolbar-row__popup--vertical'
      : 'cerebro-toolbar-row__popup';
    element.setAttribute('role', 'toolbar');
    if (vertical) element.setAttribute('aria-orientation', 'vertical');
    element.setAttribute('aria-label', props.label);
    document.body.append(element);
    const handle = render(props.items, element);
    // Over the row, where it starts; kept on the screen.
    const at = row.getBoundingClientRect();
    const { width, height } = element.getBoundingClientRect();
    const x = vertical ? at.left : Math.max(0, Math.min(at.left, window.innerWidth - width));
    const y = vertical ? Math.max(0, Math.min(at.top, window.innerHeight - height)) : at.top;
    element.style.left = `${String(x)}px`;
    element.style.top = `${String(y)}px`;
    const busy = () => element.querySelector('[aria-expanded="true"]') !== null;
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node) && !busy()) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy()) close();
    };
    const left = () => {
      if (!busy()) close();
    };
    const close = () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key, true);
      handle.dispose();
      element.remove();
      popup = undefined;
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    element.addEventListener('pointerleave', left);
    popup = close;
  };

  return row;
}
