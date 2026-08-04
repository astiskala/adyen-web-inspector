import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    allowOnly: false,
    include: ['tests/integration/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '~shared': resolve(root, 'src/shared'),
    },
  },
});
