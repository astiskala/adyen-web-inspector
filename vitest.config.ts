import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    allowOnly: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'src/background/checks/**/*.ts',
        'src/background/header-collector.ts',
        'src/background/npm-registry.ts',
        'src/background/payload-builder.ts',
        'src/background/scan-assessment.ts',
        'src/background/scan-orchestrator.ts',
        'src/content/config-interceptor.ts',
        'src/shared/**/*.ts',
        'src/popup/**/*.{ts,tsx}',
        'src/devtools/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/shared/types.ts',
        'src/popup/Popup.tsx',
        'src/devtools/devtools.ts',
        'src/devtools/panel/panelEntry.tsx',
      ],
      thresholds: {
        'src/background/checks/**': {
          lines: 98,
          functions: 100,
          branches: 95,
          statements: 98,
        },
        'src/shared/**': {
          lines: 95,
          functions: 95,
          branches: 88,
          statements: 95,
        },
        'src/shared/{checkout-config-schema,scan-evidence,sdk-presence}.ts': {
          lines: 98,
          functions: 100,
          branches: 98,
          statements: 98,
        },
        'src/background/scan-{assessment,orchestrator}.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/background/{header-collector,npm-registry}.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/background/payload-builder.ts': {
          lines: 98,
          functions: 100,
          branches: 95,
          statements: 98,
        },
        'src/content/config-interceptor.ts': {
          lines: 85,
          functions: 95,
          branches: 68,
          statements: 85,
        },
        'src/popup/**': {
          lines: 85,
          functions: 75,
          branches: 70,
          statements: 80,
        },
        'src/devtools/**': {
          lines: 65,
          functions: 85,
          branches: 55,
          statements: 65,
        },
      },
    },
  },
});
