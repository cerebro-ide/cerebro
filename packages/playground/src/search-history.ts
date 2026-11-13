// What a search field remembers, for its history popup: the Log's text filter (IntelliJ's
// SearchTextField) and Find in Files' search and replace fields (its FindInProjectSettings), each
// with its own rules. Kept in the browser's storage, one for every repository, as IntelliJ's;
// unreadable or not writable, it's empty, or stays as it was.

export interface SearchHistoryRules {
  /** The most texts kept. */
  limit: number;
  /** Whether the same text in another case is the same (SearchTextField's), and texts trimmed. */
  loose: boolean;
}

export class SearchHistory {
  constructor(
    private readonly key: string,
    private readonly rules: SearchHistoryRules,
  ) {}

  /** The texts, the latest first. */
  texts(): string[] {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(this.key) ?? '[]');
      return Array.isArray(stored) ? stored.filter((text) => typeof text === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * Adds a text, first; one already there moves first (in another case too, when loose: left as it
   * was if first already). None if blank.
   */
  remember(text: string): void {
    const { limit, loose } = this.rules;
    const item = loose ? text.trim() : text;
    const texts = this.texts();
    const same = (other: string) =>
      loose ? other.toLowerCase() === item.toLowerCase() : other === item;
    if (item.trim() === '' || (loose && texts[0] !== undefined && same(texts[0]))) return;
    try {
      localStorage.setItem(
        this.key,
        JSON.stringify([item, ...texts.filter((other) => !same(other))].slice(0, limit)),
      );
    } catch {
      // Not remembered: the history stays as it was.
    }
  }
}
