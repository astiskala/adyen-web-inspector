/**
 * Chrome adapter for the Scan browser port.
 */

import { STORAGE_SCAN_RESULT_PREFIX } from '../shared/constants.js';
import type { PageExtractResult, ScanResult } from '../shared/types.js';
import { HeaderCollector } from './header-collector.js';
import { getAdyenWebReleaseInfo } from './npm-registry.js';
import { extractVersionFromBundles, probeMainDocumentHeaders } from './payload-builder.js';
import type {
  CollectedNetwork,
  FrameExtraction,
  NetworkCapture,
  ScanBrowser,
} from './scan-browser.js';

async function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} did not finish loading within ${timeoutMs}ms`));
    }, timeoutMs);

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

async function extractFrames(tabId: number): Promise<FrameExtraction[]> {
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
  } catch (error: unknown) {
    let message: string;
    if (error instanceof Error) {
      message = error.message;
    } else {
      const typeStr =
        typeof error === 'object' && error !== null
          ? Object.prototype.toString.call(error)
          : typeof error;
      message = `[${typeStr}]`;
    }
    throw new Error(`Page extraction script injection failed for tab ${tabId}: ${message}`);
  }

  return serializedResults.map((frame) => ({
    frameId: frame.frameId,
    result:
      frame.result === undefined || frame.result === null
        ? null
        : (JSON.parse(frame.result) as PageExtractResult),
  }));
}

function captureNetwork(tabId: number): NetworkCapture {
  const collector = new HeaderCollector(tabId);
  collector.start();
  return {
    stop: (): CollectedNetwork => {
      collector.stop();
      return collector.getResult();
    },
  };
}

function storageKey(tabId: number): string {
  return `${STORAGE_SCAN_RESULT_PREFIX}${tabId}`;
}

/** Chrome adapter: drives a real tab through chrome.tabs, scripting, webRequest, and storage. */
export const chromeScanBrowser: ScanBrowser = {
  waitForTabComplete,
  extractFrames,
  captureNetwork,
  fetchDocumentHeaders: probeMainDocumentHeaders,
  probeBundleVersion: extractVersionFromBundles,
  getReleaseInfo: getAdyenWebReleaseInfo,
  storeResult: (result) => chrome.storage.session.set({ [storageKey(result.tabId)]: result }),
  sleep: (ms) =>
    new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    }),
  now: () => Date.now(),
};

/**
 * Returns the last stored scan result for a tab from session storage.
 */
export async function getStoredResult(tabId: number): Promise<ScanResult | null> {
  const key = storageKey(tabId);
  const result = await chrome.storage.session.get(key);
  return (result[key] as ScanResult | undefined) ?? null;
}
