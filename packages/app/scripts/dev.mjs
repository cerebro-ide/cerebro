// Runs the desktop app in development: builds the main process, starts Vite on the playground, and
// opens Electron on it. Closing the app stops Vite; stopping the script closes the app.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const app = fileURLToPath(new URL('..', import.meta.url));
const playground = fileURLToPath(new URL('../../playground', import.meta.url));

const build = spawnSync('npx', ['tsc', '-b', 'tsconfig.build.json'], {
  cwd: app,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);
const native = spawnSync(process.execPath, ['scripts/native.mjs'], { cwd: app, stdio: 'inherit' });
if (native.status !== 0) process.exit(native.status ?? 1);

const server = await createServer({ root: playground, configFile: `${playground}/vite.config.ts` });
await server.listen();
const url = server.resolvedUrls?.local[0];
console.log(`UI on ${url}`);

const electron = spawn(require('electron'), [app], {
  stdio: 'inherit',
  env: { ...process.env, CEREBRO_DEV_URL: url },
});
// Stopping the script stops the app too.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => electron.kill(signal));
electron.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
