import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BlobIndex,
  definitions,
  indexWorktree,
  languageOf,
  symbols,
  usages,
  type Git,
} from '../src/index.js';

let index: BlobIndex;

beforeAll(async () => {
  index = await BlobIndex.create();
});

const git: Git = (cwd, args) =>
  Promise.resolve(execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: 'pipe' }));

describe('languageOf', () => {
  it('knows TypeScript and JavaScript files, by extension', () => {
    expect(languageOf('a.ts')).toBe('typescript');
    expect(languageOf('a.MTS')).toBe('typescript');
    expect(languageOf('a.tsx')).toBe('tsx');
    expect(languageOf('a.jsx')).toBe('javascript');
    expect(languageOf('a.md')).toBeUndefined();
  });
});

describe('BlobIndex', () => {
  it('finds definitions of each kind, with their positions', () => {
    const blob = index.parse(
      [
        'export class Shape {',
        '  size = 1;',
        '  area(): number { return this.size; }',
        '}',
        'interface Options { a: string }',
        'type Id = string;',
        'enum Mode { On, Off }',
        'export const LIMIT = 3;',
        'function draw(shape: Shape) { return shape.area(); }',
      ].join('\n'),
      'typescript',
    );
    expect(
      blob.definitions.map((d) => `${d.kind} ${d.name} ${String(d.line)}:${String(d.column)}`),
    ).toEqual(
      expect.arrayContaining([
        'class Shape 0:13',
        'field size 1:2',
        'method area 2:2',
        'interface Options 4:10',
        'type Id 5:5',
        'enum Mode 6:5',
        'constant LIMIT 7:13',
        'function draw 8:9',
      ]),
    );
    // Every place a name appears, definitions included.
    expect(blob.identifiers.get('Shape')).toEqual([0, 13, 8, 21]);
    expect(blob.identifiers.get('area')).toEqual([2, 2, 8, 43]);
  });

  it('parses TSX and JavaScript', () => {
    expect(
      index
        .parse('export function App() { return <div />; }', 'tsx')
        .definitions.map((d) => d.name),
    ).toEqual(['App']);
    expect(
      index.parse('class Old { run() {} }', 'javascript').definitions.map((d) => d.name),
    ).toEqual(expect.arrayContaining(['Old', 'run']));
  });

  it('parses each blob once', () => {
    let reads = 0;
    const source = () => {
      reads++;
      return 'function once() {}';
    };
    expect(index.add('blob-once', source, 'typescript')).toBe(true);
    expect(index.add('blob-once', source, 'typescript')).toBe(false);
    expect(reads).toBe(1);
  });
});

describe('a worktree', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-index-')));
  const repo = join(root, 'repo');
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });

  beforeAll(() => {
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'shape.ts'), 'export class Shape { area() { return 1; } }\n');
    writeFileSync(
      join(repo, 'src', 'draw.ts'),
      "import { Shape } from './shape';\nnew Shape().area();\n",
    );
    writeFileSync(join(repo, 'src', 'gone.ts'), 'export const Gone = 1;\n');
    writeFileSync(join(repo, 'README.md'), '# not source\n');
    run(repo, 'add', '.');
    run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
    run(repo, 'worktree', 'add', '-q', '-b', 'other', join(root, 'other'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('indexes its source files, and another worktree reuses identical contents', async () => {
    const first = await indexWorktree(index, repo, git);
    expect([...first.files.keys()].sort()).toEqual(['src/draw.ts', 'src/gone.ts', 'src/shape.ts']);
    expect(first.parsed).toBe(3);
    const second = await indexWorktree(index, join(root, 'other'), git);
    expect(second.parsed).toBe(0);
    expect(second.files).toEqual(first.files);
  });

  it('follows the working tree: changed, new and deleted files', async () => {
    writeFileSync(
      join(repo, 'src', 'shape.ts'),
      'export class Shape { perimeter() { return 4; } }\n',
    );
    writeFileSync(join(repo, 'src', 'new.ts'), 'export function fresh() {}\n');
    unlinkSync(join(repo, 'src', 'gone.ts'));
    const after = await indexWorktree(index, repo, git);
    expect([...after.files.keys()].sort()).toEqual(['src/draw.ts', 'src/new.ts', 'src/shape.ts']);
    expect(after.parsed).toBe(2);
    expect(definitions(index, after.files, 'perimeter')).toHaveLength(1);
    expect(definitions(index, after.files, 'area')).toEqual([]);
    expect(definitions(index, after.files, 'fresh')[0]).toMatchObject({ path: 'src/new.ts' });
  });

  it('answers symbols, definitions and usages by name', async () => {
    const { files } = await indexWorktree(index, join(root, 'other'), git);
    expect(symbols(index, files, 'ap').map((s) => s.name)).toEqual(['Shape']);
    expect(symbols(index, files, 'SHAPE')[0]).toMatchObject({
      name: 'Shape',
      kind: 'class',
      path: 'src/shape.ts',
      line: 0,
      column: 13,
    });
    expect(symbols(index, files, '  ')).toEqual([]);
    expect(definitions(index, files, 'Shape').map((d) => d.path)).toEqual(['src/shape.ts']);
    expect(usages(index, files, 'Shape')).toEqual([
      { path: 'src/draw.ts', line: 0, column: 9 },
      { path: 'src/draw.ts', line: 1, column: 4 },
      { path: 'src/shape.ts', line: 0, column: 13 },
    ]);
    expect(usages(index, files, 'nothing')).toEqual([]);
  });
});

describe('symbols ranking', () => {
  it('puts exact names first, then prefixes, then shorter names, at most the limit', () => {
    const files = new Map([
      ['b.ts', 'rank-b'],
      ['a.ts', 'rank-a'],
    ]);
    index.add(
      'rank-a',
      () => 'class Mode {}\nclass ModeSwitch {}\nclass DarkMode {}',
      'typescript',
    );
    index.add('rank-b', () => 'class Mode {}', 'typescript');
    expect(symbols(index, files, 'mode').map((s) => `${s.name}@${s.path}`)).toEqual([
      'Mode@a.ts',
      'Mode@b.ts',
      'ModeSwitch@a.ts',
      'DarkMode@a.ts',
    ]);
    expect(symbols(index, files, 'mode', 1)).toHaveLength(1);
    // The same name twice in one file: by line.
    index.add(
      'rank-c',
      () => 'function twice(): void;\nfunction twice(x?: number) {}',
      'typescript',
    );
    expect(symbols(index, new Map([['c.ts', 'rank-c']]), 'twice').map((s) => s.line)).toEqual([
      0, 1,
    ]);
    // A blob missing from the index has nothing.
    expect(symbols(index, new Map([['x.ts', 'unknown']]), 'mode')).toEqual([]);
  });
});
