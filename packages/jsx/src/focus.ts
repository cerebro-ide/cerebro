// What has the focus, for giving it back when a popup, menu or dialog closes. Inside a shadow root
// (an editor's content: CodeMirror lives in one), `document.activeElement` is the root's host, and
// focusing the host gives the content nothing (measured: closing a popup over an editor left the
// focus on the body).

/** The focused element, inside shadow roots too; at least the body, with nothing focused. */
export function focusedElement(): HTMLElement {
  // Null at times, though a document's body is said to have the focus then.
  let active = (document.activeElement ?? document.body) as HTMLElement;
  while (active.shadowRoot?.activeElement) active = active.shadowRoot.activeElement as HTMLElement;
  return active;
}
