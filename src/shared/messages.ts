/**
 * Message type definitions for communication between extension components.
 * Background Service Worker ↔ Popup ↔ DevTools Panel
 */

import type { ScanResult } from './types.js';

// ─── Message Types ────────────────────────────────────────────────────────────

export const MSG_ADYEN_DETECTED = 'ADYEN_DETECTED' as const;
export const MSG_ADYEN_NOT_DETECTED = 'ADYEN_NOT_DETECTED' as const;
export const MSG_SCAN_REQUEST = 'SCAN_REQUEST' as const;
export const MSG_SCAN_STARTED = 'SCAN_STARTED' as const;
export const MSG_SCAN_COMPLETE = 'SCAN_COMPLETE' as const;
export const MSG_SCAN_ERROR = 'SCAN_ERROR' as const;
export const MSG_SCAN_RESET = 'SCAN_RESET' as const;
export const MSG_GET_RESULT = 'GET_RESULT' as const;

// ─── Message Payloads ─────────────────────────────────────────────────────────
type ScanRequestSource = 'popup' | 'devtools';

export interface AdyenDetectedMessage {
  readonly type: typeof MSG_ADYEN_DETECTED;
  readonly tabId: number;
  readonly version?: string;
}

export interface AdyenNotDetectedMessage {
  readonly type: typeof MSG_ADYEN_NOT_DETECTED;
  readonly tabId: number;
}

interface ScanRequestMessage {
  readonly type: typeof MSG_SCAN_REQUEST;
  readonly tabId: number;
  readonly source?: ScanRequestSource;
}

export interface ScanCompleteMessage {
  readonly type: typeof MSG_SCAN_COMPLETE;
  readonly tabId: number;
  readonly result: ScanResult;
}

export interface ScanStartedMessage {
  readonly type: typeof MSG_SCAN_STARTED;
  readonly tabId: number;
}

export interface ScanErrorMessage {
  readonly type: typeof MSG_SCAN_ERROR;
  readonly tabId: number;
  readonly error: string;
}

export interface ScanResetMessage {
  readonly type: typeof MSG_SCAN_RESET;
  readonly tabId: number;
}

interface GetResultMessage {
  readonly type: typeof MSG_GET_RESULT;
  readonly tabId: number;
}

// ─── Union Types ──────────────────────────────────────────────────────────────

/** Messages sent from content script to background service worker */
export type ContentToBswMessage = AdyenDetectedMessage | AdyenNotDetectedMessage;

/** Messages sent from popup/devtools to background service worker */
export type UiToBswMessage = ScanRequestMessage | GetResultMessage;

/** Messages sent from background service worker to popup/devtools */
export type BswToUiMessage =
  | ScanStartedMessage
  | ScanCompleteMessage
  | ScanErrorMessage
  | ScanResetMessage;

export type ExtensionMessage = ContentToBswMessage | UiToBswMessage | BswToUiMessage;
