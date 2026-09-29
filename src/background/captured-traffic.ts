/**
 * Captured traffic — what the Scan's network observations tell about the
 * checkout page: the checkout document's response headers, the main-document
 * and Adyen requests checks read, and the SDK fields in Adyen checkout
 * analytics bodies. Requests the page reports itself (script and link tags,
 * Resource Timing) fill in what the capture missed. Part of the Scan: the
 * browser port only reports raw observations.
 */

import { readAdyenEndpoint } from '../shared/adyen-endpoint.js';
import type {
  AnalyticsData,
  CapturedHeader,
  CapturedRequest,
  CheckoutPage,
  DocumentHeaders,
} from '../shared/types.js';
import type { ObservedNetwork, ObservedPost, ObservedResponse } from './scan-browser.js';

/** Analytics fields the Scan keeps; the rest of each body is discarded. */
const ANALYTICS_KEYS = [
  'flavor',
  'version',
  'buildType',
  'channel',
  'platform',
  'locale',
  'sessionId',
] as const;

/** The network evidence of one Scan. */
export interface CapturedTraffic {
  readonly documentHeaders: DocumentHeaders;
  readonly capturedRequests: CapturedRequest[];
  readonly analyticsData: AnalyticsData | null;
}

type FetchDocumentHeaders = (url: string) => Promise<CapturedHeader[]>;

const KEPT_TYPES: ReadonlySet<string> = new Set(['main_frame', 'script', 'stylesheet']);

function requestType(type: string): CapturedRequest['type'] {
  return KEPT_TYPES.has(type) ? (type as CapturedRequest['type']) : 'other';
}

function toCapturedRequest(response: ObservedResponse): CapturedRequest {
  return {
    url: response.url,
    type: requestType(response.type),
    responseHeaders: [...response.headers],
    statusCode: response.statusCode,
  };
}

/** Main-document and Adyen responses are the ones checks read. */
function isCheckedResponse(response: ObservedResponse): boolean {
  return response.type === 'main_frame' || readAdyenEndpoint(response.url) !== null;
}

function reported(url: string, type: CapturedRequest['type'], statusCode = 0): CapturedRequest {
  return { url, type, responseHeaders: [], statusCode };
}

/** Requests the page itself reports, for traffic the capture did not observe. */
function pageRequests(page: CheckoutPage): CapturedRequest[] {
  return [
    reported(page.pageUrl, 'main_frame'),
    ...page.scripts.map((s) => reported(s.src, 'script')),
    ...page.links.map((l) =>
      reported(l.href, l.rel.toLowerCase().includes('stylesheet') ? 'stylesheet' : 'other')
    ),
    ...(page.observedRequests ?? []).map((o) =>
      reported(o.url, o.initiatorType === 'script' ? 'script' : 'other', o.responseStatus)
    ),
  ];
}

/** Keeps the first request per type and URL, so observed responses win over page reports. */
function dedupe(requests: readonly CapturedRequest[]): CapturedRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = `${request.type}:${request.url}`;
    if (request.url === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseBody(post: ObservedPost): Record<string, unknown> | null {
  try {
    const json: unknown = JSON.parse(post.body);
    return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Merges the SDK fields of analytics bodies; later calls win per field. */
function readAnalytics(posts: readonly ObservedPost[]): AnalyticsData | null {
  const merged: { -readonly [K in keyof AnalyticsData]: AnalyticsData[K] } = {};
  for (const post of posts) {
    if (readAdyenEndpoint(post.url)?.role !== 'analytics') continue;
    const body = parseBody(post);
    for (const key of ANALYTICS_KEYS) {
      const value = body?.[key];
      if (typeof value === 'string' && value !== '') merged[key] = value;
    }
  }
  return Object.keys(merged).length === 0 ? null : merged;
}

/**
 * The checkout document's headers: the tab's own response when checkout runs
 * in the top document, else a separate request for the checkout document's
 * URL. Only one document's headers are ever used, so availability and
 * content cannot describe different documents.
 */
async function readDocumentHeaders(
  page: CheckoutPage,
  responses: readonly ObservedResponse[],
  fetchDocumentHeaders: FetchDocumentHeaders
): Promise<DocumentHeaders> {
  const topDocument = responses.findLast((response) => response.type === 'main_frame');
  if (!page.checkoutInIframe && topDocument !== undefined && topDocument.headers.length > 0) {
    return {
      status: 'observed',
      url: topDocument.url,
      source: 'captured',
      headers: topDocument.headers,
    };
  }
  const fetched = await fetchDocumentHeaders(page.pageUrl);
  return fetched.length > 0
    ? { status: 'observed', url: page.pageUrl, source: 'fetched', headers: fetched }
    : { status: 'unavailable' };
}

/** Reads the Scan's network observations for the Checkout page. */
export async function readCapturedTraffic(
  observed: ObservedNetwork,
  page: CheckoutPage,
  fetchDocumentHeaders: FetchDocumentHeaders
): Promise<CapturedTraffic> {
  return {
    documentHeaders: await readDocumentHeaders(page, observed.responses, fetchDocumentHeaders),
    capturedRequests: dedupe([
      ...observed.responses.filter(isCheckedResponse).map(toCapturedRequest),
      ...pageRequests(page),
    ]),
    analyticsData: readAnalytics(observed.posts),
  };
}
