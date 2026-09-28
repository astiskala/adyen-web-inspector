import type {
  AdyenWebReleaseInfo,
  CollectedNetwork,
  FrameExtraction,
  ScanBrowser,
} from '../../src/background/scan-browser';
import type { CapturedHeader, PageExtractResult, ScanResult } from '../../src/shared/types';

export interface FakeScanBrowserOptions {
  /** Successive extractFrames results; the last one repeats once exhausted. */
  readonly extractions?: readonly (readonly FrameExtraction[])[];
  readonly network?: Partial<CollectedNetwork>;
  readonly documentHeaders?: CapturedHeader[];
  readonly bundleVersion?: string | null;
  readonly release?: AdyenWebReleaseInfo | null;
  readonly tabLoadError?: Error;
  readonly startTime?: number;
}

export interface FakeScanBrowser extends ScanBrowser {
  /** Port calls in order, for sequencing assertions. */
  readonly calls: string[];
  readonly stored: ScanResult[];
  readonly sleeps: number[];
  networkStops: number;
}

/** Wraps page extractions as frames; the first is the top frame. */
export function framesOf(...pages: readonly (PageExtractResult | null)[]): FrameExtraction[] {
  return pages.map((result, frameId) => ({ frameId, result }));
}

/** In-memory adapter for the Scan browser port with a virtual clock. */
export function createFakeScanBrowser(options: FakeScanBrowserOptions = {}): FakeScanBrowser {
  const extractions = options.extractions ?? [[]];
  let extractionIndex = 0;
  let clock = options.startTime ?? Date.parse('2026-09-28T00:00:00.000Z');
  const network: CollectedNetwork = {
    mainDocumentHeaders: [],
    capturedRequests: [],
    analyticsData: null,
    ...options.network,
  };

  const browser: FakeScanBrowser = {
    calls: [],
    stored: [],
    sleeps: [],
    networkStops: 0,
    waitForTabComplete: async (tabId) => {
      browser.calls.push(`waitForTabComplete:${tabId}`);
      if (options.tabLoadError !== undefined) throw options.tabLoadError;
    },
    extractFrames: async () => {
      browser.calls.push('extractFrames');
      const frames = extractions[Math.min(extractionIndex, extractions.length - 1)] ?? [];
      extractionIndex += 1;
      return frames;
    },
    captureNetwork: () => {
      browser.calls.push('captureNetwork');
      return {
        stop: (): CollectedNetwork => {
          browser.networkStops += 1;
          return network;
        },
      };
    },
    fetchDocumentHeaders: async (url) => {
      browser.calls.push(`fetchDocumentHeaders:${url}`);
      return options.documentHeaders ?? [];
    },
    probeBundleVersion: async () => {
      browser.calls.push('probeBundleVersion');
      return options.bundleVersion ?? null;
    },
    getReleaseInfo: async () => {
      browser.calls.push('getReleaseInfo');
      return options.release ?? null;
    },
    storeResult: async (result) => {
      browser.calls.push('storeResult');
      browser.stored.push(result);
    },
    sleep: async (ms) => {
      browser.sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return browser;
}
