/**
 * Passive content script — runs on matching pages at document_idle.
 * Uses lightweight DOM queries and mutation/route listeners; no network calls.
 * Reports checkout activity (a mounted Drop-in, Component, or Adyen iframe) to
 * the background service worker. SDK presence is established by a scan.
 */
import { readAdyenEndpoint } from '../shared/adyen-endpoint.js';
import { readCheckoutDom, showsMountedCheckout } from '../shared/checkout-signals.js';
import {
  MSG_CHECKOUT_ACTIVITY_CLEARED,
  MSG_CHECKOUT_ACTIVITY_DETECTED,
  type ContentToBswMessage,
} from '../shared/messages.js';
import { findSdkVersionInUrls } from '../shared/sdk-version.js';

interface CheckoutActivity {
  found: boolean;
  version?: string;
}

const DETECTION_DEBOUNCE_MS = 200;
let pendingTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let lastSentState: string | null = null;

/** Reads the SDK version from Adyen-hosted script URLs (supplementary data). */
function extractVersionFromScripts(): string | undefined {
  const urls = [...document.scripts]
    .map((script) => script.src)
    .filter((src) => readAdyenEndpoint(src) !== null);
  return findSdkVersionInUrls(urls) ?? undefined;
}

/** Reports mounted checkout as the checkout signals define it; SDK script tags alone do not count. */
function detectCheckoutActivity(): CheckoutActivity {
  if (!showsMountedCheckout(readCheckoutDom(document))) return { found: false };
  const version = extractVersionFromScripts();
  return { found: true, ...(version === undefined ? {} : { version }) };
}

function buildStateKey(result: CheckoutActivity): string {
  return `${result.found ? '1' : '0'}:${result.version ?? ''}`;
}

function sendDetectionResult(force = false): void {
  const result = detectCheckoutActivity();
  const stateKey = buildStateKey(result);
  if (!force && stateKey === lastSentState) {
    return;
  }

  lastSentState = stateKey;

  const message: ContentToBswMessage = result.found
    ? {
        type: MSG_CHECKOUT_ACTIVITY_DETECTED,
        tabId: 0,
        ...(result.version === undefined ? {} : { version: result.version }),
      }
    : { type: MSG_CHECKOUT_ACTIVITY_CLEARED, tabId: 0 };

  chrome.runtime.sendMessage(message).catch(() => {
    // Background service worker may not be ready yet — safe to ignore
  });
}

function scheduleDetection(delay = DETECTION_DEBOUNCE_MS): void {
  if (pendingTimer !== undefined) {
    globalThis.clearTimeout(pendingTimer);
  }
  pendingTimer = globalThis.setTimeout(() => {
    pendingTimer = undefined;
    sendDetectionResult();
  }, delay);
}

const INTERESTING_TAG_NAMES: ReadonlySet<string> = new Set(['script', 'iframe', 'link']);

function isInterestingNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const element = node as Element;
  if (INTERESTING_TAG_NAMES.has(element.tagName.toLowerCase())) {
    return true;
  }

  const className = element.getAttribute('class') ?? '';
  if (className.includes('adyen')) {
    return true;
  }

  const src = element.getAttribute('src') ?? '';
  const href = element.getAttribute('href') ?? '';
  return src.includes('adyen') || href.includes('adyen');
}

/** The observer watches child lists only, so every record lists added and removed nodes. */
function handleMutations(records: MutationRecord[]): void {
  for (const record of records) {
    for (const added of record.addedNodes) {
      if (isInterestingNode(added)) {
        scheduleDetection();
        return;
      }
    }

    for (const removed of record.removedNodes) {
      if (isInterestingNode(removed)) {
        scheduleDetection();
        return;
      }
    }
  }
}

function installSpaRouteHooks(): void {
  const historyApi = globalThis.history;
  const originalPushState: History['pushState'] = historyApi.pushState.bind(historyApi);
  const originalReplaceState: History['replaceState'] = historyApi.replaceState.bind(historyApi);

  historyApi.pushState = (...args: Parameters<History['pushState']>): void => {
    originalPushState(...args);
    scheduleDetection(0);
  };

  historyApi.replaceState = (...args: Parameters<History['replaceState']>): void => {
    originalReplaceState(...args);
    scheduleDetection(0);
  };
}

function initPassiveDetection(): void {
  sendDetectionResult(true);

  const observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  installSpaRouteHooks();
  globalThis.addEventListener('hashchange', () => {
    scheduleDetection(0);
  });
  globalThis.addEventListener('popstate', () => {
    scheduleDetection(0);
  });

  // Re-check shortly after page load to catch async checkout mount.
  const delayedChecks = [400, 1200, 3000, 6000];
  for (const delay of delayedChecks) {
    globalThis.setTimeout(() => {
      sendDetectionResult();
    }, delay);
  }
}

initPassiveDetection();
