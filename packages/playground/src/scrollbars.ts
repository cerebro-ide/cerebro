// The app's scrollbars (`ui-scrollbar`) in each of its pages: on macOS, a press on a track jumps to
// the spot or pages as the system's setting says, which the app reads for the page. Read at the
// start and each time the window gets the focus, so a change made in System Settings shows once
// back (Cerebro's choice, open to change: IntelliJ listens for the system's notice of it).

import { installScrollbars } from '@cerebro-ide/ui-scrollbar';

/** Installs the scrollbars; `mac` whether it's macOS. Returns what removes them. */
export function installAppScrollbars(mac: boolean): () => void {
  let jumps = false;
  const read = () => {
    void window.cerebro?.scrollbars.jumpToSpot().then((value) => {
      jumps = value;
    });
  };
  if (mac) {
    read();
    window.addEventListener('focus', read);
  }
  const remove = installScrollbars({ mac, jumpToSpot: () => jumps });
  return () => {
    window.removeEventListener('focus', read);
    remove();
  };
}
