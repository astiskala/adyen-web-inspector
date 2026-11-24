/**
Passive content script — runs on matching pages at document_idle.
Uses lightweight DOM queries and mutation/route listeners; no network calls.
Reports checkout activity (a mounted Drop-in, Component, or Adyen iframe) to
the background service worker. SDK presence is established by a scan.
*/
import { readAdyenEndpoint } from '../shared/adyen-endpoint.js';
import { readCheckoutDom, hasMountedCheckout } from '../shared/checkout-signals.js';
import {
  MSG_CHECKOUT_ACTIVITY_CLEARED,
  MSG_CHECKOUT_ACTIVITY_DETECTED,
  MSG_REPORT_CHECKOUT_ACTIVITY,
  type ContentToBswMessage,
} from '../shared/messages.js';
import { findSdkVersionInUrls } from '../shared/sdk-version.js';

interface CheckoutActivity {
  found: boolean;
  version?: string;
}

const DETECTION_DEBOUNCE_MS = 200;
const detection: {
  pendingTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  lastSentState: string | null;
} = { pendingTimer: undefined, lastSentState: null };

/**
Reads the SDK version from Adyen-hosted script URLs (supplementary data).
*/
function extractVersionFromScripts(): string | undefined {
  const urls = [...document.scripts]
    .map((script) => script.src)
    .filter((source) => readAdyenEndpoint(source) !== null);
  return findSdkVersionInUrls(urls) ?? undefined;
}

/**
Reports mounted checkout as the checkout signals define it; SDK script tags alone do not count.
*/
function detectCheckoutActivity(): CheckoutActivity {
  if (!hasMountedCheckout(readCheckoutDom(document))) return { found: false };
  const version = extractVersionFromScripts();
  return { found: true, ...(version !== undefined && { version }) };
}

function buildStateKey(result: CheckoutActivity): string {
  return `${result.found ? '1' : '0'}:${result.version ?? ''}`;
}

function sendDetectionResult(isForced = false): void {
  const result = detectCheckoutActivity();
  const stateKey = buildStateKey(result);
  if (!isForced && stateKey === detection.lastSentState) {
    return;
  }

  detection.lastSentState = stateKey;

  const message: ContentToBswMessage = result.found
    ? {
        type: MSG_CHECKOUT_ACTIVITY_DETECTED,
        tabId: 0,
        ...(result.version !== undefined && { version: result.version }),
      }
    : { type: MSG_CHECKOUT_ACTIVITY_CLEARED, tabId: 0 };

  void chrome.runtime.sendMessage(message).catch(() => {
    // Background service worker may not be ready yet — safe to ignore
  });
}

function scheduleDetection(delay = DETECTION_DEBOUNCE_MS): void {
  if (detection.pendingTimer !== undefined) {
    globalThis.clearTimeout(detection.pendingTimer);
  }
  detection.pendingTimer = globalThis.setTimeout(() => {
    detection.pendingTimer = undefined;
    sendDetectionResult();
  }, delay);
}

const INTERESTING_TAG_NAMES: ReadonlySet<string> = new Set(['script', 'iframe', 'link']);
const INTERESTING_DESCENDANTS = '[class*="adyen"], iframe';

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

  const source = element.getAttribute('src') ?? '';
  const href = element.getAttribute('href') ?? '';
  // Frameworks can render checkout off-DOM and append it inside a plain wrapper.
  return (
    source.includes('adyen') ||
    href.includes('adyen') ||
    element.querySelector(INTERESTING_DESCENDANTS) !== null
  );
}

/**
The observer watches child lists only, so every record lists added and removed nodes.
*/
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

/**
The tab state resets on every navigation, including same-document ones that
keep this detector, then asks it to report again once the tab has loaded.
*/
function handleReportRequest(message: unknown): void {
  if ((message as { type?: unknown } | null)?.type === MSG_REPORT_CHECKOUT_ACTIVITY) {
    sendDetectionResult(true);
  }
}

function initPassiveDetection(): void {
  sendDetectionResult(true);
  chrome.runtime.onMessage.addListener(handleReportRequest);

  const observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // The detector runs in an isolated world, where replacing history.pushState
  // would not see the page's calls; the tab state asks for a report after
  // same-document navigations instead.
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
