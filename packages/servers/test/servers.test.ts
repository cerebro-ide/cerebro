import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashServer,
  pythonServer,
  serverFor,
  servers,
  typescriptServer,
  withoutWindowsFolders,
} from '../src/index.js';

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

describe('pythonServer', () => {
  it('serves Python, by extension', () => {
    const spec = pythonServer();
    expect(spec.languageOf('/a/b.py')).toBe('python');
    expect(spec.languageOf('/a/B.PYI')).toBe('python');
    expect(spec.languageOf('/a/b.ts')).toBeUndefined();
    expect(spec.languageOf('/a/py')).toBeUndefined();
    // Asked once it's found the folder's files, as it logs.
    expect(spec.readyWhen?.test('Found 2 source files')).toBe(true);
    expect(spec.readyWhen?.test('No source files found.')).toBe(true);
    expect(spec.readyWhen?.test('Starting service instance')).toBe(false);
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

describe('bashServer', () => {
  it('serves shell scripts, by extension', () => {
    const spec = bashServer();
    expect(spec.languageOf('/a/b.sh')).toBe('shellscript');
    expect(spec.languageOf('/a/B.BASH')).toBe('shellscript');
    expect(spec.languageOf('/a/b.zsh')).toBeUndefined();
    // Asked once it's read the folder's scripts, however that ends.
    for (const line of [
      '08:14:05.771 INFO BackgroundAnalysis: Completed after 12 ms.',
      'BackgroundAnalysis: skipping as backgroundAnalysisMaxFiles was 0...',
      'BackgroundAnalysis: stopped after 30000ms; workspace symbols may be incomplete.',
      'BackgroundAnalysis: failed resolving glob "**/*"',
    ]) {
      expect(spec.readyWhen?.test(line)).toBe(true);
    }
    expect(spec.readyWhen?.test('BackgroundAnalysis: resolving glob')).toBe(false);
  });

  it('runs bash-language-server, installed with it, with the host’s Node and a quick PATH', () => {
    const { command, args } = bashServer().command();
    expect(command).toBe(process.execPath);
    expect(existsSync(args[0] as string)).toBe(true);
    expect(bashServer('/node', (id) => `/m/${id}`, '/usr/bin').command()).toEqual({
      command: '/node',
      args: ['/m/bash-language-server/out/cli.js', 'start'],
      env: { PATH: '/usr/bin' },
    });
  });

  it('starts with an empty PATH when the host has none', () => {
    vi.stubEnv('PATH', undefined);
    expect(bashServer().command().env).toEqual({ PATH: '' });
    vi.unstubAllEnvs();
  });

  it('leaves WSL’s Windows folders out of the PATH, on Linux only', () => {
    const path = '/usr/bin:/mnt/c/Windows:/home/a/bin:/mnt/d/tools/bin:/mnt/data';
    expect(withoutWindowsFolders(path, 'linux')).toBe('/usr/bin:/home/a/bin:/mnt/data');
    expect(withoutWindowsFolders(path, 'darwin')).toBe(path);
  });
});

describe('servers', () => {
  it('runs every server, or only those named, or none', () => {
    expect(servers().map((s) => s.id)).toEqual(['typescript', 'python', 'bash']);
    expect(servers('python').map((s) => s.id)).toEqual(['python']);
    expect(servers(' python , typescript').map((s) => s.id)).toEqual(['typescript', 'python']);
    expect(servers('')).toEqual([]);
  });
});

describe('serverFor', () => {
  it('finds the server for a file, with its language id, or none', () => {
    expect(serverFor('/a/b.ts')?.spec.id).toBe('typescript');
    expect(serverFor('/a/b.ts')?.languageId).toBe('typescript');
    expect(serverFor('/a/b.py')?.spec.id).toBe('python');
    expect(serverFor('/a/b.txt')).toBeUndefined();
    expect(servers().map((s) => s.id)).toEqual(['typescript', 'python', 'bash']);
  });
});
