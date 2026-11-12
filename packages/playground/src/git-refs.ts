// Git's refs as IntelliJ lists them: a branch's name, and its order for names.

/** A branch's name as IntelliJ's lists show it: `main`, `origin/main`; none for `origin/HEAD`. */
export const branchName = (ref: string): string | undefined =>
  ref.startsWith('refs/heads/')
    ? ref.slice('refs/heads/'.length)
    : ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')
      ? ref.slice('refs/remotes/'.length)
      : undefined;

/** IntelliJ's order for branch names (`NaturalComparator`). */
export const natural = new Intl.Collator(undefined, { numeric: true }).compare;
