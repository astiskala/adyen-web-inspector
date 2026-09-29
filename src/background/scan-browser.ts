/**
 * Browser port for the Scan. The Chrome adapter drives a real tab; tests use
 * an in-memory adapter so scan sequencing can be verified without a browser.
 * The port is I/O only: it reports what the browser observed, and the Scan
 * decides what it means.
 */

import type { CapturedHeader, PageExtractResult } from '../shared/types.js';

/** One frame's page extraction; null when the frame produced no result. */
export interface FrameExtraction {
  readonly frameId: number;
  readonly result: PageExtractResult | null;
}

/** A response the tab received while the Scan observed its network. */
export interface ObservedResponse {
  readonly url: string;
  /** The browser's resource type, such as main_frame, sub_frame, script, or xmlhttprequest. */
  readonly type: string;
  readonly statusCode: number;
  readonly headers: readonly CapturedHeader[];
}

/** A request body the tab posted to an Adyen checkout analytics host. */
export interface ObservedPost {
  readonly url: string;
  /** The body decoded as text. */
  readonly body: string;
}

/** Network traffic observed while a scan runs, as the browser reported it. */
export interface ObservedNetwork {
  readonly responses: readonly ObservedResponse[];
  readonly posts: readonly ObservedPost[];
}

/** An active network capture for one tab. */
export interface NetworkCapture {
  /** Stops capturing and returns the observations; safe to call more than once. */
  stop: () => ObservedNetwork;
}

/** Latest published adyen-web release information. */
export interface AdyenWebReleaseInfo {
  readonly latest: string;
  /** ISO publish timestamps keyed by stable version, limited to supported majors. */
  readonly releaseDates: Readonly<Record<string, string>>;
}

/** Everything the Scan needs from the browser. */
export interface ScanBrowser {
  /** Resolves once the tab has finished loading; rejects after the timeout. */
  waitForTabComplete: (tabId: number, timeoutMs: number) => Promise<void>;
  /** Runs page extraction in every accessible frame; rejects when injection fails. */
  extractFrames: (tabId: number) => Promise<readonly FrameExtraction[]>;
  /** Starts observing the tab's network traffic. */
  captureNetwork: (tabId: number) => NetworkCapture;
  /** Fetches a document's response headers; resolves empty on failure. */
  fetchDocumentHeaders: (url: string) => Promise<CapturedHeader[]>;
  /** Fetches a script's text without credentials; resolves null on failure. */
  fetchScriptText: (url: string) => Promise<string | null>;
  /** Resolves the latest adyen-web release; resolves null on failure. */
  getReleaseInfo: () => Promise<AdyenWebReleaseInfo | null>;
  sleep: (ms: number) => Promise<void>;
  /** Current time in Unix milliseconds. */
  now: () => number;
}
