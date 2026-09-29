import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    allowOnly: false,
    include: ['tests/integration/**/*.test.ts'],
  },
});
