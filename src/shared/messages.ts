/**
 * Message type definitions for communication between extension components.
 * Content scripts send detection messages to the background service worker;
 * the popup and DevTools panel request scans and receive result notifications.
 */

import type { ScanResult } from './types.js';

// ─── Message Types ────────────────────────────────────────────────────────────

export const MSG_CHECKOUT_ACTIVITY_DETECTED = 'CHECKOUT_ACTIVITY_DETECTED' as const;
export const MSG_CHECKOUT_ACTIVITY_CLEARED = 'CHECKOUT_ACTIVITY_CLEARED' as const;
export const MSG_SCAN_REQUEST = 'SCAN_REQUEST' as const;
export const MSG_SCAN_STARTED = 'SCAN_STARTED' as const;
export const MSG_SCAN_COMPLETE = 'SCAN_COMPLETE' as const;
export const MSG_SCAN_ERROR = 'SCAN_ERROR' as const;
export const MSG_SCAN_RESET = 'SCAN_RESET' as const;
export const MSG_GET_TAB_STATE = 'GET_TAB_STATE' as const;

// ─── Tab State ────────────────────────────────────────────────────────────────

/** What the passive detector last reported for the tab's current page. */
export interface CheckoutActivity {
  readonly detected: boolean;
  /** SDK version read from Adyen script URLs, when the detector saw one. */
  readonly version?: string;
}

/** A tab's state as the popup and DevTools panel read it through the worker. */
export interface TabSnapshot {
  readonly result: ScanResult | null;
  readonly checkoutActivity: CheckoutActivity;
}

// ─── Message Payloads ─────────────────────────────────────────────────────────

/** A mounted Drop-in, Component, or Adyen iframe was seen; SDK script tags alone do not count. */
interface CheckoutActivityDetectedMessage {
  readonly type: typeof MSG_CHECKOUT_ACTIVITY_DETECTED;
  readonly tabId: number;
  readonly version?: string;
}

interface CheckoutActivityClearedMessage {
  readonly type: typeof MSG_CHECKOUT_ACTIVITY_CLEARED;
  readonly tabId: number;
}

interface ScanRequestMessage {
  readonly type: typeof MSG_SCAN_REQUEST;
  readonly tabId: number;
}

interface ScanCompleteMessage {
  readonly type: typeof MSG_SCAN_COMPLETE;
  readonly tabId: number;
  readonly result: ScanResult;
}

interface ScanStartedMessage {
  readonly type: typeof MSG_SCAN_STARTED;
  readonly tabId: number;
}

interface ScanErrorMessage {
  readonly type: typeof MSG_SCAN_ERROR;
  readonly tabId: number;
  readonly error: string;
}

interface ScanResetMessage {
  readonly type: typeof MSG_SCAN_RESET;
  readonly tabId: number;
}

/** Answered with the tab's {@link TabSnapshot}. */
interface GetTabStateMessage {
  readonly type: typeof MSG_GET_TAB_STATE;
  readonly tabId: number;
}

// ─── Union Types ──────────────────────────────────────────────────────────────

/** Messages sent from the content script to the background service worker. */
export type ContentToBswMessage = CheckoutActivityDetectedMessage | CheckoutActivityClearedMessage;

/** Messages sent from the popup or DevTools to the background service worker. */
type UiToBswMessage = ScanRequestMessage | GetTabStateMessage;

/** Messages sent from the background service worker to the popup or DevTools. */
export type BswToUiMessage =
  ScanStartedMessage | ScanCompleteMessage | ScanErrorMessage | ScanResetMessage;

export type ExtensionMessage = ContentToBswMessage | UiToBswMessage | BswToUiMessage;
