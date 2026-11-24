/**
Background Service Worker — extension entry point.
Routes runtime messages and tab events to the tab state, which owns the
badge, stored state, and Scan lifecycle for each tab.
*/

import {
  MSG_CHECKOUT_ACTIVITY_CLEARED,
  MSG_CHECKOUT_ACTIVITY_DETECTED,
  MSG_GET_TAB_STATE,
  MSG_SCAN_REQUEST,
  type ExtensionMessage,
} from '../shared/messages.js';
import { chromeScanBrowser } from './chrome-scan-browser.js';
import { chromeTabStateBrowser } from './chrome-tab-state-browser.js';
import { runScan } from './scan-orchestrator.js';
import { createTabState } from './tab-state.js';

const tabState = createTabState(chromeTabStateBrowser, (tabId) =>
  runScan(tabId, chromeScanBrowser)
);

async function respondWithTabState(
  tabId: number,
  sendResponse: (response?: unknown) => void
): Promise<void> {
  const [read] = await Promise.allSettled([tabState.read(tabId)]);
  sendResponse(read.status === 'fulfilled' ? read.value : null);
}

const EXTENSION_ORIGIN = chrome.runtime.getURL('');

/**
Scan requests and tab state reads may name any tab, so only the extension's
own pages may send them; a page's renderer can forge content script messages.
*/
function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.url?.startsWith(EXTENSION_ORIGIN) === true;
}

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    // A prerendered or back/forward-cached document is not the page the tab shows.
    const isShownDocument =
      sender.documentLifecycle === undefined || sender.documentLifecycle === 'active';
    const senderTabId = isShownDocument ? sender.tab?.id : undefined;

    if (senderTabId !== undefined && message.type === MSG_CHECKOUT_ACTIVITY_DETECTED) {
      void tabState
        .checkoutActivityDetected(senderTabId, message.version, sender.frameId)
        .catch(() => {});
      return false;
    }

    if (senderTabId !== undefined && message.type === MSG_CHECKOUT_ACTIVITY_CLEARED) {
      void tabState.checkoutActivityCleared(senderTabId, sender.frameId).catch(() => {});
      return false;
    }

    if (!isExtensionPage(sender)) return false;

    if (message.type === MSG_SCAN_REQUEST) {
      void tabState.requestScan(message.tabId).catch(() => {});
      return false;
    }

    if (message.type === MSG_GET_TAB_STATE) {
      void respondWithTabState(message.tabId, sendResponse);
      return true; // Keep message channel open for async response
    }

    return false;
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void tabState.removed(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    void tabState.navigated(tabId).catch(() => {});
  } else if (changeInfo.status === 'complete') {
    void tabState.loaded(tabId);
  }
});
