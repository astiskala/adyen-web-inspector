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
        'src/background/captured-traffic.ts',
        'src/background/checks/**/*.ts',
        'src/background/chrome-scan-browser.ts',
        'src/background/chrome-tab-state-browser.ts',
        'src/background/frame-merge.ts',
        'src/background/network-recorder.ts',
        'src/background/npm-registry.ts',
        'src/background/scan-assessment.ts',
        'src/background/scan-orchestrator.ts',
        'src/background/tab-state.ts',
        'src/content/config-interceptor.ts',
        'src/content/page-extractor.ts',
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
        'src/shared/{adyen-endpoint,checkout-capture,checkout-config-schema,checkout-signals,scan-evidence,sdk-presence,sdk-version}.ts':
          {
            lines: 98,
            functions: 100,
            branches: 98,
            statements: 98,
          },
        'src/background/{captured-traffic,frame-merge,scan-assessment,scan-orchestrator,tab-state}.ts':
          {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
        'src/background/{network-recorder,npm-registry}.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/background/chrome-{scan,tab-state}-browser.ts': {
          lines: 100,
          functions: 100,
          branches: 95,
          statements: 98,
        },
        'src/content/page-extractor.ts': {
          lines: 99,
          functions: 100,
          branches: 95,
          statements: 98,
        },
        'src/content/config-interceptor.ts': {
          lines: 94,
          functions: 95,
          branches: 80,
          statements: 94,
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
