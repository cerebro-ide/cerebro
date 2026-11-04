import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatWithPrettier, NOT_INSTALLED } from '../src/prettier.js';

/** A project with this repo's Prettier in its node_modules, as `npm install prettier` puts it. */
const project = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-prettier-')));
const prettier = dirname(createRequire(import.meta.url).resolve('prettier/package.json'));
mkdirSync(join(project, 'node_modules'));
symlinkSync(prettier, join(project, 'node_modules', 'prettier'), 'junction');
writeFileSync(join(project, '.prettierrc'), '{ "semi": false, "singleQuote": true }');
mkdirSync(join(project, 'src', 'generated'), { recursive: true });
writeFileSync(join(project, 'src', '.prettierignore'), 'generated\n');
/** Another project, with no Prettier. */
const bare = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-no-prettier-')));

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
});

describe('Prettier', () => {
  it('formats a file with the project’s package and its configuration', async () => {
    const path = join(project, 'src', 'a.ts');
    expect(await formatWithPrettier({ path, text: 'const  a = "x";\n' })).toEqual({
      text: "const a = 'x'\n",
    });
  });

  it('formats only the part asked for', async () => {
    const path = join(project, 'src', 'a.ts');
    const text = 'const  a = "x";\nconst  b = "y";\n';
    expect(await formatWithPrettier({ path, text, range: { from: 16, to: 31 } })).toEqual({
      text: 'const  a = "x";\nconst b = \'y\'\n',
    });
  });

  it('says why it doesn’t: no package, ignored, a type it can’t, or a syntax error', async () => {
    expect(await formatWithPrettier({ path: join(bare, 'a.ts'), text: 'x' })).toEqual({
      refused: NOT_INSTALLED,
    });
    expect(
      await formatWithPrettier({ path: join(project, 'src', 'generated', 'b.ts'), text: 'x' }),
    ).toEqual({ refused: 'Prettier: file b.ts was ignored with .prettierignore' });
    expect(await formatWithPrettier({ path: join(project, 'a.unknown'), text: 'x' })).toEqual({
      refused: 'File a.unknown has unsupported type',
    });
    const broken = await formatWithPrettier({ path: join(project, 'a.ts'), text: 'const = ;' });
    expect(broken).toEqual({ refused: expect.stringMatching(/^Prettier: .+\(1:7\)$/) as string });
  });

  it('uses the package the settings name, wherever the file is', async () => {
    // An ES module's package, with no default export: as a package may be written.
    const own = join(bare, 'own-prettier');
    mkdirSync(own);
    writeFileSync(join(own, 'package.json'), '{ "main": "index.mjs" }');
    writeFileSync(
      join(own, 'index.mjs'),
      [
        'export const format = (text) => text.toUpperCase();',
        'export const resolveConfig = () => Promise.resolve(null);',
        "export const getFileInfo = () => Promise.resolve({ ignored: false, inferredParser: 'x' });",
      ].join('\n'),
    );
    expect(await formatWithPrettier({ path: join(bare, 'a.ts'), text: 'x', package: own })).toEqual(
      { text: 'X' },
    );
  });
});
