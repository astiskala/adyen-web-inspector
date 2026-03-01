/**
 * Background Service Worker — extension entry point.
 * Handles badge management, scan request dispatch, and message routing.
 */

import {
  MSG_ADYEN_DETECTED,
  MSG_ADYEN_NOT_DETECTED,
  MSG_GET_RESULT,
  MSG_SCAN_RESET,
  MSG_SCAN_COMPLETE,
  MSG_SCAN_ERROR,
  MSG_SCAN_STARTED,
  MSG_SCAN_REQUEST,
  type AdyenDetectedMessage,
  type AdyenNotDetectedMessage,
  type BswToUiMessage,
  type ExtensionMessage,
} from '../shared/messages.js';
import { runScan, getStoredResult } from './scan-orchestrator.js';
import {
  STORAGE_DETECTED_PREFIX,
  STORAGE_SCAN_RESULT_PREFIX,
  STORAGE_VERSION_PREFIX,
} from '../shared/constants.js';
import type { HealthScore } from '../shared/types.js';

// ─── Badge Helpers ─────────────────────────────────────────────────────────────

function setBadgeDetected(tabId: number): void {
  chrome.action.setBadgeText({ tabId, text: '✓' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#188038' }).catch(() => {});
}

function healthBadgeColor(tier: HealthScore['tier']): string {
  if (tier === 'excellent') return '#188038';
  if (tier === 'issues') return '#f29900';
  return '#d93025';
}

function setBadgeHealth(tabId: number, health: HealthScore): void {
  chrome.action.setBadgeText({ tabId, text: `${health.score}` }).catch(() => {});
  chrome.action
    .setBadgeBackgroundColor({ tabId, color: healthBadgeColor(health.tier) })
    .catch(() => {});
}

function clearBadge(tabId: number): void {
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
}

function setBadgeScanning(tabId: number): void {
  chrome.action.setBadgeText({ tabId, text: '…' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#f29900' }).catch(() => {});
}

function sendUiMessage(message: BswToUiMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function clearTabSessionState(tabId: number): Promise<void> {
  return chrome.storage.session
    .remove([
      `${STORAGE_SCAN_RESULT_PREFIX}${tabId}`,
      `${STORAGE_DETECTED_PREFIX}${tabId}`,
      `${STORAGE_VERSION_PREFIX}${tabId}`,
    ])
    .catch(() => {});
}

// ─── Scan Guard ───────────────────────────────────────────────────────────────

const scanInFlight = new Set<number>();

// ─── Message Handlers ─────────────────────────────────────────────────────────

function handleAdyenDetected(msg: AdyenDetectedMessage, senderTabId: number): void {
  setBadgeDetected(senderTabId);
  chrome.storage.session
    .set({
      [`${STORAGE_DETECTED_PREFIX}${senderTabId}`]: true,
      ...(msg.version === undefined
        ? {}
        : { [`${STORAGE_VERSION_PREFIX}${senderTabId}`]: msg.version }),
    })
    .catch(() => {});
}

function handleAdyenNotDetected(_msg: AdyenNotDetectedMessage, senderTabId: number): void {
  clearBadge(senderTabId);
  chrome.storage.session
    .remove([`${STORAGE_DETECTED_PREFIX}${senderTabId}`, `${STORAGE_VERSION_PREFIX}${senderTabId}`])
    .catch(() => {});
}

async function handleScanRequest(senderTabId: number): Promise<void> {
  if (scanInFlight.has(senderTabId)) return;
  scanInFlight.add(senderTabId);

  setBadgeScanning(senderTabId);
  sendUiMessage({
    type: MSG_SCAN_STARTED,
    tabId: senderTabId,
  });

  try {
    const result = await runScan(senderTabId);
    const response: BswToUiMessage = {
      type: MSG_SCAN_COMPLETE,
      tabId: senderTabId,
      result,
    };
    sendUiMessage(response);
    setBadgeHealth(senderTabId, result.health);
  } catch (err: unknown) {
    let errorMsg: string;
    if (err instanceof Error) {
      errorMsg = err.message;
    } else {
      const typeStr =
        typeof err === 'object' && err !== null ? Object.prototype.toString.call(err) : typeof err;
      errorMsg = `[${typeStr}]`;
    }
    const response: BswToUiMessage = {
      type: MSG_SCAN_ERROR,
      tabId: senderTabId,
      error: errorMsg,
    };
    sendUiMessage(response);
    clearBadge(senderTabId);
  } finally {
    scanInFlight.delete(senderTabId);
  }
}

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    const senderTabId = sender.tab?.id;

    if (message.type === MSG_ADYEN_DETECTED && senderTabId !== undefined) {
      handleAdyenDetected(message, senderTabId);
      return false;
    }

    if (message.type === MSG_ADYEN_NOT_DETECTED && senderTabId !== undefined) {
      handleAdyenNotDetected(message, senderTabId);
      return false;
    }

    if (message.type === MSG_SCAN_REQUEST) {
      const tabId = message.tabId;
      handleScanRequest(tabId).catch(() => {});
      return false;
    }

    if (message.type === MSG_GET_RESULT) {
      const tabId = message.tabId;
      getStoredResult(tabId)
        .then((result) => sendResponse(result))
        .catch(() => sendResponse(null));
      return true; // Keep message channel open for async response
    }

    return false;
  }
);

// ─── Tab Cleanup ──────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabSessionState(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') {
    return;
  }

  clearBadge(tabId);
  clearTabSessionState(tabId)
    .then(() => {
      const response: BswToUiMessage = {
        type: MSG_SCAN_RESET,
        tabId,
      };
      sendUiMessage(response);
    })
    .catch(() => {});
});
