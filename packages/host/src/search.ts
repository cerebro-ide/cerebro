// Find in Files: ripgrep over a folder, as IntelliJ's options have it (match case, words, regular
// expression). Like IntelliJ, it searches hidden files too, but not what .gitignore leaves out or
// git's own folder. ripgrep comes from @vscode/ripgrep, which ships its binary as a package per
// platform.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { rgPath } from '@vscode/ripgrep';
import { MAX_FILE_SIZE, toSlashes } from './files.js';

export interface TextSearch {
  query: string;
  /** Default: off, as IntelliJ's. */
  matchCase?: boolean;
  /** Only whole words. Default: off. */
  words?: boolean;
  /** The query is a regular expression (ripgrep's syntax). Default: off. */
  regex?: boolean;
  /** The most lines found before the search stops. Default: LIMIT. */
  limit?: number;
}

/** A line with matches. */
export interface TextMatch {
  /** The file's path, the folder's and the file's within it with `/`, as git writes paths. */
  path: string;
  /** Zero-based. */
  line: number;
  /** The line's text, without its line break; long lines are cut. */
  text: string;
  /** Each match, as UTF-16 offsets into the text: from, to. */
  ranges: [number, number][];
}

export interface TextResults {
  matches: TextMatch[];
  /** Whether the search stopped at its limit, with more to find. */
  limited: boolean;
}

/** The most lines a search finds by default: more is of no use in a list. */
export const LIMIT = 1000;

/** Lines longer than this, in bytes, are cut (minified files). */
const MAX_COLUMNS = 1000;

/** A bad query: ripgrep couldn't read the pattern. */
export class BadQuery extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadQuery';
  }
}

interface RgMatch {
  type: string;
  data: {
    path: { text?: string };
    lines: { text?: string };
    line_number: number;
    submatches: { start: number; end: number }[];
  };
}

/** ripgrep's arguments for a search. */
export function rgArguments(search: TextSearch): string[] {
  return [
    '--json',
    '--no-config',
    '--hidden',
    '--glob=!.git',
    `--max-filesize=${String(MAX_FILE_SIZE)}`,
    `--max-columns=${String(MAX_COLUMNS)}`,
    '--max-columns-preview',
    ...(search.regex ? [] : ['--fixed-strings']),
    search.matchCase ? '--case-sensitive' : '--ignore-case',
    ...(search.words ? ['--word-regexp'] : []),
    '--',
    search.query,
  ];
}

/** A byte offset into a line, as a UTF-16 one. */
function utf16(bytes: Buffer, offset: number): number {
  return bytes.subarray(0, offset).toString('utf8').length;
}

/** A match ripgrep printed, as a line with its ranges; undefined for a line that isn't UTF-8. */
export function toMatch(folder: string, data: RgMatch['data']): TextMatch | undefined {
  const { path, lines } = data;
  if (path.text === undefined || lines.text === undefined) return undefined;
  const text = lines.text.replace(/\r?\n$/, '');
  const bytes = Buffer.from(text);
  return {
    path: `${toSlashes(folder).replace(/\/+$/, '')}/${toSlashes(path.text)}`,
    line: data.line_number - 1,
    text,
    ranges: data.submatches
      .filter((s) => s.start <= bytes.length)
      .map((s): [number, number] => [
        utf16(bytes, s.start),
        utf16(bytes, Math.min(s.end, bytes.length)),
      ]),
  };
}

/** Orders lines found by path, then line. */
export function byPlace(a: TextMatch, b: TextMatch): number {
  if (a.path === b.path) return a.line - b.line;
  return a.path < b.path ? -1 : 1;
}

/** Searches the files in `folder` for a text; the lines found, sorted by path and line. */
export function searchText(folder: string, search: TextSearch, rg = rgPath): Promise<TextResults> {
  const limit = search.limit ?? LIMIT;
  return new Promise((resolve, reject) => {
    const child = spawn(rg, rgArguments(search), {
      cwd: folder,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const matches: TextMatch[] = [];
    let limited = false;
    let errors = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errors += chunk;
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (limited) return;
      const message = JSON.parse(line) as RgMatch;
      if (message.type !== 'match') return;
      const match = toMatch(folder, message.data);
      if (!match) return;
      if (matches.length === limit) {
        limited = true;
        child.kill();
        return;
      }
      matches.push(match);
    });
    child.on('error', reject);
    // Done once ripgrep has exited and every line it printed was read, in either order.
    const exited = new Promise<number | null>((done) => {
      child.on('exit', done);
    });
    const read = new Promise<void>((done) => {
      lines.on('close', done);
    });
    void Promise.all([exited, read]).then(([code]) => {
      // 0: found; 1: nothing found; 2: an error, which may come with what was found (an unreadable
      // file among others). Killed at the limit: no code.
      if (code === 2 && matches.length === 0) {
        reject(new BadQuery(errors.trim() || 'The search failed'));
        return;
      }
      matches.sort(byPlace);
      resolve({ matches, limited });
    });
  });
}
