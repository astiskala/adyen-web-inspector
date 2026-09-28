/**
 * Scan orchestrator — drives the full scan pipeline through a browser port.
 */

import type { PageExtractResult, ScanResult } from '../shared/types.js';
import { mergeFrameCheckoutConfig } from '../shared/scan-evidence.js';
import { detectSdkPresence, hasAdyenScriptHint } from '../shared/sdk-presence.js';
import { extractHostname, isAdyenHost } from '../shared/utils.js';
import { assessScan } from './scan-assessment.js';
import type { FrameExtraction, ScanBrowser } from './scan-browser.js';

const TAB_READY_TIMEOUT_MS = 15_000;
const SPA_SETTLE_MS = 2000;
const PAGE_EXTRACT_RETRY_INTERVAL_MS = 500;
const PAGE_EXTRACT_RETRY_TIMEOUT_MS = 4000;

/**
 * Runs the full scan pipeline for a tab and persists the computed result
 * for popup/devtools retrieval.
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
      !pageData.isInsideIframe && collected.mainDocumentHeaders.length > 0
        ? collected.mainDocumentHeaders
        : await browser.fetchDocumentHeaders(pageData.pageUrl);

    const result = await assessScan(
      {
        tabId,
        page: pageData,
        collected,
        mainDocumentHeaders,
        latestVersion: release?.latest ?? null,
        ...(release === null ? {} : { releaseDates: release.releaseDates }),
        scannedAt: new Date(browser.now()).toISOString(),
      },
      (pageUrl, scriptUrls) => browser.probeBundleVersion(pageUrl, scriptUrls)
    );

    await browser.storeResult(result);
    return result;
  } finally {
    capture.stop();
  }
}

function hasCapturedConfig(page: PageExtractResult): boolean {
  return page.checkoutConfig !== null || page.componentConfig !== null;
}

async function extractPageData(browser: ScanBrowser, tabId: number): Promise<PageExtractResult> {
  const first = await extractTab(browser, tabId);
  if (hasCapturedConfig(first)) return first;
  if (!detectSdkPresence(first).detected && !hasAdyenScriptHint(first)) return first;

  const deadline = browser.now() + PAGE_EXTRACT_RETRY_TIMEOUT_MS;
  let latest = first;

  while (browser.now() < deadline) {
    await browser.sleep(PAGE_EXTRACT_RETRY_INTERVAL_MS);
    latest = await extractTab(browser, tabId);
    if (hasCapturedConfig(latest)) return latest;
  }

  return latest;
}

async function extractTab(browser: ScanBrowser, tabId: number): Promise<PageExtractResult> {
  return selectPageExtractResult(await browser.extractFrames(tabId), tabId);
}

function pageExtractScore(result: PageExtractResult): number {
  let score = 0;
  if (result.checkoutConfig !== null) score += 100;
  if (result.componentConfig !== null) score += 90;
  if (result.hasDropinDOM === true) score += 60;
  if (result.adyenMetadata !== null) score += 40;
  if (hasAdyenScriptHint(result)) score += 20;
  if (result.iframes.some((frame) => frame.name?.startsWith('adyen-') === true)) {
    score += 10;
  }
  return score;
}

type ExtractedFrame = FrameExtraction & { readonly result: PageExtractResult };

/** Selects the strongest frame and merges observed configs/metadata across accessible frames. */
function selectPageExtractResult(
  results: readonly FrameExtraction[],
  tabId: number
): PageExtractResult {
  const framesWithResults = results.filter(
    (frame): frame is ExtractedFrame => frame.result !== null
  );

  const [firstFrame, ...remainingFrames] = framesWithResults;
  if (firstFrame === undefined) {
    throw new Error(
      `Page extraction returned no frame results for tab ${tabId}. ` +
        `Results length: ${results.length}`
    );
  }

  let selected = firstFrame;
  for (const frame of remainingFrames) {
    const selectedScore = pageExtractScore(selected.result);
    const frameScore = pageExtractScore(frame.result);
    if (frameScore > selectedScore || (frameScore === selectedScore && frame.frameId === 0)) {
      selected = frame;
    }
  }

  const frameResults = framesWithResults.map((frame) => frame.result);
  const adyenMetadata =
    selected.result.adyenMetadata ??
    frameResults.find((result) => result.adyenMetadata !== null)?.adyenMetadata ??
    null;
  const merchantFrames = framesWithResults.filter((frame) => {
    const host = extractHostname(frame.result.pageUrl);
    return host === null || !isAdyenHost(host);
  });
  const checkoutInChildFrame = merchantFrames.some(
    (frame) =>
      frame.frameId !== 0 &&
      (frame.result.checkoutConfigComplete === true ||
        frame.result.hasDropinDOM === true ||
        frame.result.hasCardDOM === true ||
        (frame.result.componentMountCount ?? 0) > 0)
  );

  return {
    ...selected.result,
    adyenMetadata,
    ...mergeFrameCheckoutConfig(frameResults),
    ...(merchantFrames.some((frame) => frame.result.hasDropinDOM === true)
      ? { hasDropinDOM: true }
      : {}),
    ...(merchantFrames.some((frame) => frame.result.hasCardDOM === true)
      ? { hasCardDOM: true }
      : {}),
    ...(merchantFrames.some((frame) => frame.result.hasNewCardFormDOM === true)
      ? { hasNewCardFormDOM: true }
      : {}),
    ...(merchantFrames.some((frame) => frame.result.hasCardHolderNameDOM === true)
      ? { hasCardHolderNameDOM: true }
      : {}),
    ...(frameResults.some((result) => result.apiKeyDetected === true)
      ? { apiKeyDetected: true }
      : {}),
    isInsideIframe:
      (selected.frameId !== 0 && merchantFrames.includes(selected)) || checkoutInChildFrame,
  };
}
