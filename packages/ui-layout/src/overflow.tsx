// Tabs that don't fit their strip, as IntelliJ's: they keep their width and the strip scrolls
// (the mouse wheel scrolls it too), the active tab always in view, the cut edge faded; and a
// chevron after the tabs, shown only while some are hidden, lists them all, each with its close
// button, the active one highlighted. For any strip of tabs: the editor's, a tool window's.

import { onCleanup, type Child } from '@cerebro-ide/jsx';
import { makeObservable } from '@cerebro-ide/reactive';
import { fuzzyFilter, openPicker, type PickerHandle, type PickerItem } from '@cerebro-ide/ui-popup';
import { tooltip } from '@cerebro-ide/ui-tooltip';

/** Whether a strip's tabs are cut at its start or its end. */
export class TabOverflow {
  start = false;
  end = false;

  constructor() {
    makeObservable(this);
  }

  /** Whether some tabs are hidden, wholly or in part. */
  get hidden(): boolean {
    return this.start || this.end;
  }
}

/** A tab, as the chevron's list shows it. */
export interface ListedTab {
  id: string;
  title: string;
  icon?: () => Child;
  active: boolean;
  select: () => void;
  close?: () => void;
}

/** How much of a cut tab shows, at least, past the edge it's scrolled to: a hint there are more. */
const PEEK = 24;

/**
 * Keeps `overflow` in step with a strip of tabs, scrolls the strip by the mouse wheel, and keeps
 * its active tab (`[aria-selected="true"]`) in view as it changes. A ref, for the strip.
 */
export function watchOverflow(overflow: TabOverflow): (strip: Element) => void {
  return (element) => {
    const strip = element as HTMLElement;
    // No scrollbar over the tabs, as IntelliJ's: the wheel scrolls them (below).
    strip.dataset['scrollbar'] = 'none';
    const measure = () => {
      overflow.start = strip.scrollLeft > 0;
      overflow.end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    };
    const reveal = () => {
      const active = strip.querySelector<HTMLElement>('[aria-selected="true"]');
      if (active) {
        const left = active.offsetLeft - strip.offsetLeft;
        const right = left + active.offsetWidth;
        // Past the cut edge, a little of the next tab shows too.
        if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - PEEK);
        else if (right > strip.scrollLeft + strip.clientWidth) {
          strip.scrollLeft = right - strip.clientWidth + PEEK;
        }
      }
      measure();
    };
    // In the next frame: showing or hiding the chevron resizes the strip, which would otherwise be
    // measured again in the same one (the browser's "ResizeObserver loop" error).
    let frame = 0;
    const resizes = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    });
    resizes.observe(strip);
    // Tabs opened, closed, renamed or activated.
    const changes = new MutationObserver(reveal);
    changes.observe(strip, {
      childList: true,
      subtree: true,
      characterData: true,
      attributeFilter: ['aria-selected'],
    });
    const wheel = (event: WheelEvent) => {
      const delta = event.deltaX === 0 ? event.deltaY : event.deltaX;
      if (delta === 0 || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += delta;
    };
    // The middle button closes a tab; in a strip that scrolls, Chromium on Windows would start its
    // autoscroll instead.
    const middle = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    strip.addEventListener('wheel', wheel, { passive: false });
    strip.addEventListener('mousedown', middle);
    strip.addEventListener('scroll', measure, { passive: true });
    onCleanup(() => {
      cancelAnimationFrame(frame);
      resizes.disconnect();
      changes.disconnect();
      strip.removeEventListener('wheel', wheel);
      strip.removeEventListener('mousedown', middle);
      strip.removeEventListener('scroll', measure);
    });
    reveal();
  };
}

/** The class names of a strip whose tabs are cut: each cut edge fades. */
export function overflowClasses(overflow: TabOverflow, block: string): string[] {
  return [overflow.start ? `${block}--cut-start` : '', overflow.end ? `${block}--cut-end` : ''];
}

type TabItem = PickerItem & { tab: ListedTab };

/** The chevron after a strip's tabs, shown while some are hidden: lists them all, to choose one. */
export function MoreTabs(props: { overflow: TabOverflow; tabs: () => ListedTab[] }): Node {
  let list: PickerHandle<TabItem> | undefined;
  const button = (
    <button
      type="button"
      class="cerebro-tabs-more"
      aria-label="Show Hidden Tabs"
      aria-haspopup="listbox"
      hidden={() => !props.overflow.hidden}
      ref={tooltip({ text: () => 'Show Hidden Tabs' })}
      on:click={() => {
        // A second press closes the list.
        if (list?.open) list.close();
        else void choose();
      }}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M4 6.5l4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  ) as HTMLElement;
  const choose = async () => {
    const items = (): TabItem[] =>
      props.tabs().map((tab) => ({
        label: tab.title,
        ...(tab.icon ? { icon: tab.icon } : {}),
        ...(tab.close ? { close: { label: `Close ${tab.title}`, run: tab.close } } : {}),
        tab,
      }));
    list = openPicker<TabItem>({
      label: 'Tabs',
      position: { below: button },
      width: 300,
      owner: button,
      initial: Math.max(
        0,
        props.tabs().findIndex((tab) => tab.active),
      ),
      items: (query) => fuzzyFilter(items(), query),
    });
    const chosen = await list.result;
    chosen?.tab.select();
  };
  return button;
}
