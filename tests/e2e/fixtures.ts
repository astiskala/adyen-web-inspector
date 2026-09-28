/**
 * Shared Playwright fixtures for Chrome extension E2E tests.
 * Launches a persistent Chromium context with the built extension loaded.
 */

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { STORAGE_NPM_CACHE_KEY } from '../../src/shared/constants';
import type { ScanResult } from '../../src/shared/types';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist');

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
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

export const scanFixture = async (
  context: BrowserContext,
  extensionId: string,
  fixturePath: string,
  duringScan?: (page: Page) => Promise<void>
): Promise<ScanResult> => {
  await context.route(/^https?:\/\//, (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' && url.port === '4321') {
      return route.continue();
    }
    return route.abort();
  });
  await context.route(
    /^https:\/\/(?:checkout-live\.adyen\.com|checkout-test\.adyen\.com|checkoutanalytics-test\.adyen\.com|checkoutshopper-test\.cdn\.adyen\.com|checkoutshopper-live-eu\.cdn\.adyen\.com|www\.googletagmanager\.com|script\.hotjar\.com|connect\.facebook\.net)\//,
    async (route) => {
      const resourceType = route.request().resourceType();
      let contentType = 'application/json';
      if (resourceType === 'script') contentType = 'text/javascript';
      if (resourceType === 'stylesheet') contentType = 'text/css';
      await route.fulfill({
        contentType,
        headers: { 'access-control-allow-origin': '*' },
        body: resourceType === 'fetch' ? '{}' : '',
      });
    }
  );
  const page = await context.newPage();
  const extensionPage = await context.newPage();
  try {
    const url = new URL(fixturePath, 'http://localhost:4321/');
    await page.goto(url.href);
    if (url.pathname.endsWith('/dummy-merchant.html')) {
      await page.locator('html[data-fixture-ready="true"]').waitFor({ timeout: 5_000 });
    }
    if (url.pathname.endsWith('/dummy-iframe-merchant.html')) {
      await page
        .frameLocator('iframe[title="Merchant checkout"]')
        .locator('html[data-fixture-ready="true"]')
        .waitFor({ timeout: 5_000 });
    }
    await extensionPage.goto(`chrome-extension://${extensionId}/popup/index.html`);
    const scanPromise = extensionPage.evaluate(
      async ({ pageUrl, cacheKey }) => {
        await chrome.storage.local.set({
          [cacheKey]: { version: '6.40.0', fetchedAt: Date.now() },
        });
        const tabId = (await chrome.tabs.query({})).find((tab) => tab.url === pageUrl)?.id;
        if (tabId === undefined) throw new Error(`Fixture tab not found: ${pageUrl}`);

        return new Promise<ScanResult>((resolve, reject) => {
          const listener = (message: {
            type: string;
            tabId?: number;
            result?: ScanResult;
            error?: string;
          }): void => {
            if (message.tabId !== tabId) return;
            if (message.type === 'SCAN_COMPLETE' && message.result !== undefined) {
              chrome.runtime.onMessage.removeListener(listener);
              resolve(message.result);
            } else if (message.type === 'SCAN_ERROR') {
              chrome.runtime.onMessage.removeListener(listener);
              reject(new Error(message.error ?? 'Scan failed.'));
            }
          };
          chrome.runtime.onMessage.addListener(listener);
          chrome.runtime
            .sendMessage({ type: 'SCAN_REQUEST', tabId, source: 'popup' })
            .catch((error: unknown) => {
              chrome.runtime.onMessage.removeListener(listener);
              reject(error);
            });
        });
      },
      { pageUrl: page.url(), cacheKey: STORAGE_NPM_CACHE_KEY }
    );
    if (duringScan !== undefined) {
      const tabId = await extensionPage.evaluate(
        async (pageUrl) => (await chrome.tabs.query({})).find((tab) => tab.url === pageUrl)?.id,
        page.url()
      );
      if (tabId === undefined) throw new Error('Fixture tab not found.');
      await expect
        .poll(
          () =>
            extensionPage.evaluate(
              (targetTabId) => chrome.action.getBadgeText({ tabId: targetTabId }),
              tabId
            ),
          { timeout: 5_000 }
        )
        .toBe('…');
      await duringScan(page);
    }
    return await scanPromise;
  } finally {
    await extensionPage.close();
    await page.close();
  }
};
