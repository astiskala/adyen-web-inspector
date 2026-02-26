import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const EXTENSION_PATH = resolve(import.meta.dirname, 'dist');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env['CI'] === undefined ? 0 : 2,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    // Chromium only — extensions not supported in other browsers
    headless: false,
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
    command: 'npx serve tests/fixtures -p 4321 --no-clipboard',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
    timeout: 15_000,
  },
});

export { EXTENSION_PATH };
