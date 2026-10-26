// Diagnostic: frames drawn after launch, per 250 ms, over 4 s. Not for merging.

import { it } from 'vitest';
import { launch } from './app.js';

it('measures frames after launch', async () => {
  for (let run = 0; run < 5; run++) {
    const running = await launch();
    const counts = await running.page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const counts: number[] = [];
          let frames = 0;
          const tick = () => {
            frames++;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          const timer = setInterval(() => {
            counts.push(frames);
            frames = 0;
            if (counts.length === 16) {
              clearInterval(timer);
              resolve(counts);
            }
          }, 250);
        }),
    );
    process.stderr.write(
      `FRAMES gpu=${process.env['E2E_DISABLE_GPU'] ? 'off' : 'on'} run=${String(run)} ${counts.join(',')}\n`,
    );
    await running.close();
  }
}, 120_000);
