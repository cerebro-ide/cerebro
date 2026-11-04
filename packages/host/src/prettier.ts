// Prettier, for the Prettier plugin: the project's own package, as IntelliJ's (the closest
// node_modules above the file, or the package the settings name), loaded into the host and run on
// the text as the editor has it. Its options are the file's Prettier configuration, as Prettier
// finds it; a file the closest .prettierignore above it ignores isn't formatted. Refusals are in
// IntelliJ's words (its PrettierBundle) where it has them.

import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PrettierRequest {
  path: string;
  text: string;
  /** Only this part, as offsets into the text. */
  range?: { from: number; to: number };
  /** The package's folder; without it, the closest above the file. */
  package?: string;
}

/** What of Prettier's API is used: the same in Prettier 2 and 3 (2's `format` isn't async). */
interface Prettier {
  format(text: string, options: Record<string, unknown>): string | Promise<string>;
  resolveConfig(path: string): Promise<Record<string, unknown> | null>;
  getFileInfo(
    path: string,
    options: { ignorePath?: string; resolveConfig?: boolean },
  ): Promise<{ ignored: boolean; inferredParser: string | null }>;
}

/** IntelliJ's words for a package that isn't there (`error.package.is.not.installed`). */
export const NOT_INSTALLED = 'Prettier: package is not installed';

/** Loads Prettier from its folder, or the closest above `path`; undefined when there's none. */
async function load(path: string, folder?: string): Promise<Prettier | undefined> {
  let entry: string;
  try {
    entry = createRequire(join(dirname(path), 'noop.js')).resolve(folder ?? 'prettier');
  } catch {
    return undefined;
  }
  const module = (await import(pathToFileURL(entry).href)) as { default?: Prettier } & Prettier;
  return module.default ?? module;
}

/** The closest .prettierignore above a file, as IntelliJ detects it. */
async function ignoreFileFor(path: string): Promise<string | undefined> {
  for (let folder = dirname(path); ; folder = dirname(folder)) {
    const candidate = join(folder, '.prettierignore');
    const found = await access(candidate).then(
      () => true,
      () => false,
    );
    if (found) return candidate;
    if (dirname(folder) === folder) return undefined;
  }
}

/** The text formatted by Prettier, or the part asked for; or why it isn't. */
export async function formatWithPrettier(
  request: PrettierRequest,
): Promise<{ text: string } | { refused: string }> {
  const { path, text, range } = request;
  const prettier = await load(path, request.package);
  if (!prettier) return { refused: NOT_INSTALLED };
  const name = basename(path);
  const ignorePath = await ignoreFileFor(path);
  const info = await prettier.getFileInfo(path, {
    resolveConfig: true,
    ...(ignorePath === undefined ? {} : { ignorePath }),
  });
  if (info.ignored) return { refused: `Prettier: file ${name} was ignored with .prettierignore` };
  if (info.inferredParser === null) return { refused: `File ${name} has unsupported type` };
  const options = (await prettier.resolveConfig(path)) ?? {};
  try {
    return {
      text: await prettier.format(text, {
        ...options,
        filepath: path,
        ...(range ? { rangeStart: range.from, rangeEnd: range.to } : {}),
      }),
    };
  } catch (error) {
    // A syntax error's message starts with what's wrong, then shows the code.
    return { refused: `Prettier: ${(error as Error).message.split('\n')[0] as string}` };
  }
}
