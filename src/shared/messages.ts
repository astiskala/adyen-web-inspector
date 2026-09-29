/**
 * Message type definitions for communication between extension components.
 * Content scripts send detection messages to the background service worker;
 * the popup and DevTools panel request scans, read a tab's snapshot, and
 * receive every snapshot the tab state publishes.
 */

import type { ScanResult } from './types.js';

// ─── Message Types ────────────────────────────────────────────────────────────

export const MSG_CHECKOUT_ACTIVITY_DETECTED = 'CHECKOUT_ACTIVITY_DETECTED' as const;
export const MSG_CHECKOUT_ACTIVITY_CLEARED = 'CHECKOUT_ACTIVITY_CLEARED' as const;
export const MSG_SCAN_REQUEST = 'SCAN_REQUEST' as const;
export const MSG_GET_TAB_STATE = 'GET_TAB_STATE' as const;
export const MSG_TAB_STATE_CHANGED = 'TAB_STATE_CHANGED' as const;

// ─── Tab State ────────────────────────────────────────────────────────────────

/** What the passive detector last reported for the tab's current page. */
export interface CheckoutActivity {
  readonly detected: boolean;
  /** SDK version read from Adyen script URLs, when the detector saw one. */
  readonly version?: string;
}

/** The Scan of the tab's current page: none running, running, or the last one failed. */
export type TabScanStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'running' }
  | { readonly state: 'failed'; readonly error: string };

/** A tab's state as the popup and DevTools panel see it. */
export interface TabSnapshot {
  readonly result: ScanResult | null;
  readonly checkoutActivity: CheckoutActivity;
  readonly scan: TabScanStatus;
}

/** The snapshot of a tab with nothing detected, stored, or running. */
export const EMPTY_TAB_SNAPSHOT: TabSnapshot = {
  result: null,
  checkoutActivity: { detected: false },
  scan: { state: 'idle' },
};

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

/** Published after every tab state transition, with the tab's new snapshot. */
interface TabStateChangedMessage {
  readonly type: typeof MSG_TAB_STATE_CHANGED;
  readonly tabId: number;
  readonly snapshot: TabSnapshot;
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
export type BswToUiMessage = TabStateChangedMessage;

export type ExtensionMessage = ContentToBswMessage | UiToBswMessage | BswToUiMessage;
