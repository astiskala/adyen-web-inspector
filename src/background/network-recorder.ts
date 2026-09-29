/**
 * Network recorder — the Chrome adapter's network capture. It records every
 * response the tab receives and the bodies the tab posts to Adyen checkout
 * analytics hosts while a scan runs, as the browser reports them. What the
 * traffic means is the Scan's decision (captured-traffic.ts).
 */

import { ANALYTICS_URL_PATTERNS } from '../shared/adyen-endpoint.js';
import type { ObservedNetwork, ObservedPost, ObservedResponse } from './scan-browser.js';

function decodeBody(raw: readonly chrome.webRequest.UploadData[]): string | null {
  const parts = raw.flatMap((part) => (part.bytes === undefined ? [] : [part.bytes]));
  if (parts.length === 0) return null;
  const decoder = new TextDecoder();
  return parts.map((bytes) => decoder.decode(bytes, { stream: true })).join('') + decoder.decode();
}

export class NetworkRecorder {
  private readonly tabId: number;
  private readonly responses: ObservedResponse[] = [];
  private readonly posts: ObservedPost[] = [];
  private readonly onHeaders = (
    details: chrome.webRequest.OnHeadersReceivedDetails
  ): chrome.webRequest.BlockingResponse | undefined => {
    this.responses.push({
      url: details.url,
      type: details.type,
      statusCode: details.statusCode,
      headers: (details.responseHeaders ?? []).map((h) => ({ name: h.name, value: h.value ?? '' })),
    });
    return undefined;
  };
  private readonly onRequest = (
    details: chrome.webRequest.OnBeforeRequestDetails
  ): chrome.webRequest.BlockingResponse | undefined => {
    const body = details.method === 'POST' ? decodeBody(details.requestBody?.raw ?? []) : null;
    if (body !== null) this.posts.push({ url: details.url, body });
    return undefined;
  };

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  start(): void {
    chrome.webRequest.onHeadersReceived.addListener(
      this.onHeaders,
      { tabId: this.tabId, urls: ['<all_urls>'] },
      ['responseHeaders']
    );
    chrome.webRequest.onBeforeRequest.addListener(
      this.onRequest,
      { tabId: this.tabId, urls: [...ANALYTICS_URL_PATTERNS] },
      ['requestBody']
    );
  }

  stop(): void {
    chrome.webRequest.onHeadersReceived.removeListener(this.onHeaders);
    chrome.webRequest.onBeforeRequest.removeListener(this.onRequest);
  }

  result(): ObservedNetwork {
    return { responses: [...this.responses], posts: [...this.posts] };
  }
}
