/**
 * Scan orchestrator — drives the full scan pipeline.
 */

import type {
  CapturedRequest,
  Check,
  CheckoutConfig,
  PageExtractResult,
  ScanPayload,
  ScanResult,
} from '../shared/types.js';
import { STORAGE_SCAN_RESULT_PREFIX } from '../shared/constants.js';
import { calculateHealthScore, extractLocaleFromUrl } from '../shared/utils.js';
import { computeStandardCompliance } from '../shared/standard-compliance.js';
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
      !pageData.isInsideIframe && collected.mainDocumentHeaders.length > 0
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
    const standardCompliance = computeStandardCompliance(payload);

    const result: ScanResult = {
      tabId,
      pageUrl: payload.pageUrl,
      scannedAt: payload.scannedAt,
      checks,
      health,
      standardCompliance,
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
  let serializedResults: chrome.scripting.InjectionResult<string | null>[];
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['page-extractor.js'],
      world: 'MAIN',
    });
    serializedResults = await chrome.scripting.executeScript<[], string | null>({
      target: { tabId, allFrames: true },
      func: () => {
        const extractionGlobal = globalThis as typeof globalThis & {
          __adyenWebInspectorPageExtractResultJson?: string;
        };
        return extractionGlobal.__adyenWebInspectorPageExtractResultJson ?? null;
      },
      world: 'MAIN',
    });
  } catch (err: unknown) {
    let message: string;
    if (err instanceof Error) {
      message = err.message;
    } else {
      const typeStr =
        typeof err === 'object' && err !== null ? Object.prototype.toString.call(err) : typeof err;
      message = `[${typeStr}]`;
    }
    throw new Error(`Page extraction script injection failed for tab ${tabId}: ${message}`);
  }

  const results = serializedResults.map((frame) => {
    const serialized = frame.result;
    if (serialized === undefined || serialized === null) {
      return { ...frame, result: null };
    }
    return {
      ...frame,
      result: JSON.parse(serialized) as PageExtractResult,
    };
  });

  return selectPageExtractResult(results, tabId);
}

function pageExtractScore(result: PageExtractResult): number {
  let score = 0;
  if (result.checkoutConfig !== null) score += 100;
  if (result.componentConfig !== null) score += 90;
  if (result.hasDropinDOM === true) score += 60;
  if (result.adyenMetadata !== null) score += 40;
  if (result.scripts.some((script) => /checkoutshopper-|@adyen|adyen/i.test(script.src))) {
    score += 20;
  }
  if (result.iframes.some((frame) => frame.name?.startsWith('adyen-') === true)) {
    score += 10;
  }
  return score;
}

function mergeFrameConfigs(
  results: readonly PageExtractResult[],
  readConfig: (result: PageExtractResult) => CheckoutConfig | null
): CheckoutConfig | null {
  let merged: CheckoutConfig | null = null;
  for (const result of results) {
    const config = readConfig(result);
    if (config !== null) {
      if (merged === null) {
        merged = config;
        continue;
      }

      const missingEntries = Object.entries(config).filter(
        ([key, value]) => value !== undefined && merged?.[key as keyof CheckoutConfig] === undefined
      );
      merged = {
        ...merged,
        ...Object.fromEntries(missingEntries),
      };
    }
  }
  return merged;
}

/** Selects the frame containing the strongest Adyen checkout signals. */
export function selectPageExtractResult(
  results: readonly chrome.scripting.InjectionResult<PageExtractResult | null>[],
  tabId: number
): PageExtractResult {
  const framesWithResults = results.filter(
    (
      frame
    ): frame is chrome.scripting.InjectionResult<PageExtractResult> & {
      result: PageExtractResult;
    } => frame.result !== undefined && frame.result !== null
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
  const checkoutConfig = mergeFrameConfigs(frameResults, (result) => result.checkoutConfig);
  const inferredConfig = mergeFrameConfigs(frameResults, (result) => result.inferredConfig);
  const componentConfig = mergeFrameConfigs(frameResults, (result) => result.componentConfig);
  const adyenMetadata =
    selected.result.adyenMetadata ??
    frameResults.find((result) => result.adyenMetadata !== null)?.adyenMetadata ??
    null;

  return {
    ...selected.result,
    adyenMetadata,
    checkoutConfig,
    inferredConfig,
    componentConfig,
    ...(frameResults.some((result) => result.hasDropinDOM === true) ? { hasDropinDOM: true } : {}),
    ...(frameResults.some((result) => result.apiKeyDetected === true)
      ? { apiKeyDetected: true }
      : {}),
    isInsideIframe: selected.frameId !== 0,
  };
}

/**
 * Returns the last stored scan result for a tab from session storage.
 */
export async function getStoredResult(tabId: number): Promise<ScanResult | null> {
  const key = `${STORAGE_SCAN_RESULT_PREFIX}${tabId}`;
  const result = await chrome.storage.session.get(key);
  return (result[key] as ScanResult | undefined) ?? null;
}
