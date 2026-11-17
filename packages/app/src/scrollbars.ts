// What a press on a scrollbar's track does on macOS, as the system's setting says (System Settings →
// Appearance, "Click in the scroll bar to"): jump to the spot that's clicked, or the next page. As
// IntelliJ's `MacScrollBarUI`, which reads it (`AppleScrollerPagingBehavior`, read from its
// source). The page can't read it: it asks here.

import { systemPreferences } from 'electron';
import { handle } from './ipc.js';

export const SCROLLBARS_JUMP = 'cerebro:scrollbars:jump';

/** Whether a press on a track jumps to the spot: only on macOS, where the system says. */
export function jumpToSpot(platform: NodeJS.Platform = process.platform): boolean {
  return (
    platform === 'darwin' &&
    systemPreferences.getUserDefault('AppleScrollerPagingBehavior', 'boolean')
  );
}

/** Lets pages ask whether a press on a track jumps to the spot. */
export function installScrollbars(platform: NodeJS.Platform = process.platform): void {
  handle(SCROLLBARS_JUMP, () => jumpToSpot(platform));
}
