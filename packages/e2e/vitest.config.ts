import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // One app at a time, and launching one takes a few seconds.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
