/**
 * Header collector — intercepts response headers during a scan.
 * Also captures Adyen checkout analytics POST request bodies to extract
 * SDK metadata such as flavor, version, buildType, and locale.
 * Registered per-scan and torn down after the page load completes.
 */

import type { AnalyticsData, CapturedHeader, CapturedRequest } from '../shared/types.js';
import { ALL_ADYEN_DOMAINS, ANALYTICS_URL_PATTERNS } from '../shared/constants.js';
import { extractHostname } from '../shared/utils.js';

const ANALYTICS_KEYS = [
  'flavor',
  'version',
  'buildType',
  'channel',
  'platform',
  'locale',
  'sessionId',
] as const;

type AnalyticsKey = (typeof ANALYTICS_KEYS)[number];

function isAnalyticsEntry(
  entry: readonly [AnalyticsKey, string] | null
): entry is readonly [AnalyticsKey, string] {
  return entry !== null;
}

interface HeaderCollectorResult {
  mainDocumentHeaders: CapturedHeader[];
  capturedRequests: CapturedRequest[];
  analyticsData: AnalyticsData | null;
}

export class HeaderCollector {
  private readonly tabId: number;
  private mainDocumentHeaders: CapturedHeader[] = [];
  private readonly capturedRequests: CapturedRequest[] = [];
  private readonly mergedAnalytics: Record<string, string> = {};
  private readonly listener: (
    details: chrome.webRequest.OnHeadersReceivedDetails
  ) => chrome.webRequest.BlockingResponse | undefined;
  private readonly bodyListener: (
    details: chrome.webRequest.OnBeforeRequestDetails
  ) => chrome.webRequest.BlockingResponse | undefined;

  constructor(tabId: number) {
    this.tabId = tabId;
    this.listener = (
      details: chrome.webRequest.OnHeadersReceivedDetails
    ): chrome.webRequest.BlockingResponse | undefined => {
      this.onHeadersReceived(details);
      return undefined;
    };
    this.bodyListener = (
      details: chrome.webRequest.OnBeforeRequestDetails
    ): chrome.webRequest.BlockingResponse | undefined => {
      this.onBeforeRequest(details);
      return undefined;
    };
  }

  start(): void {
    chrome.webRequest.onHeadersReceived.addListener(
      this.listener,
      { tabId: this.tabId, urls: ['<all_urls>'] },
      ['responseHeaders']
    );
    chrome.webRequest.onBeforeRequest.addListener(
      this.bodyListener,
      { tabId: this.tabId, urls: [...ANALYTICS_URL_PATTERNS] },
      ['requestBody']
    );
  }

  stop(): void {
    chrome.webRequest.onHeadersReceived.removeListener(this.listener);
    chrome.webRequest.onBeforeRequest.removeListener(this.bodyListener);
  }

  getResult(): HeaderCollectorResult {
    return {
      mainDocumentHeaders: [...this.mainDocumentHeaders],
      capturedRequests: [...this.capturedRequests],
      analyticsData: this.buildAnalyticsData(),
    };
  }

  private onHeadersReceived(details: chrome.webRequest.OnHeadersReceivedDetails): void {
    const { url, type, responseHeaders, statusCode } = details;
    const headers: CapturedHeader[] = (responseHeaders ?? []).map(
      (h: chrome.webRequest.HttpHeader) => ({
        name: h.name,
        value: h.value ?? '',
      })
    );

    if (type === 'main_frame') {
      this.mainDocumentHeaders = headers;
    }

    const hostname = extractHostname(url);
    const isAdyen =
      hostname !== null &&
      ALL_ADYEN_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));

    if (type === 'main_frame' || isAdyen) {
      this.capturedRequests.push({
        url,
        type: this.mapType(type),
        responseHeaders: headers,
        statusCode,
      });
    }
  }

  private mapType(type: string): CapturedRequest['type'] {
    if (type === 'main_frame') return 'main_frame';
    if (type === 'script') return 'script';
    if (type === 'stylesheet') return 'stylesheet';
    return 'other';
  }

  /**
   * Intercepts POST request bodies sent to Adyen checkout analytics endpoints.
   * Multiple analytics calls may be fired (setup + events); fields are merged.
   */
  private onBeforeRequest(details: chrome.webRequest.OnBeforeRequestDetails): void {
    if (details.method !== 'POST') return;
    const raw = details.requestBody?.raw;
    if (!raw?.[0]?.bytes) return;

    try {
      const decoder = new TextDecoder();
      const text = decoder.decode(raw[0].bytes);
      const json: unknown = JSON.parse(text);
      if (typeof json !== 'object' || json === null) return;

      for (const key of ANALYTICS_KEYS) {
        const value = (json as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.length > 0) {
          this.mergedAnalytics[key] = value;
        }
      }
    } catch {
      // Parsing failed — ignore
    }
  }

  private buildAnalyticsData(): AnalyticsData | null {
    const entries = ANALYTICS_KEYS.map((key) => {
      const value = this.mergedAnalytics[key];
      if (value === undefined) {
        return null;
      }
      return [key, value] as const;
    }).filter(isAnalyticsEntry);

    if (entries.length === 0) {
      return null;
    }

    return Object.fromEntries(entries);
  }
}
