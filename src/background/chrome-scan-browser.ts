/**
Chrome adapter for the Scan browser port.
*/

import { PAGE_GLOBALS } from '../shared/constants.js';
import type { CapturedHeader, PageExtractResult } from '../shared/types.js';
import { describeError } from '../shared/utilities.js';
import { NetworkRecorder } from './network-recorder.js';
import { getAdyenWebReleaseInfo } from './npm-registry.js';
import type {
  FrameExtraction,
  NetworkCapture,
  ObservedNetwork,
  ScanBrowser,
} from './scan-browser.js';

const HEADER_PROBE_TIMEOUT_MS = 5000;
const SCRIPT_FETCH_TIMEOUT_MS = 2500;

/**
Runs a fetch that is aborted after the timeout; resolves null on any failure.
*/
async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  read: (response: Response) => T | null | Promise<T | null>
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await read(await fetch(url, { ...init, signal: controller.signal }));
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function fetchHeaders(url: string, method: 'HEAD' | 'GET'): Promise<CapturedHeader[]> {
  const headers = await fetchWithTimeout(
    url,
    { method, credentials: 'include', cache: 'no-store', redirect: 'follow' },
    HEADER_PROBE_TIMEOUT_MS,
    (response) =>
      response.headers
        .entries()
        .map(([name, value]) => ({ name, value }))
        .toArray()
  );
  return headers ?? [];
}

/**
Tries `HEAD` first and falls back to `GET` when `HEAD` yields no headers.
*/
async function fetchDocumentHeaders(pageUrl: string): Promise<CapturedHeader[]> {
  const headHeaders = await fetchHeaders(pageUrl, 'HEAD');
  return headHeaders.length > 0 ? headHeaders : fetchHeaders(pageUrl, 'GET');
}

/**
Fetches a script without credentials; null when it fails or times out.
*/
function fetchScriptText(url: string): Promise<string | null> {
  return fetchWithTimeout(url, { credentials: 'omit' }, SCRIPT_FETCH_TIMEOUT_MS, (response) =>
    response.ok ? response.text() : null
  );
}

/**
Waits until the tab finishes loading, or until the timeout passes.
*/
async function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  return new Promise((resolve, reject) => {
    let isSettled = false;
    const timeout = setTimeout(() => {
      isSettled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} did not finish loading within ${timeoutMs}ms`));
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: { status?: string }): void => {
      if (!(!isSettled && updatedTabId === tabId && changeInfo.status === 'complete')) {
        return;
      }

      isSettled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
Injected into each frame, so it must stay self-contained.
*/
function readPageGlobalString(key: string): string | null {
  const value: unknown = Reflect.get(globalThis, key);
  return typeof value === 'string' ? value : null;
}

/**
Runs the page extractor in every frame of the tab and parses each result.
*/
async function extractFrames(tabId: number): Promise<FrameExtraction[]> {
  let serializedResults: chrome.scripting.InjectionResult<string | null>[];
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['page-extractor.js'],
      world: 'MAIN',
    });
    serializedResults = await chrome.scripting.executeScript<[string], string | null>({
      target: { tabId, allFrames: true },
      func: readPageGlobalString,
      args: [PAGE_GLOBALS.pageExtractResultJson],
      world: 'MAIN',
    });
  } catch (error: unknown) {
    throw new Error(
      `Page extraction script injection failed for tab ${tabId}: ${describeError(error)}`,
      { cause: error }
    );
  }

  return serializedResults.map((frame) => ({
    frameId: frame.frameId,
    result:
      frame.result === undefined || frame.result === null
        ? null
        : (JSON.parse(frame.result) as PageExtractResult),
  }));
}

/**
Starts recording the tab's network traffic for a Scan.
*/
function captureNetwork(tabId: number): NetworkCapture {
  const recorder = new NetworkRecorder(tabId);
  recorder.start();
  return {
    stop: (): ObservedNetwork => {
      recorder.stop();
      return recorder.result();
    },
  };
}

/**
Chrome adapter: drives a real tab through chrome.tabs, scripting, webRequest, and fetch.
*/
export const chromeScanBrowser: ScanBrowser = {
  waitForTabComplete,
  extractFrames,
  captureNetwork,
  fetchDocumentHeaders,
  fetchScriptText,
  getReleaseInfo: getAdyenWebReleaseInfo,
  sleep: (ms) =>
    new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    }),
  now: () => Date.now(),
};
