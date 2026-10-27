import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serverFor, servers, typescriptServer } from '../src/index.js';

describe('typescriptServer', () => {
  it('serves TypeScript and JavaScript, by extension', () => {
    const spec = typescriptServer();
    expect(spec.languageOf('/a/b.ts')).toBe('typescript');
    expect(spec.languageOf('/a/B.TSX')).toBe('typescriptreact');
    expect(spec.languageOf('/a/b.mjs')).toBe('javascript');
    expect(spec.languageOf('/a/b.jsx')).toBe('javascriptreact');
    expect(spec.languageOf('/a/b.py')).toBeUndefined();
    expect(spec.languageOf('/a/Makefile')).toBeUndefined();
    // Only in a project: without one, its server sees only the open files.
    expect(spec.projectFiles).toEqual(['tsconfig.json', 'jsconfig.json']);
  });

  it('runs TypeScript 7’s compiler for this platform, installed with it, as a language server', () => {
    const { command, args } = typescriptServer().command();
    expect(existsSync(command)).toBe(true);
    expect(args).toEqual(['--lsp', '--stdio']);
  });

  it('finds the platform’s own package, with .exe on Windows', () => {
    const asked: string[] = [];
    const resolve = (id: string) => {
      asked.push(id);
      return `/m/${id}`;
    };
    expect(typescriptServer('win32', 'arm64', resolve).command().command).toBe(
      join('/m/@typescript/typescript-win32-arm64', 'lib', 'tsc.exe'),
    );
    expect(typescriptServer('darwin', 'x64', resolve).command().command).toBe(
      join('/m/@typescript/typescript-darwin-x64', 'lib', 'tsc'),
    );
    expect(asked).toEqual([
      '@typescript/typescript-win32-arm64/package.json',
      '@typescript/typescript-darwin-x64/package.json',
    ]);
  });
});

describe('serverFor', () => {
  it('finds the server for a file, with its language id, or none', () => {
    expect(serverFor('/a/b.ts')?.spec.id).toBe('typescript');
    expect(serverFor('/a/b.ts')?.languageId).toBe('typescript');
    expect(serverFor('/a/b.txt')).toBeUndefined();
    expect(servers().map((s) => s.id)).toEqual(['typescript']);
  });
});
