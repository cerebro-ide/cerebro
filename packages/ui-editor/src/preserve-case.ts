// Replace's Preserve Case, as IntelliJ's (`PreserveCaseUtil.applyCase`, its default since the
// registry's `ide.find.word.based.preserve.case`): the replacement takes the case of the text it
// replaces, word by word. UPPER_CASE, lower_case and Capitalized words are understood: replacing
// `Project_Lead_Id` with `PROGRAM_LEAD_ID` gives `Program_Lead_Id`.

/** A word: letters and digits, as Java's `Character.isLetterOrDigit`. */
const WORD = /[\p{L}\p{Nd}]+/gu;
/** The replacement's words and what's between them. */
const PARTS = /[\p{L}\p{Nd}]+|[^\p{L}\p{Nd}]+/gu;

const isLetter = (c: string) => /\p{L}/u.test(c);
const isUpper = (c: string) => /\p{Lu}/u.test(c);
const isLower = (c: string) => /\p{Ll}/u.test(c);
const isDigit = (c: string) => /\p{Nd}/u.test(c);

interface WordCase {
  /** No letter that isn't upper case: with `lower`, no letters at all. */
  upper: boolean;
  lower: boolean;
  /** Its first letter is upper case. */
  capitalized: boolean;
}

function analyze(word: string): WordCase {
  let upper = true;
  let lower = true;
  let capitalized = true;
  for (const c of word) {
    if (!isLetter(c)) continue;
    const u = isUpper(c);
    if (upper && lower) capitalized = u;
    upper &&= u;
    lower &&= isLower(c);
  }
  return { upper, lower, capitalized };
}

/** A replacement's word in the case of the found word. */
function buildWord(word: string, found: WordCase): string {
  // The found word has no letters: no case to take.
  if (found.upper && found.lower) return word;
  const replacement = analyze(word);
  if (found.upper) return replacement.upper ? word : word.toUpperCase();
  let result = '';
  let afterWordChar = false;
  for (const c of word) {
    if (isLetter(c)) {
      if (!afterWordChar) {
        result += found.lower || !found.capitalized ? c.toLowerCase() : c.toUpperCase();
        afterWordChar = true;
      } else {
        result += replacement.upper ? c.toLowerCase() : c;
      }
    } else {
      afterWordChar = isDigit(c);
      result += c;
    }
  }
  return result;
}

/** `replacement` in the case of `found`, word by word, the last found word's for any more. */
export function applyCase(found: string, replacement: string): string {
  const words = found.match(WORD);
  if (!words || replacement === '') return replacement;
  let result = '';
  let index = 0;
  for (const [part] of replacement.matchAll(PARTS)) {
    if (!isLetter(part) && !isDigit(part)) {
      result += part;
      continue;
    }
    result += buildWord(part, analyze(words[index] as string));
    if (index < words.length - 1) index++;
  }
  return result;
}
