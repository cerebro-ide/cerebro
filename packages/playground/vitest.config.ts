import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions } from 'vite';
import { defineProject } from 'vitest/config';

type PlaywrightContext = { page: import('playwright').Page };

export default defineProject({
  resolve: { conditions: ['cerebro-source', ...defaultClientConditions] },
  oxc: { jsx: { runtime: 'automatic', importSource: '@cerebro-ide/jsx' } },
  test: {
    name: 'playground',
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
      commands: {
        /** The system's appearance, as the page sees it (`prefers-color-scheme`). */
        colorScheme: async (context, scheme: 'dark' | 'light') => {
          await (context as unknown as PlaywrightContext).page.emulateMedia({
            colorScheme: scheme,
          });
        },
      },
      viewport: { width: 1200, height: 800 },
    },
  },
});
