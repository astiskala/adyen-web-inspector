/**
 * Chrome adapter for the tab state client: runtime messages to and from the
 * service worker, which owns the tab state.
 */

import {
  EMPTY_TAB_SNAPSHOT,
  MSG_GET_TAB_STATE,
  MSG_SCAN_REQUEST,
  MSG_TAB_STATE_CHANGED,
  type CheckoutActivity,
  type TabScanStatus,
  type TabSnapshot,
} from '../../shared/messages.js';
import { isRecord, isScanResult } from '../../shared/utils.js';
import type { TabStateClient } from './useScanLifecycle.js';

function readActivity(value: unknown): CheckoutActivity {
  if (!isRecord(value) || value['detected'] !== true) return { detected: false };
  const version = value['version'];
  return typeof version === 'string' ? { detected: true, version } : { detected: true };
}

function readScanStatus(value: unknown): TabScanStatus {
  if (!isRecord(value)) return { state: 'idle' };
  if (value['state'] === 'running') return { state: 'running' };
  const error = value['error'];
  return value['state'] === 'failed' && typeof error === 'string'
    ? { state: 'failed', error }
    : { state: 'idle' };
}

/** Reads a snapshot from a runtime message, tolerating a missing or malformed value. */
function readSnapshot(value: unknown): TabSnapshot {
  if (!isRecord(value)) return EMPTY_TAB_SNAPSHOT;
  return {
    result: isScanResult(value['result']) ? value['result'] : null,
    checkoutActivity: readActivity(value['checkoutActivity']),
    scan: readScanStatus(value['scan']),
  };
}

/** Chrome adapter: the worker answers reads and publishes every tab state transition. */
export const chromeTabStateClient: TabStateClient = {
  async read(tabId) {
    return readSnapshot(await chrome.runtime.sendMessage({ type: MSG_GET_TAB_STATE, tabId }));
  },
  async requestScan(tabId) {
    await chrome.runtime.sendMessage({ type: MSG_SCAN_REQUEST, tabId });
  },
  subscribe(listener) {
    const onMessage = (message: unknown): void => {
      if (!isRecord(message) || message['type'] !== MSG_TAB_STATE_CHANGED) return;
      const tabId = message['tabId'];
      if (typeof tabId === 'number') listener(tabId, readSnapshot(message['snapshot']));
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return (): void => {
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  },
};
