import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // End-to-end tests run on their own (npm run e2e): they need a built app and a display.
    projects: ['packages/*', '!packages/theme', '!packages/e2e'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      thresholds: { 100: true, perFile: true },
    },
  },
});
