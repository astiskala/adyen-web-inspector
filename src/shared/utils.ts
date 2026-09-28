/**
 * Shared utility functions - Entry point for split utility modules.
 */

export * from './results.js';
export * from './health.js';
export * from './version-utils.js';
export * from './csp-utils.js';
export * from './export-utils.js';

import { ADYEN_HOST_SUFFIX, ADYEN_PAYMENTS_HOST_SUFFIX } from './constants.js';

import type { CapturedHeader, ScanPayload, ScanResult } from './types.js';

/** Returns true for any non-null object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Checks the top-level shape of a scan result read from storage or a runtime message. */
export function isScanResult(value: unknown): value is ScanResult {
  return (
    isRecord(value) &&
    typeof value['pageUrl'] === 'string' &&
    typeof value['scannedAt'] === 'string' &&
    isRecord(value['sdkPresence']) &&
    Array.isArray(value['checks']) &&
    isRecord(value['health']) &&
    isRecord(value['payload'])
  );
}

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

const CHECKOUTSHOPPER_RESOURCE_PATTERN =
  /checkoutshopper-sdk|\/checkoutshopper\/|\/sdk\/\d+\.\d+\.\d+\/adyen\.js(?:[?#]|$)/i;

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

/** Returns all values for a given header name (case-insensitive). */
export function getAllHeaders(payload: ScanPayload, name: string): string[] {
  const lower = name.toLowerCase();
  return payload.mainDocumentHeaders
    .filter((h: CapturedHeader) => h.name.toLowerCase() === lower)
    .map((h) => h.value);
}

/** Extracts a locale string from an Adyen translation file URL. */
export function extractLocaleFromUrl(url: string): string | null {
  const match = /\/translations\/([^/]+)\.json$/.exec(url);
  const locale = match?.[1];
  return typeof locale === 'string' && locale !== '' ? locale : null;
}
