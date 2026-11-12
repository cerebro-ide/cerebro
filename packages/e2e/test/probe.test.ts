// A probe, not a test to keep: measures, from the app's launch on, whether Playwright's "stable"
// check passes (trial clicks), against the page's animation frames, the compositor's frames
// (a screencast) and the window's state. PROBE_THROTTLING=off turns background throttling off.

import { mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron } from 'playwright';
import { it } from 'vitest';
import { APP } from './app.js';

const log = (line: string) => process.stderr.write(`PROBE ${line}\n`);

async function probe(variant: string) {
  const root = await mkdtemp(join(tmpdir(), 'probe-'));
  const repo = join(root, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first'], {
    cwd: repo,
  });
  const t0 = performance.now();
  const at = () => String(Math.round(performance.now() - t0)).padStart(5);
  const app = await _electron.launch({
    args: [APP],
    env: { ...process.env, CEREBRO_USER_DATA: join(root, 'data'), CEREBRO_REPO: repo },
  });
  const page = await app.firstWindow();
  log(`${variant} ${at()} first window`);
  // When the main process shows the window, and what it knows of the GPU then.
  await app.evaluate(({ BrowserWindow, app: electron }) => {
    const g = globalThis as unknown as { shown?: string[] };
    g.shown = [];
    const t = performance.now();
    for (const w of BrowserWindow.getAllWindows()) {
      g.shown.push(`visible at hook ${String(w.isVisible())} ${String(Math.round(t))}`);
      w.once('ready-to-show', () =>
        g.shown?.push(`ready-to-show +${String(Math.round(performance.now() - t))}`),
      );
      w.once('show', () => g.shown?.push(`show +${String(Math.round(performance.now() - t))}`));
      w.webContents.once('did-finish-load', () =>
        g.shown?.push(`did-finish-load +${String(Math.round(performance.now() - t))}`),
      );
    }
    g.shown.push(`gpu ${JSON.stringify(electron.getGPUFeatureStatus())}`);
  });
  const shownLog = () =>
    app.evaluate(() => (globalThis as unknown as { shown?: string[] }).shown?.splice(0) ?? []);
  if (variant === 'throttling-off') {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.setBackgroundThrottling(false);
    });
  }
  let screencast = 0;
  try {
    const cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', (frame: { sessionId: number }) => {
      screencast++;
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => 0);
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 200 });
  } catch (error) {
    log(`${variant} no screencast: ${String(error)}`);
  }
  const install = () =>
    page
      .evaluate(() => {
        const w = window as unknown as { rafs?: number };
        if (w.rafs !== undefined) return;
        w.rafs = 0;
        const tick = () => {
          w.rafs = (w.rafs ?? 0) + 1;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
      .catch(() => undefined);
  await page.waitForSelector('.cerebro-toolbar', { timeout: 30_000 });
  log(`${variant} ${at()} ready`);
  await install();
  let lastRafs = 0;
  let lastCast = 0;
  for (let i = 0; i < 40; i++) {
    for (const line of await shownLog()) log(`${variant} ${at()} main: ${line}`);
    const state = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({
        visible: w.isVisible(),
        focused: w.isFocused(),
        minimized: w.isMinimized(),
        throttling: w.webContents.getBackgroundThrottling(),
        bounds: w.getBounds(),
      })),
    );
    const page_ = await page
      .evaluate(() => ({
        rafs: (window as unknown as { rafs?: number }).rafs ?? -1,
        visibility: document.visibilityState,
        focus: document.hasFocus(),
      }))
      .catch((e: unknown) => ({ rafs: -2, visibility: String(e).slice(0, 40), focus: false }));
    const started = performance.now();
    let trial = 'ok';
    try {
      // Every other round: a popup's row, as the click that hung (run 43126178144).
      if (i % 2 === 1) {
        await page.locator('[aria-label^="Branch:"]').click({ force: true });
        await page
          .locator('.cerebro-popup-item', { hasText: 'New Branch' })
          .click({ trial: true, timeout: 1500 });
      } else {
        await page.locator('[aria-label^="Branch:"]').click({ trial: true, timeout: 1500 });
      }
    } catch (error) {
      trial = `FAILED ${(error as Error).message.split('\n').slice(-2).join(' | ').slice(0, 120)}`;
    }
    const took = Math.round(performance.now() - started);
    if (i % 2 === 1) await page.keyboard.press('Escape');
    log(
      `${variant} ${at()} #${String(i)} trial ${trial} ${String(took)}ms; rafs +${String(page_.rafs - lastRafs)}; ` +
        `screencast +${String(screencast - lastCast)}; page ${page_.visibility} ${page_.focus ? 'focused' : 'unfocused'}; ` +
        `windows ${JSON.stringify(state)}`,
    );
    lastRafs = page_.rafs;
    lastCast = screencast;
    if (i === 20) {
      await page.reload();
      await page.waitForSelector('.cerebro-toolbar');
      await install();
      lastRafs = 0;
      log(`${variant} ${at()} reloaded`);
    }
  }
  await app.close();
}

// Throttling off first: the run's first launch is the one whose window showed late.
it('probe 1, throttling off', { timeout: 120_000 }, () => probe('throttling-off'));
it('probe 2, as it is', { timeout: 120_000 }, () => probe('default'));
