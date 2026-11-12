import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The coverage bar applies to the pure core; adapters are covered by fixtures instead.
      include: ['src/core/**/*.ts'],
      thresholds: { lines: 90 },
    },
  },
});
