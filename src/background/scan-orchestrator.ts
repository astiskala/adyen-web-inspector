/**
 * Scan orchestrator — drives the full scan pipeline.
 */

import type {
  CapturedRequest,
  Check,
  PageExtractResult,
  ScanPayload,
  ScanResult,
} from '../shared/types.js';
import { STORAGE_SCAN_RESULT_PREFIX } from '../shared/constants.js';
import { calculateHealthScore, extractLocaleFromUrl } from '../shared/utils.js';
import { HeaderCollector } from './header-collector.js';
import { getLatestAdyenWebVersion } from './npm-registry.js';
import { ALL_CHECKS } from './checks/index.js';
import {
  extractVersionFromBundles,
  extractVersionFromRequests,
  extractVersionFromScripts,
  probeMainDocumentHeaders,
} from './payload-builder.js';

const TAB_READY_TIMEOUT_MS = 15_000;
const SPA_SETTLE_MS = 2_000;
const PAGE_EXTRACT_RETRY_INTERVAL_MS = 500;
const PAGE_EXTRACT_RETRY_TIMEOUT_MS = 4_000;

/**
 * Runs the full scan pipeline for a tab and persists the computed result
 * in session storage for popup/devtools retrieval.
 */
export async function runScan(tabId: number): Promise<ScanResult> {
  const collector = new HeaderCollector(tabId);
  collector.start();

  try {
    await waitForTabReady(tabId);
    await new Promise((resolve) => globalThis.setTimeout(resolve, SPA_SETTLE_MS));

    const pageData = await extractPageData(tabId);
    const latestVersion = await getLatestAdyenWebVersion();

    collector.stop();
    const collected = collector.getResult();

    const capturedRequests = mergeCapturedRequests(
      collected.capturedRequests,
      buildFallbackRequests(pageData)
    );

    const mainDocumentHeaders =
      collected.mainDocumentHeaders.length > 0
        ? collected.mainDocumentHeaders
        : await probeMainDocumentHeaders(pageData.pageUrl);

    const scriptUrls = pageData.scripts.map((s) => s.src);
    const bundleVersion = await extractVersionFromBundles(pageData.pageUrl, scriptUrls);

    const detectedVersion =
      pageData.adyenMetadata?.version ??
      collected.analyticsData?.version ??
      extractVersionFromScripts(scriptUrls) ??
      extractVersionFromRequests(capturedRequests) ??
      bundleVersion ??
      null;

    // Enforce locale inference from captured requests if not already present
    const currentLocale = pageData.checkoutConfig?.locale ?? pageData.inferredConfig?.locale ?? '';
    let enrichedInferredConfig = pageData.inferredConfig;

    if (currentLocale === '') {
      for (const req of capturedRequests) {
        const localeFromUrl = extractLocaleFromUrl(req.url);
        if (localeFromUrl !== null) {
          enrichedInferredConfig = {
            ...(enrichedInferredConfig ?? {}),
            locale: localeFromUrl,
          };
          break;
        }
      }
    }

    const payload: ScanPayload = {
      tabId,
      pageUrl: pageData.pageUrl,
      page: {
        ...pageData,
        inferredConfig: enrichedInferredConfig,
      },
      mainDocumentHeaders,
      capturedRequests,
      versionInfo: {
        detected: detectedVersion,
        latest: latestVersion,
      },
      analyticsData: collected.analyticsData,
      scannedAt: new Date().toISOString(),
    };

    const checks = ALL_CHECKS.map((check: Check) => check.run(payload));
    const health = calculateHealthScore(checks);

    const result: ScanResult = {
      tabId,
      pageUrl: payload.pageUrl,
      scannedAt: payload.scannedAt,
      checks,
      health,
      payload,
    };

    await chrome.storage.session.set({
      [`${STORAGE_SCAN_RESULT_PREFIX}${tabId}`]: result,
    });

    return result;
  } finally {
    collector.stop();
  }
}

async function waitForTabReady(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} did not finish loading within ${TAB_READY_TIMEOUT_MS}ms`));
    }, TAB_READY_TIMEOUT_MS);

    const listener = (updatedTabId: number, changeInfo: { status?: string }): void => {
      if (!settled && updatedTabId === tabId && changeInfo.status === 'complete') {
        settled = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function mergeCapturedRequests(
  primary: CapturedRequest[],
  secondary: CapturedRequest[]
): CapturedRequest[] {
  const seen = new Set<string>();
  const merged: CapturedRequest[] = [];

  for (const req of [...primary, ...secondary]) {
    if (!req.url) continue;
    const key = `${req.type}:${req.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(req);
    }
  }

  return merged;
}

function buildFallbackRequests(pageData: PageExtractResult): CapturedRequest[] {
  const requests: CapturedRequest[] = [
    { url: pageData.pageUrl, type: 'main_frame', responseHeaders: [], statusCode: 0 },
  ];

  for (const s of pageData.scripts) {
    requests.push({ url: s.src, type: 'script', responseHeaders: [], statusCode: 0 });
  }

  for (const l of pageData.links) {
    const type = l.rel.toLowerCase().includes('stylesheet') ? 'stylesheet' : 'other';
    requests.push({ url: l.href, type, responseHeaders: [], statusCode: 0 });
  }

  for (const o of pageData.observedRequests ?? []) {
    const type = o.initiatorType === 'script' ? 'script' : 'other';
    requests.push({ url: o.url, type, responseHeaders: [], statusCode: 0 });
  }

  return requests;
}

async function extractPageData(tabId: number): Promise<PageExtractResult> {
  const first = await executeExtract(tabId);
  if (first.checkoutConfig || first.componentConfig) return first;

  const hasSdk =
    first.adyenMetadata !== null ||
    first.scripts.some((s) => /checkoutshopper-|@adyen|adyen/i.test(s.src));
  if (!hasSdk) return first;

  const deadline = Date.now() + PAGE_EXTRACT_RETRY_TIMEOUT_MS;
  let latest = first;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, PAGE_EXTRACT_RETRY_INTERVAL_MS));
    latest = await executeExtract(tabId);
    if (latest.checkoutConfig || latest.componentConfig) return latest;
  }

  return latest;
}

async function executeExtract(tabId: number): Promise<PageExtractResult> {
  let results: chrome.scripting.InjectionResult<PageExtractResult>[];
  try {
    results = await chrome.scripting.executeScript<[], PageExtractResult>({
      target: { tabId },
      files: ['page-extractor.js'],
      world: 'MAIN',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Page extraction script injection failed for tab ${String(tabId)}: ${message}`);
  }

  const frame = results[0];
  if (!frame) {
    throw new Error(
      `Page extraction returned no frames for tab ${String(tabId)}. ` +
        `Results length: ${String(results.length)}`
    );
  }

  if (!frame.result) {
    throw new Error(
      `Page extraction returned no results for tab ${String(tabId)}. ` +
        `Frame documentId: ${String(frame.documentId)}, ` +
        `frameId: ${String(frame.frameId)}`
    );
  }

  return frame.result;
}

/**
 * Returns the last stored scan result for a tab from session storage.
 */
export async function getStoredResult(tabId: number): Promise<ScanResult | null> {
  const key = `${STORAGE_SCAN_RESULT_PREFIX}${tabId}`;
  const result = await chrome.storage.session.get(key);
  return (result[key] as ScanResult | undefined) ?? null;
}
