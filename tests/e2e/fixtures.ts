/**
 * Shared Playwright fixtures for Chrome extension E2E tests.
 * Launches a persistent Chromium context with the built extension loaded.
 */

import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { resolve } from 'node:path';
import {
  DEVTOOLS_PANEL_PAGE,
  STORAGE_NPM_CACHE_KEY,
  STORAGE_SCAN_RESULT_PREFIX,
} from '../../src/shared/constants';
import type { CheckId, CheckResult, ScanResult } from '../../src/shared/types';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist');
const FIXTURE_ORIGIN = 'http://localhost:4321/';
const STUBBED_EXTERNAL_URL =
  /^https:\/\/(?:checkout-live\.adyen\.com|checkout-test\.adyen\.com|checkoutanalytics-test\.adyen\.com|checkoutshopper-test\.adyen\.com|checkoutshopper-test\.cdn\.adyen\.com|checkoutshopper-live-eu\.cdn\.adyen\.com|www\.googletagmanager\.com|script\.hotjar\.com|connect\.facebook\.net)\//;

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
}

interface FixtureTab {
  readonly id: number;
  readonly windowId: number;
}

async function routeFixtureNetwork(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\//, (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' && url.port === '4321') {
      return route.continue();
    }
    return route.abort();
  });
  await context.route(STUBBED_EXTERNAL_URL, async (route) => {
    const resourceType = route.request().resourceType();
    let contentType = 'application/json';
    if (resourceType === 'script') contentType = 'text/javascript';
    if (resourceType === 'stylesheet') contentType = 'text/css';
    // Client-side API calls are only made by the client-key-rejected scenario.
    const rejectsClientKey =
      new URL(route.request().url()).hostname === 'checkoutshopper-test.adyen.com';
    await route.fulfill({
      status: rejectsClientKey ? 401 : 200,
      contentType,
      headers: { 'access-control-allow-origin': '*' },
      body: resourceType === 'fetch' ? '{}' : '',
    });
  });
}

async function seedNpmCache(worker: Worker): Promise<void> {
  await worker.evaluate(async (cacheKey) => {
    const daysAgo = (days: number): string =>
      new Date(Date.now() - days * 86_400_000).toISOString();
    await chrome.storage.local.set({
      [cacheKey]: {
        version: '6.40.0',
        releaseDates: { '6.10.0': daysAgo(600), '6.31.0': daysAgo(60), '6.40.0': daysAgo(1) },
        fetchedAt: Date.now(),
      },
    });
  }, STORAGE_NPM_CACHE_KEY);
}

async function getServiceWorker(context: BrowserContext, extensionId: string): Promise<Worker> {
  const isExtensionWorker = (worker: Worker): boolean =>
    worker.url().startsWith(`chrome-extension://${extensionId}/`);
  return (
    context.serviceWorkers().find(isExtensionWorker) ??
    context.waitForEvent('serviceworker', isExtensionWorker)
  );
}

async function getFixtureTab(worker: Worker, page: Page): Promise<FixtureTab> {
  const tab = await worker.evaluate(async (pageUrl) => {
    const match = (await chrome.tabs.query({})).find((candidate) => candidate.url === pageUrl);
    return match?.id === undefined ? null : { id: match.id, windowId: match.windowId };
  }, page.url());
  if (tab === null) throw new Error(`Fixture tab not found: ${page.url()}`);
  return tab;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ headless }, use) => {
    const context = await chromium.launchPersistentContext('', {
      // Playwright's default headless shell cannot load extensions; the full Chromium build can.
      channel: 'chromium',
      headless,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-search-engine-choice-screen',
      ],
    });
    await routeFixtureNetwork(context);
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let serviceWorker = context.serviceWorkers()[0];
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionIdSegment = serviceWorker.url().split('/')[2];
    if (extensionIdSegment === undefined || extensionIdSegment === '') {
      throw new Error('Failed to resolve extension ID from service worker URL.');
    }
    // Scans read this cache instead of the npm registry, keeping version checks offline and deterministic.
    await seedNpmCache(serviceWorker);
    await use(extensionIdSegment);
  },
});

