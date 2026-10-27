// Builds the app's native module on macOS (native/fullscreen.m, see src/fullscreen.ts) into
// dist/fullscreen.node, for Apple silicon and Intel both. Elsewhere there's nothing to build.
//
// Node-API is the same in Node and in Electron, so it's built against the running Node's headers,
// and the functions it calls are found in the process that loads it (-undefined dynamic_lookup),
// as node-gyp builds modules for macOS. No node-gyp: one file needs one clang.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const app = fileURLToPath(new URL('..', import.meta.url));
const headers = join(dirname(process.execPath), '..', 'include', 'node');
if (!existsSync(join(headers, 'node_api.h'))) {
  console.error(`Node's headers aren't in ${headers}: install Node from nodejs.org or with nvm.`);
  process.exit(1);
}
mkdirSync(join(app, 'dist'), { recursive: true });
const clang = spawnSync(
  'clang',
  [
    ['-x', 'objective-c', '-fobjc-arc', '-O2', '-Wall', '-Werror'],
    ['-bundle', '-undefined', 'dynamic_lookup'],
    ['-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=12.0'],
    ['-I', headers, '-framework', 'AppKit'],
    ['-o', join(app, 'dist', 'fullscreen.node'), join(app, 'native', 'fullscreen.m')],
  ].flat(),
  { stdio: 'inherit' },
);
process.exit(clang.status ?? 1);
