/**
 * Two texts in order, numbers by their value: IntelliJ's `naturalCompare`, as its Problems view
 * and its hierarchies' `FileNameComparator` sort (a claim: the locale's collation, not its code).
 */
export const natural = new Intl.Collator(undefined, { numeric: true }).compare;
