// Menu labels: `&` marks the mnemonic letter (`&File`, `Open &Recent`), `&&` is a literal `&`.

export interface Label {
  /** The text to show, without the markers. */
  text: string;
  /** The mnemonic, uppercase, if the label has one. */
  mnemonic: string | undefined;
  /** Where the mnemonic is in `text`, for underlining it; -1 without one. */
  index: number;
}

export function parseLabel(label: string): Label {
  let text = '';
  let mnemonic: string | undefined;
  let index = -1;
  for (let i = 0; i < label.length; i++) {
    const char = label[i] as string;
    if (char !== '&') {
      text += char;
      continue;
    }
    const next = label[i + 1];
    i++;
    if (next === undefined) break;
    if (next !== '&' && mnemonic === undefined) {
      mnemonic = next.toUpperCase();
      index = text.length;
    }
    text += next;
  }
  return { text, mnemonic, index };
}

/** A label's text for display: items that open a dialog end with an ellipsis. */
export function displayText(label: string, dialog = false): string {
  const { text } = parseLabel(label);
  return dialog ? `${text}…` : text;
}
