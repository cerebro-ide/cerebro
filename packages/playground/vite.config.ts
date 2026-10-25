import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  resolve: { conditions: ['cerebro-source', ...defaultClientConditions] },
  oxc: { jsx: { runtime: 'automatic', importSource: '@cerebro-ide/jsx' } },
});
