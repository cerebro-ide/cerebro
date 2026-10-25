import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs, so the built page also loads from files in the desktop app.
  base: './',
  resolve: { conditions: ['cerebro-source', ...defaultClientConditions] },
  oxc: { jsx: { runtime: 'automatic', importSource: '@cerebro-ide/jsx' } },
});
