import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions } from 'vite';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['cerebro-source', ...defaultClientConditions] },
  test: {
    name: 'ui-scrollbar',
    include: ['test/**/*.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      // CI uses the runner's own Chrome (CEREBRO_BROWSER_CHANNEL=chrome), with nothing to install;
      // elsewhere, Playwright's Chromium.
      provider: playwright({
        launchOptions: process.env['CEREBRO_BROWSER_CHANNEL']
          ? { channel: process.env['CEREBRO_BROWSER_CHANNEL'] }
          : {},
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1200, height: 800 },
    },
  },
});
