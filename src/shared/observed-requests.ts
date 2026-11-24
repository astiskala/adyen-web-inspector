/**
Observed requests — which Resource Timing entries a scan reads, and how one
becomes an `ObservedRequest`. The config interceptor records entries as the
page loads them and the page extractor reads them back, so both apply the
same reading.
*/

import {
  isCheckoutApiRequest,
  readAdyenEndpoint,
  readTranslationLocale,
} from './adyen-endpoint.js';
import { DF_IFRAME_URL_PATTERN } from './constants.js';
import { findSdkVersionInUrls } from './sdk-version.js';
import type { ObservedRequest } from './types.js';

/**
Requests a scan reads: Adyen hosts, Checkout API paths a merchant server may
proxy, self-hosted SDK assets, translation files, and the device fingerprint
page. Other resources, such as third-party pixels whose URLs can carry
shopper identifiers, are not recorded.
*/
function isCheckoutRequest(url: string): boolean {
  return (
    readAdyenEndpoint(url) !== null ||
    isCheckoutApiRequest(url) ||
    findSdkVersionInUrls([url]) !== null ||
    readTranslationLocale(url) !== null ||
    DF_IFRAME_URL_PATTERN.test(url)
  );
}

/**
Reads a Resource Timing entry as an observed request, or null when a scan
does not read its URL. Page scripts can replace recorded entries, so every
field is checked.
*/
export function readObservedRequest(entry: unknown): ObservedRequest | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { name, initiatorType, responseStatus } = entry as Partial<
    Record<'name' | 'initiatorType' | 'responseStatus', unknown>
  >;
  if (typeof name !== 'string' || !isCheckoutRequest(name)) return null;
  return {
    url: name,
    ...(typeof initiatorType === 'string' && initiatorType.length > 0 && { initiatorType }),
    // Browsers report 0 for opaque cross-origin responses and older Chromium lacks the field.
    ...(typeof responseStatus === 'number' && responseStatus > 0 && { responseStatus }),
  };
}
