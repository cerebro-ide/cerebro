// Dates as IntelliJ shows them.

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * A commit's date as IntelliJ shows it (`DateFormatUtil.formatPrettyDateTime`: the Log's, File
 * Revisions'): today's and yesterday's by name, with the time.
 */
export function formatCommitDate(time: number, now = Date.now()): string {
  const date = new Date(time);
  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const today = new Date(now);
  if (sameDay(date, today)) return `Today ${clock}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday ${clock}`;
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
