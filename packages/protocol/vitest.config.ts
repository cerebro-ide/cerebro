import { defineProject } from 'vitest/config';

export default defineProject({
  ssr: { resolve: { conditions: ['cerebro-source'] } },
  resolve: { conditions: ['cerebro-source'] },
  test: {
    name: 'protocol',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
