// macOS's window buttons in full screen, where macOS hides its own until the pointer reaches the
// top of the screen: as IntelliJ's (JetBrains Runtime's AWTButtonsView), three 12px grey circles
// where the traffic lights were; under the pointer, close turns red and leaving full screen green,
// with their symbols. Minimizing can't be done in full screen: it stays grey.

/** The buttons; `close` closes the window, `leave` leaves full screen. */
export function FullScreenButtons(props: { close: () => void; leave: () => void }): Node {
  return (
    <div class="cerebro-fullscreen-buttons">
      <button
        type="button"
        class="cerebro-fullscreen-button cerebro-fullscreen-button--close"
        aria-label="Close"
        on:click={() => {
          props.close();
        }}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
        </svg>
      </button>
      <span class="cerebro-fullscreen-button" aria-hidden="true" />
      <button
        type="button"
        class="cerebro-fullscreen-button cerebro-fullscreen-button--leave"
        aria-label="Exit Full Screen"
        on:click={() => {
          props.leave();
        }}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.8 5.2h2.4V2.8zM9.2 6.8H6.8v2.4z" />
        </svg>
      </button>
    </div>
  );
}
