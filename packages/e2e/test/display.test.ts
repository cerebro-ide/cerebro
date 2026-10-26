// The display scale: the system's by default, the user's choice after a restart. In its own file,
// since a chosen scale stays for the rest of the app's run.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;

beforeAll(async () => {
  running = await launch();
});

afterAll(async () => {
  await running.close();
});

const scale = () => running.page.evaluate(() => devicePixelRatio);

/** Windows' scale when running under WSL, read as the app reads it; else undefined. */
function windowsScale(): number | undefined {
  if (!/microsoft/i.test(readFileSync('/proc/version', 'utf8'))) return undefined;
  const output = execFileSync(
    'reg.exe',
    ['query', 'HKCU\\Control Panel\\Desktop\\WindowMetrics', '/v', 'AppliedDPI'],
    { encoding: 'utf8' },
  );
  return parseInt(/0x([0-9a-f]+)/i.exec(output)?.[1] ?? '60', 16) / 96;
}

it('follows the system by default: Windows’ scale under WSL, else Electron’s', async () => {
  const expected =
    (process.platform === 'linux' ? windowsScale() : undefined) ??
    (await running.app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor));
  expect(await scale()).toBe(expected);
});

it('takes the scale chosen in the settings when the app restarts', async () => {
  const page = running.page;
  await page.keyboard.press('ControlOrMeta+Alt+S');
  await page.locator('[data-page="appearance"]').click();
  await page.locator('[data-setting="appearance.displayScale"] select').selectOption('1.25');
  await page.locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
  const before = await scale();
  await running.restart();
  const diag = await running.app.evaluate(({ app, screen }) => ({
    switch: app.commandLine.hasSwitch('force-device-scale-factor'),
    value: app.commandLine.getSwitchValue('force-device-scale-factor'),
    screen: screen.getPrimaryDisplay().scaleFactor,
    data: app.getPath('userData'),
  }));
  let saved = 'unreadable';
  try {
    saved = readFileSync(`${diag.data}/display.json`, 'utf8');
  } catch {
    // reported as unreadable
  }
  process.stderr.write(`DIAGSCALE ${JSON.stringify({ ...diag, saved, dpr: await scale() })}\n`);
  expect(await scale()).toBe(1.25);
  // Back to the default, which takes effect on the next restart.
  await running.page.keyboard.press('ControlOrMeta+Alt+S');
  await running.page.locator('[data-page="appearance"]').click();
  await running.page
    .locator('[data-setting="appearance.displayScale"] select')
    .selectOption('auto');
  await running.page.locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
  await running.restart();
  expect(await scale()).toBe(before);
});
