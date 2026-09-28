import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Safe because every test launches its own browser context and the fixture server is stateless.
  fullyParallel: true,
  timeout: 30_000,
  retries: process.env['CI'] === undefined ? 0 : 2,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    // Headless by default; pass --headed to watch the browser. Chromium only, since other
    // browsers cannot load the extension.
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
        // launchPersistentContext used in tests directly for extension loading
      },
    },
  ],
  webServer: {
    command: 'node tests/e2e/fixture-server.mjs',
    url: 'http://localhost:4321',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
