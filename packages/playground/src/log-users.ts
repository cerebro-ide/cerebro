// The User filter's names, as IntelliJ reads them (VcsUserUtil, VcsLogUserResolverBase,
// UserFilterPopupComponent): a name stands for every author whose name, or whose email before the
// @, is the same in its standard form (a first and last name in lower case, else the name in lower
// case); "me" for the user git commits as. The authors are listed by their short names.

/** A commit's author, or the user git commits as: the host's `git.authors`. */
export interface Author {
  name: string;
  email: string;
}

/** The value that stands for the user git commits as, IntelliJ's VcsLogFilterObject.ME. */
export const ME = '*';

/** How "me" shows. */
export const ME_LABEL = 'me';

/** Java's `\w` and `\p{Punct}`, ASCII alone, as IntelliJ's NAME_PATTERN reads them. */
const NAME = /^(\w+)[!-/:-@[-`{-~\s](\w+)$/;

const PRINTABLE = /^[ -~]*$/;

/** In lower case, if it's printable ASCII; else as it is. */
const lower = (name: string) => (PRINTABLE.test(name) ? name.toLowerCase() : name);

/** A first or last name, which is ASCII (NAME's `\w`), with its first letter in upper case. */
const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** A name's first and last parts, if it's two words. */
const firstAndLast = (name: string) => NAME.exec(name)?.slice(1, 3) as [string, string] | undefined;

/** The name as names are compared: its first and last parts in lower case, else it in lower case. */
export function standardForm(name: string): string {
  const parts = firstAndLast(name);
  return parts ? `${parts[0].toLowerCase()} ${parts[1].toLowerCase()}` : lower(name);
}

/** An email's part before the @, if there's one before it. */
export function nameFromEmail(email: string): string | undefined {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : undefined;
}

/** An author as git's `--author` is given it: `Name <email>`, or the one that's there. */
export function exactly(author: Author): string {
  if (author.name === '') return author.email;
  if (author.email === '') return author.name;
  return `${author.name} <${author.email}>`;
}

/** The authors a name stands for: by their names, or their emails before the @. */
function byName(name: string, authors: readonly Author[]): Author[] {
  const wanted = standardForm(name);
  return authors.filter((author) => {
    const fromEmail = nameFromEmail(author.email);
    return (
      (author.name !== '' && standardForm(author.name) === wanted) ||
      (fromEmail !== undefined && standardForm(fromEmail) === wanted)
    );
  });
}

/** The authors "me" stands for: by the name, and by the email's name with the same emails. */
function byMe(me: Author, authors: readonly Author[]): Author[] {
  const named = byName(me.name, authors);
  const fromEmail = nameFromEmail(me.email);
  if (fromEmail === undefined) return named;
  const emails = new Set(named.map((author) => author.email.toLowerCase()));
  return [
    ...named,
    ...byName(fromEmail, authors).filter((author) => emails.has(author.email.toLowerCase())),
  ];
}

/** The authors, exactly, that the User filter's values stand for; none for "me" if it's unknown. */
export function resolveUsers(
  values: readonly string[],
  authors: readonly Author[],
  me: Author | undefined,
): string[] {
  const found = values.flatMap((value) => {
    if (value !== ME) return byName(value, authors);
    return me ? byMe(me, authors) : [];
  });
  return [...new Set(found.map(exactly))];
}

/** The authors as the User filter lists them: by short name, a first and last name capitalized. */
export function userNames(authors: readonly Author[]): string[] {
  const names = authors.map(({ name, email }) => {
    const short = name !== '' ? name : (nameFromEmail(email) ?? email);
    const parts = firstAndLast(short);
    return parts ? `${capitalized(parts[0])} ${capitalized(parts[1])}` : short;
  });
  return [...new Set(names)].sort();
}

/** Values as they show: "me" for ME. */
export const shown = (values: readonly string[]): string[] =>
  values.map((value) => (value === ME ? ME_LABEL : value));

/** Values as shown, read back: ME for "me". */
export const read = (values: readonly string[]): string[] =>
  values.map((value) => (value === ME_LABEL ? ME : value));

/** IntelliJ's FILTER_VALUE length: past it, a filter's text ends in an ellipsis. */
const LIMIT = 20;

/** A filter's values as its button shows them: one, or all between bars, cut short past `limit`. */
export function displayable(values: readonly string[], limit = LIMIT): string {
  const text = values.join('|');
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
