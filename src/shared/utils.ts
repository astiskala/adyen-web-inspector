/**
 * Shared utility functions - Entry point for split utility modules.
 */

export * from './results.js';
export * from './health.js';
export * from './version-utils.js';
export * from './csp-utils.js';
export * from './export-utils.js';

import { ADYEN_HOST_SUFFIX, ADYEN_PAYMENTS_HOST_SUFFIX } from './constants.js';

import type { CapturedHeader, ScanPayload } from './types.js';

/** Extracts the hostname from a URL string. */
export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Determines if a hostname belongs to an Adyen-controlled domain. */
export function isAdyenHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === 'adyen.com' ||
    normalized.endsWith(ADYEN_HOST_SUFFIX) ||
    normalized === 'adyenpayments.com' ||
    normalized.endsWith(ADYEN_PAYMENTS_HOST_SUFFIX)
  );
}

const CHECKOUTSHOPPER_RESOURCE_PATTERN = /checkoutshopper-sdk|\/checkoutshopper\//i;

/** Determines if a URL refers to an Adyen Checkout resource (SDK script/CSS). */
export function isAdyenCheckoutResource(url: string): boolean {
  const host = extractHostname(url);
  if (host === null) return false;
  return CHECKOUTSHOPPER_RESOURCE_PATTERN.test(url) && isAdyenHost(host);
}

/** Case-insensitive lookup of a response header from the main document headers. */
export function getHeader(payload: ScanPayload, name: string): string | null {
  const lower = name.toLowerCase();
  return (
    payload.mainDocumentHeaders.find((h: CapturedHeader) => h.name.toLowerCase() === lower)
      ?.value ?? null
  );
}
