/**
 * Chrome adapter for the tab state port: session storage, the action badge,
 * and runtime messages to open popups and DevTools panels.
 */

import type { TabStateBrowser } from './tab-state.js';

/** Chrome adapter: badge and notification failures are ignored, because no UI may be listening. */
export const chromeTabStateBrowser: TabStateBrowser = {
  read: (keys) => chrome.storage.session.get([...keys]),
  write: (items) => chrome.storage.session.set({ ...items }),
  remove: (keys) => chrome.storage.session.remove([...keys]),
  setBadge(tabId, badge) {
    chrome.action.setBadgeText({ tabId, text: badge?.text ?? '' }).catch(() => {});
    if (badge !== null) {
      chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => {});
    }
  },
  notify(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
  },
};
