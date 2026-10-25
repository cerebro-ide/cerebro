import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', '!packages/playground', '!packages/theme'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['packages/playground/**'],
      thresholds: { 100: true, perFile: true },
    },
  },
});
