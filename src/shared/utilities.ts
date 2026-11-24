/**
Small shared helpers: error descriptions, value guards, and hostnames.
Severity policy, health, versions, and CSP have their own modules.
*/

import type { ScanResult } from './types.js';

/**
Describes a thrown value: an Error's message, a string as-is, otherwise its type tag.
*/
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : Object.prototype.toString.call(error);
}

/**
Returns true for any non-null object.
*/
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
Checks the top-level shape of a scan result read from storage or a runtime message.
*/
export function isScanResult(value: unknown): value is ScanResult {
  return (
    isRecord(value) &&
    typeof value['pageUrl'] === 'string' &&
    typeof value['scannedAt'] === 'string' &&
    isRecord(value['sdkPresence']) &&
    isRecord(value['attributes']) &&
    Array.isArray(value['checks']) &&
    isRecord(value['health']) &&
    isRecord(value['payload'])
  );
}

/**
Extracts the hostname from a URL string.
*/
export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
