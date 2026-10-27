import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pythonServer, serverFor, servers, typescriptServer } from '../src/index.js';

describe('typescriptServer', () => {
  it('serves TypeScript and JavaScript, by extension', () => {
    const spec = typescriptServer();
    expect(spec.languageOf('/a/b.ts')).toBe('typescript');
    expect(spec.languageOf('/a/B.TSX')).toBe('typescriptreact');
    expect(spec.languageOf('/a/b.mjs')).toBe('javascript');
    expect(spec.languageOf('/a/b.jsx')).toBe('javascriptreact');
    expect(spec.languageOf('/a/b.py')).toBeUndefined();
    expect(spec.languageOf('/a/Makefile')).toBeUndefined();
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

describe('pythonServer', () => {
  it('serves Python, by extension', () => {
    const spec = pythonServer();
    expect(spec.languageOf('/a/b.py')).toBe('python');
    expect(spec.languageOf('/a/B.PYI')).toBe('python');
    expect(spec.languageOf('/a/b.ts')).toBeUndefined();
    expect(spec.languageOf('/a/py')).toBeUndefined();
  });

  it('runs basedpyright’s language server, installed with it, with the host’s Node', () => {
    const { command, args } = pythonServer().command();
    expect(command).toBe(process.execPath);
    expect(existsSync(args[0] as string)).toBe(true);
    expect(args[1]).toBe('--stdio');
    expect(pythonServer('/node', (id) => `/m/${id}`).command()).toEqual({
      command: '/node',
      args: ['/m/basedpyright/langserver.index.js', '--stdio'],
    });
  });
});

describe('serverFor', () => {
  it('finds the server for a file, with its language id, or none', () => {
    expect(serverFor('/a/b.ts')?.spec.id).toBe('typescript');
    expect(serverFor('/a/b.ts')?.languageId).toBe('typescript');
    expect(serverFor('/a/b.py')?.spec.id).toBe('python');
    expect(serverFor('/a/b.txt')).toBeUndefined();
    expect(servers().map((s) => s.id)).toEqual(['typescript', 'python']);
  });
});
