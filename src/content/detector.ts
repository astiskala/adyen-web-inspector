/**
 * Passive content script — runs on matching pages at document_idle.
 * Uses lightweight DOM queries and mutation/route listeners; no network calls.
 * Reports checkout activity (a mounted Drop-in, Component, or Adyen iframe) to
 * the background service worker. SDK presence is established by a scan.
 */
import {
  MSG_CHECKOUT_ACTIVITY_CLEARED,
  MSG_CHECKOUT_ACTIVITY_DETECTED,
  type ContentToBswMessage,
} from '../shared/messages.js';

interface CheckoutActivity {
  found: boolean;
  version?: string;
}

const DETECTION_DEBOUNCE_MS = 200;
let pendingTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let lastSentState: string | null = null;

/** Try to extract the SDK version from a CDN <script> tag (supplementary data). */
function extractVersionFromScripts(): string | undefined {
  // Modern CDN pattern: checkoutshopper-sdk/X.Y.Z
  const cdnScript = document.querySelector<HTMLScriptElement>('script[src*="checkoutshopper-sdk"]');
  if (cdnScript) {
    const match = /checkoutshopper-sdk[./](\d+\.\d+\.\d+)/.exec(cdnScript.src);
    const version = match?.[1];
    if (version !== undefined && version !== '') return version;
  }

  // Legacy CDN pattern (v5 and earlier): /checkoutshopper/sdk/X.Y.Z/
  const legacyScript = document.querySelector<HTMLScriptElement>(
    'script[src*="/checkoutshopper/sdk/"]'
  );
  if (legacyScript) {
    const match = /\/sdk\/(\d+\.\d+\.\d+)\//.exec(legacyScript.src);
    const version = match?.[1];
    if (version !== undefined && version !== '') return version;
  }

  return undefined;
}

function detectCheckoutActivity(): CheckoutActivity {
  // Only report "found" when a Drop-in or Component is actually mounted on the page.
  // SDK script tags alone (including datacollection.js / risk module) do NOT count.

  // Check for Adyen Drop-in / Component DOM mount points
  const dropinContainer = document.querySelector(
    '.adyen-checkout__dropin, .adyen-checkout, [class*="adyen-checkout"]'
  );
  if (dropinContainer) {
    const version = extractVersionFromScripts();
    return { found: true, ...(version === undefined ? {} : { version }) };
  }

  // Check for Adyen checkout iframe (card component, 3DS)
  const adyenIframe = document.querySelector<HTMLIFrameElement>(
    'iframe[name^="adyen-"], iframe[title*="Adyen"], iframe[src*="adyenpayments.com"]'
  );
  if (adyenIframe) {
    const version = extractVersionFromScripts();
    return { found: true, ...(version === undefined ? {} : { version }) };
  }

  return { found: false };
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
        ...(result.version === undefined || result.version === ''
          ? {}
          : { version: result.version }),
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

function isInterestingNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'script' || tagName === 'iframe' || tagName === 'link') {
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

function handleMutations(records: MutationRecord[]): void {
  for (const record of records) {
    if (record.type !== 'childList') {
      continue;
    }

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
