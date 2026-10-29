// The language for a file, by its extension: the target languages of the first version (TypeScript
// and JavaScript, HTML, CSS, JSON, Markdown, Bash, Python, YAML).

import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import type { Extension } from '@codemirror/state';

/** Each extension's language: its name, as IntelliJ's file types (a claim: not all measured), and its support. */
const LANGUAGES: Readonly<Record<string, { name: string; support: () => Extension }>> = {
  ts: { name: 'TypeScript', support: () => javascript({ typescript: true }) },
  mts: { name: 'TypeScript', support: () => javascript({ typescript: true }) },
  cts: { name: 'TypeScript', support: () => javascript({ typescript: true }) },
  tsx: { name: 'TypeScript JSX', support: () => javascript({ typescript: true, jsx: true }) },
  js: { name: 'JavaScript', support: () => javascript() },
  mjs: { name: 'JavaScript', support: () => javascript() },
  cjs: { name: 'JavaScript', support: () => javascript() },
  jsx: { name: 'JavaScript', support: () => javascript({ jsx: true }) },
  json: { name: 'JSON', support: () => json() },
  css: { name: 'CSS', support: () => css() },
  html: { name: 'HTML', support: () => html() },
  htm: { name: 'HTML', support: () => html() },
  md: { name: 'Markdown', support: () => markdown() },
  py: { name: 'Python', support: () => python() },
  yaml: { name: 'YAML', support: () => yaml() },
  yml: { name: 'YAML', support: () => yaml() },
  sh: { name: 'Shell Script', support: () => StreamLanguage.define(shell) },
  bash: { name: 'Shell Script', support: () => StreamLanguage.define(shell) },
};

/** A file's language, by its extension; undefined for plain text. */
function languageOf(path: string) {
  // The file's name: split always gives at least one part.
  const name = path.split(/[\\/]/).at(-1) as string;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return LANGUAGES[name.slice(dot + 1).toLowerCase()];
}

/** The language support for a file, by its extension; undefined for plain text. */
export function languageFor(path: string): Extension | undefined {
  return languageOf(path)?.support();
}

/** A file's language's name, as the status bar shows it: Plain Text for one without. */
export function languageName(path: string): string {
  return languageOf(path)?.name ?? 'Plain Text';
}
