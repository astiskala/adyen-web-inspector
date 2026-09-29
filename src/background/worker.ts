/**
 * Background Service Worker — extension entry point.
 * Routes runtime messages and tab events to the tab state, which owns the
 * badge, stored state, and Scan lifecycle for each tab.
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

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    const senderTabId = sender.tab?.id;

    if (message.type === MSG_CHECKOUT_ACTIVITY_DETECTED && senderTabId !== undefined) {
      tabState.checkoutActivityDetected(senderTabId, message.version).catch(() => {});
      return false;
    }

    if (message.type === MSG_CHECKOUT_ACTIVITY_CLEARED && senderTabId !== undefined) {
      tabState.checkoutActivityCleared(senderTabId).catch(() => {});
      return false;
    }

    if (message.type === MSG_SCAN_REQUEST) {
      tabState.requestScan(message.tabId).catch(() => {});
      return false;
    }

    if (message.type === MSG_GET_TAB_STATE) {
      tabState.read(message.tabId).then(sendResponse, () => {
        sendResponse(null);
      });
      return true; // Keep message channel open for async response
    }

    return false;
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.removed(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabState.navigated(tabId).catch(() => {});
  }
});
