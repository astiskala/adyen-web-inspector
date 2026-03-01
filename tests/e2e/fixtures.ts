/**
 * Shared Playwright fixtures for Chrome extension E2E tests.
 * Launches a persistent Chromium context with the built extension loaded.
 */

import { test as base, chromium, type BrowserContext } from '@playwright/test';
import { resolve } from 'node:path';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist');

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  context: async (_fixtures, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-search-engine-choice-screen',
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // Wait for the service worker to register
    let serviceWorker = context.serviceWorkers()[0];
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionIdSegment = serviceWorker.url().split('/')[2];
    if (extensionIdSegment === undefined || extensionIdSegment === '') {
      throw new Error('Failed to resolve extension ID from service worker URL.');
    }
    const extensionId = extensionIdSegment;
    await use(extensionId);
  },
});

export const expect = test.expect;