export const expect = test.expect;

export const requireCheck = (result: ScanResult, id: CheckId): CheckResult => {
  const found = result.checks.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Missing check ${id}`);
  return found;
};

export const openFixture = async (context: BrowserContext, fixturePath: string): Promise<Page> => {
  const page = await context.newPage();
  const url = new URL(fixturePath, FIXTURE_ORIGIN);
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
  return page;
};

export const getBadgeText = async (
  context: BrowserContext,
  extensionId: string,
  page: Page
): Promise<string> => {
  const worker = await getServiceWorker(context, extensionId);
  const { id } = await getFixtureTab(worker, page);
  return worker.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), id);
};

export const getStoredScanResult = async (
  context: BrowserContext,
  extensionId: string,
  page: Page
): Promise<ScanResult | null> => {
  const worker = await getServiceWorker(context, extensionId);
  const { id } = await getFixtureTab(worker, page);
  return worker.evaluate(async (key) => {
    const stored = await chrome.storage.session.get(key);
    return (stored[key] as ScanResult | undefined) ?? null;
  }, `${STORAGE_SCAN_RESULT_PREFIX}${id}`);
};

/**
 * Opens the popup as a background tab beside the fixture page. The popup inspects the active tab
 * of its own window, so opening it in the foreground would make it inspect itself.
 */
export const openPopupFor = async (
  context: BrowserContext,
  extensionId: string,
  page: Page
): Promise<Page> => {
  const worker = await getServiceWorker(context, extensionId);
  const tab = await getFixtureTab(worker, page);
  const popupUrl = `chrome-extension://${extensionId}/popup/index.html`;
  const popupOpened = context.waitForEvent('page');
  await worker.evaluate(
    async ({ url, target }) => {
      await chrome.tabs.update(target.id, { active: true });
      await chrome.tabs.create({ url, windowId: target.windowId, active: false });
    },
    { url: popupUrl, target: tab }
  );
  const popup = await popupOpened;
  await popup.waitForURL(popupUrl);
  return popup;
};

/**
 * Loads the built DevTools panel in a tab. Only the inspected tab ID is stubbed, because Chrome
 * provides `chrome.devtools` solely inside DevTools, which Playwright cannot open.
 */
export const openDevtoolsPanelFor = async (
  context: BrowserContext,
  extensionId: string,
  page: Page
): Promise<Page> => {
  const worker = await getServiceWorker(context, extensionId);
  const { id } = await getFixtureTab(worker, page);
  const panel = await context.newPage();
  await panel.addInitScript((tabId) => {
    Object.assign(chrome, { devtools: { inspectedWindow: { tabId } } });
  }, id);
  await panel.goto(`chrome-extension://${extensionId}/${DEVTOOLS_PANEL_PAGE}`);
  return panel;
};

export const scanFixture = async (
  context: BrowserContext,
  extensionId: string,
  fixturePath: string,
  duringScan?: (page: Page) => Promise<void>
): Promise<ScanResult> => {
  const page = await openFixture(context, fixturePath);
  const popup = await openPopupFor(context, extensionId, page);
  try {
    const worker = await getServiceWorker(context, extensionId);
    const { id: tabId } = await getFixtureTab(worker, page);
    const scanPromise = popup.evaluate(
      (targetTabId) =>
        new Promise<ScanResult>((resolve, reject) => {
          const listener = (message: {
            type: string;
            tabId?: number;
            result?: ScanResult;
            error?: string;
          }): void => {
            if (message.tabId !== targetTabId) return;
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
            .sendMessage({ type: 'SCAN_REQUEST', tabId: targetTabId, source: 'popup' })
            .catch((error: unknown) => {
              chrome.runtime.onMessage.removeListener(listener);
              reject(error);
            });
        }),
      tabId
    );
    if (duringScan !== undefined) {
      await expect
        .poll(() => getBadgeText(context, extensionId, page), { timeout: 5_000 })
        .toBe('…');
      await duringScan(page);
    }
    return await scanPromise;
  } finally {
    await popup.close();
    await page.close();
  }
};
