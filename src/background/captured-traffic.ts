/**
Captured traffic — what the Scan's network observations tell about the
checkout page: the checkout document's response headers, the main-document
and Adyen requests checks read, and the checkout analytics bodies, folded
after the analytics the page itself reported. Requests the page reports
itself (script and link tags, Resource Timing) fill in what the capture
missed. Part of the Scan: the
browser port only reports raw observations.
*/

import { readAdyenEndpoint } from '../shared/adyen-endpoint.js';
import {
  EMPTY_CHECKOUT_ANALYTICS,
  recordAnalyticsBody,
  reportedAnalytics,
} from '../shared/checkout-analytics.js';
import type {
  CapturedHeader,
  CapturedRequest,
  CheckoutAnalytics,
  CheckoutPage,
  DocumentHeaders,
} from '../shared/types.js';
import type { ObservedNetwork, ObservedPost, ObservedResponse } from './scan-browser.js';

/**
The network evidence of one Scan.
*/
export interface CapturedTraffic {
  readonly documentHeaders: DocumentHeaders;
  readonly capturedRequests: CapturedRequest[];
  readonly analytics: CheckoutAnalytics | null;
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

/**
Main-document and Adyen responses are the ones checks read.
*/
function isCheckedResponse(response: ObservedResponse): boolean {
  return response.type === 'main_frame' || readAdyenEndpoint(response.url) !== null;
}

function reported(url: string, type: CapturedRequest['type'], statusCode = 0): CapturedRequest {
  return { url, type, responseHeaders: [], statusCode };
}

/**
Requests the page itself reports, for traffic the capture did not observe.
*/
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

/**
Keeps the first request per type and URL, so observed responses win over page reports.
*/
function dedupe(requests: readonly CapturedRequest[]): CapturedRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = `${request.type}:${request.url}`;
    if (request.url === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseBody(post: ObservedPost): unknown {
  try {
    return JSON.parse(post.body);
  } catch {
    return null;
  }
}

/**
The page's analytics, then each analytics body observed on the network in order.
*/
function readAnalytics(
  page: CheckoutPage,
  posts: readonly ObservedPost[]
): CheckoutAnalytics | null {
  let analytics = page.analytics ?? EMPTY_CHECKOUT_ANALYTICS;
  for (const post of posts) {
    if (readAdyenEndpoint(post.url)?.role === 'analytics') {
      analytics = recordAnalyticsBody(analytics, parseBody(post));
    }
  }
  return reportedAnalytics(analytics) ?? null;
}

/**
The checkout document's headers: the tab's own response when checkout runs
in the top document, else a separate request for the checkout document's
URL. Only one document's headers are ever used, so availability and
content cannot describe different documents.
*/
async function readDocumentHeaders(
  page: CheckoutPage,
  responses: readonly ObservedResponse[],
  fetchDocumentHeaders: FetchDocumentHeaders
): Promise<DocumentHeaders> {
  const topDocument = responses.findLast((response) => response.type === 'main_frame');
  if (topDocument !== undefined && !page.checkoutInIframe && topDocument.headers.length > 0) {
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

/**
Reads the Scan's network observations for the Checkout page.
*/
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
    analytics: readAnalytics(page, observed.posts),
  };
}
