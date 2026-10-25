import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions } from 'vite';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['cerebro-source', ...defaultClientConditions] },
  oxc: { jsx: { runtime: 'automatic', importSource: '@cerebro-ide/jsx' } },
  test: {
    name: 'jsx',
    include: ['test/**/*.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
