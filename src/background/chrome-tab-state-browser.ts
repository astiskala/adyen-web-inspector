/**
Chrome adapter for the tab state port: session storage, the action badge,
and runtime messages to open popups and DevTools panels.
*/

import { MSG_REPORT_CHECKOUT_ACTIVITY, type BswToContentMessage } from '../shared/messages.js';
import type { TabStateBrowser } from './tab-state.js';

/**
Chrome adapter: badge and notification failures are ignored, because no UI may be listening.
*/
export const chromeTabStateBrowser: TabStateBrowser = {
  read: (keys) => chrome.storage.session.get([...keys]),
  write: (items) => chrome.storage.session.set({ ...items }),
  remove: (keys) => chrome.storage.session.remove([...keys]),
  setBadge(tabId, badge) {
    void chrome.action.setBadgeText({ tabId, text: badge?.text ?? '' }).catch(() => {});
    if (badge !== null) {
      void chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => {});
    }
  },
  notify(message) {
    void chrome.runtime.sendMessage(message).catch(() => {});
  },
  requestCheckoutActivity(tabId) {
    const message: BswToContentMessage = { type: MSG_REPORT_CHECKOUT_ACTIVITY };
    // Pages without the detector, such as chrome:// pages, have no receiver.
    void chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {});
  },
};
