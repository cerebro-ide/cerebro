// Pointer dragging shared by the views: following the pointer on the whole window, a threshold before
// a press becomes a drag, and the label that follows the pointer.

/** How far the pointer moves before a press becomes a drag, in pixels. */
export const DRAG_THRESHOLD = 4;

/** The offset of the drag label from the pointer, in pixels. */
const GHOST_OFFSET = 12;

/** Follows the pointer on the whole window until it's released (committed) or Escape (cancelled). */
export function trackPointer(
  onMove: (event: PointerEvent) => void,
  onEnd: (committed: boolean) => void,
): void {
  const move = (event: PointerEvent) => {
    onMove(event);
  };
  const up = () => {
    end(true);
  };
  const cancel = () => {
    end(false);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') end(false);
  };
  const end = (committed: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
    onEnd(committed);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key);
}

export interface DragHandlers {
  /** The pointer moved past the threshold: the drag has started. */
  start(): void;
  move(event: PointerEvent): void;
  /** Only called if the drag started. */
  end(committed: boolean): void;
}

/** A drag from a press: it starts past the threshold, with `label` following the pointer. */
export function dragFrom(down: PointerEvent, label: string, handlers: DragHandlers): void {
  let ghost: HTMLElement | undefined;
  trackPointer(
    (move) => {
      if (!ghost) {
        const distance = Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY);
        if (distance < DRAG_THRESHOLD) return;
        ghost = document.createElement('div');
        ghost.className = 'cerebro-drag-ghost';
        ghost.textContent = label;
        document.body.append(ghost);
        handlers.start();
      }
      placeGhost(ghost, move.clientX, move.clientY);
      handlers.move(move);
    },
    (committed) => {
      if (!ghost) return;
      ghost.remove();
      handlers.end(committed);
    },
  );
}

/** Puts the drag label below and right of the pointer, flipped to stay inside the window. */
function placeGhost(ghost: HTMLElement, x: number, y: number): void {
  const right = x + GHOST_OFFSET + ghost.offsetWidth <= window.innerWidth;
  const below = y + GHOST_OFFSET + ghost.offsetHeight <= window.innerHeight;
  const left = right ? x + GHOST_OFFSET : x - GHOST_OFFSET - ghost.offsetWidth;
  const top = below ? y + GHOST_OFFSET : y - GHOST_OFFSET - ghost.offsetHeight;
  ghost.style.transform = `translate(${String(left)}px, ${String(top)}px)`;
}
