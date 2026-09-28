/**
 * Browser port for the Scan. The Chrome adapter drives a real tab; tests use
 * an in-memory adapter so scan sequencing can be verified without a browser.
 */

import type {
  AnalyticsData,
  CapturedHeader,
  CapturedRequest,
  PageExtractResult,
  ScanResult,
} from '../shared/types.js';

/** One frame's page extraction; null when the frame produced no result. */
export interface FrameExtraction {
  readonly frameId: number;
  readonly result: PageExtractResult | null;
}

/** Network observations collected while a scan runs. */
export interface CollectedNetwork {
  readonly mainDocumentHeaders: CapturedHeader[];
  readonly capturedRequests: CapturedRequest[];
  readonly analyticsData: AnalyticsData | null;
}

/** An active network capture for one tab. */
export interface NetworkCapture {
  /** Stops capturing and returns the observations; safe to call more than once. */
  stop(): CollectedNetwork;
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
  waitForTabComplete(tabId: number, timeoutMs: number): Promise<void>;
  /** Runs page extraction in every accessible frame; rejects when injection fails. */
  extractFrames(tabId: number): Promise<readonly FrameExtraction[]>;
  /** Starts observing the tab's network traffic. */
  captureNetwork(tabId: number): NetworkCapture;
  /** Fetches the checkout document's response headers; resolves empty on failure. */
  fetchDocumentHeaders(url: string): Promise<CapturedHeader[]>;
  /** Reads an SDK version from same-origin bundles; resolves null on failure. */
  probeBundleVersion(pageUrl: string, scriptUrls: string[]): Promise<string | null>;
  /** Resolves the latest adyen-web release; resolves null on failure. */
  getReleaseInfo(): Promise<AdyenWebReleaseInfo | null>;
  /** Persists the result for popup and DevTools retrieval. */
  storeResult(result: ScanResult): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Current time in Unix milliseconds. */
  now(): number;
}
