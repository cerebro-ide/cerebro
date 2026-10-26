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

const LANGUAGES: Readonly<Record<string, () => Extension>> = {
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  json: () => json(),
  css: () => css(),
  html: () => html(),
  htm: () => html(),
  md: () => markdown(),
  py: () => python(),
  yaml: () => yaml(),
  yml: () => yaml(),
  sh: () => StreamLanguage.define(shell),
  bash: () => StreamLanguage.define(shell),
};

/** The language support for a file, by its extension; undefined for plain text. */
export function languageFor(path: string): Extension | undefined {
  // The file's name: split always gives at least one part.
  const name = path.split(/[\\/]/).at(-1) as string;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return LANGUAGES[name.slice(dot + 1).toLowerCase()]?.();
}
