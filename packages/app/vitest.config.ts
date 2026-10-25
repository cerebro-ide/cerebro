import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'app',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
