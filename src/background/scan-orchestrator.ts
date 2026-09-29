/**
 * Scan orchestrator — drives the full scan pipeline through a browser port.
 */

import type { CheckoutPage, ScanResult } from '../shared/types.js';
import { hasCapturedCheckoutConfig } from '../shared/scan-evidence.js';
import { detectSdkPresence, hasAdyenScriptHint } from '../shared/sdk-presence.js';
import { mergeFrames } from './frame-merge.js';
import { assessScan } from './scan-assessment.js';
import type { ScanBrowser } from './scan-browser.js';

const TAB_READY_TIMEOUT_MS = 15_000;
const SPA_SETTLE_MS = 2000;
const PAGE_EXTRACT_RETRY_INTERVAL_MS = 500;
const PAGE_EXTRACT_RETRY_TIMEOUT_MS = 4000;

/**
 * Runs the full scan pipeline for a tab. Whether the result is kept is the
 * tab state's decision, because the page may have navigated meanwhile.
 */
export async function runScan(tabId: number, browser: ScanBrowser): Promise<ScanResult> {
  const capture = browser.captureNetwork(tabId);

  try {
    // Independent of the page, so the npm lookup overlaps tab loading; it resolves null on failure.
    const releasePromise = browser.getReleaseInfo();
    await browser.waitForTabComplete(tabId, TAB_READY_TIMEOUT_MS);
    await browser.sleep(SPA_SETTLE_MS);

    const pageData = await extractPageData(browser, tabId);
    const release = await releasePromise;
    const collected = capture.stop();

    const mainDocumentHeaders =
      !pageData.checkoutInIframe && collected.mainDocumentHeaders.length > 0
        ? collected.mainDocumentHeaders
        : await browser.fetchDocumentHeaders(pageData.pageUrl);

    return await assessScan(
      {
        tabId,
        page: pageData,
        collected,
        mainDocumentHeaders,
        latestVersion: release?.latest ?? null,
        ...(release === null ? {} : { releaseDates: release.releaseDates }),
        scannedAt: new Date(browser.now()).toISOString(),
      },
      (url) => browser.fetchScriptText(url)
    );
  } finally {
    capture.stop();
  }
}

/** Extracts the Checkout page, retrying while the SDK loads until configuration is captured. */
async function extractPageData(browser: ScanBrowser, tabId: number): Promise<CheckoutPage> {
  const first = await extractTab(browser, tabId);
  if (hasCapturedCheckoutConfig(first)) return first;
  if (!detectSdkPresence(first).detected && !hasAdyenScriptHint(first)) return first;

  const deadline = browser.now() + PAGE_EXTRACT_RETRY_TIMEOUT_MS;
  let latest = first;

  while (browser.now() < deadline) {
    await browser.sleep(PAGE_EXTRACT_RETRY_INTERVAL_MS);
    latest = await extractTab(browser, tabId);
    if (hasCapturedCheckoutConfig(latest)) return latest;
  }

  return latest;
}

async function extractTab(browser: ScanBrowser, tabId: number): Promise<CheckoutPage> {
  const frames = await browser.extractFrames(tabId);
  const page = mergeFrames(frames);
  if (page === null) {
    throw new Error(
      `Page extraction returned no frame results for tab ${tabId}. Results length: ${frames.length}`
    );
  }
  return page;
}
