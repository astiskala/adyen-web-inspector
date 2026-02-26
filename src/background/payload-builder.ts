/**
 * Payload builder — logic to enrich the ScanPayload with extra signals.
 */

import type {
  CapturedHeader,
  CapturedRequest,
  CheckoutConfig,
  PageExtractResult,
} from '../shared/types.js';
import { extractHostname, parseVersion } from '../shared/utils.js';

const SCRIPT_FETCH_TIMEOUT_MS = 2_500;
const SCRIPT_FETCH_LIMIT = 4;
const SCRIPT_TEXT_SCAN_LIMIT = 1_500_000;
const HEADER_PROBE_TIMEOUT_MS = 5_000;

/** Patterns to extract a semver version from Adyen CDN URLs. */
const CDN_VERSION_PATTERNS = [/checkoutshopper-sdk[./](\d+\.\d+\.\d+)/, /\/sdk\/(\d+\.\d+\.\d+)\//];

/**
 * Fetches response headers for the checkout document.
 * Tries `HEAD` first and falls back to `GET` when `HEAD` yields no headers.
 */
export async function probeMainDocumentHeaders(pageUrl: string): Promise<CapturedHeader[]> {
  const headHeaders = await fetchHeaders(pageUrl, 'HEAD');
  if (headHeaders.length > 0) {
    return headHeaders;
  }
  return fetchHeaders(pageUrl, 'GET');
}

async function fetchHeaders(url: string, method: 'HEAD' | 'GET'): Promise<CapturedHeader[]> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort();
  }, HEADER_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
    });

    const headers: CapturedHeader[] = [];
    response.headers.forEach((value, name) => {
      headers.push({ name, value });
    });
    return headers;
  } catch {
    return [];
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

interface BundleInsights {
  version: string | null;
  checkoutConfig: Partial<CheckoutConfig> | null;
}

/**
 * Downloads likely same-origin bundles and heuristically extracts
 * SDK version and checkout config fallback values.
 */
export async function extractBundleInsights(
  pageUrl: string,
  scriptUrls: string[]
): Promise<BundleInsights> {
  const pageHost = extractHostname(pageUrl);
  if (pageHost === null || pageHost === '') {
    return { version: null, checkoutConfig: null };
  }

  const sameHostScripts = scriptUrls
    .map((url) => ({ url, host: extractHostname(url), score: getScriptPriority(url) }))
    .filter((item) => item.host === pageHost)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.url);

  let detectedVersion: string | null = null;
  let detectedConfig: Partial<CheckoutConfig> | null = null;

  const uniqueScripts = [...new Set(sameHostScripts)].slice(0, SCRIPT_FETCH_LIMIT);
  for (const scriptUrl of uniqueScripts) {
    const scriptText = await fetchScriptText(scriptUrl);
    if (scriptText === null || scriptText === '') {
      continue;
    }

    detectedVersion ??= extractVersionFromScriptText(scriptText);
    detectedConfig ??= extractCheckoutConfigFromScriptText(scriptText);
    if (detectedVersion !== null && detectedConfig !== null) {
      break;
    }
  }

  return { version: detectedVersion, checkoutConfig: detectedConfig };
}

function getScriptPriority(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes('main')) return 5;
  if (lower.includes('vendor') || lower.includes('vendors')) return 4;
  if (lower.includes('bundle')) return 3;
  if (lower.includes('chunk')) return 2;
  return 1;
}

async function fetchScriptText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort();
  }, SCRIPT_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    return text.slice(0, SCRIPT_TEXT_SCAN_LIMIT);
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function extractVersionFromScriptText(scriptText: string): string | null {
  const patterns = [
    /@adyen\/adyen-web[^0-9]{0,80}["'`]?(\d+\.\d+\.\d+)["'`]?/i,
    /adyen-web[^0-9]{0,80}["'`]?(\d+\.\d+\.\d+)["'`]?/i,
    /checkoutshopper[^0-9]{0,80}["'`]?(\d+\.\d+\.\d+)["'`]?/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(scriptText);
    const candidate = match?.[1];
    if (candidate === undefined || candidate === '' || parseVersion(candidate) === null) {
      continue;
    }
    return candidate;
  }

  return null;
}

function extractCheckoutConfigFromScriptText(scriptText: string): Partial<CheckoutConfig> | null {
  const clientKey = /clientKey["']?\s*[:=]\s*["']((?:test|live)_[A-Za-z0-9]+)/i.exec(
    scriptText
  )?.[1];
  const environment = /environment["']?\s*[:=]\s*["'](test|live)["']/i.exec(scriptText)?.[1];
  const locale = /locale["']?\s*[:=]\s*["']([A-Za-z]{2,3}-[A-Za-z]{2,4})["']/i.exec(
    scriptText
  )?.[1];
  const countryCode = /countryCode["']?\s*[:=]\s*["']([A-Za-z]{2})["']/i.exec(scriptText)?.[1];

  const config: Partial<CheckoutConfig> = {
    ...(clientKey === undefined ? {} : { clientKey }),
    ...(environment === undefined ? {} : { environment }),
    ...(locale === undefined ? {} : { locale }),
    ...(countryCode === undefined ? {} : { countryCode }),
  };

  if (Object.keys(config).length === 0) {
    return null;
  }

  return config;
}

function matchCdnVersion(url: string): string | null {
  for (const pattern of CDN_VERSION_PATTERNS) {
    const match = pattern.exec(url);
    const version = match?.[1];
    if (version !== undefined && version !== '') return version;
  }
  return null;
}

function findFirstVersionInUrls(urls: readonly string[]): string | null {
  for (const url of urls) {
    const version = matchCdnVersion(url);
    if (version !== null) return version;
  }
  return null;
}

/**
 * Extracts the first Adyen SDK semver found in script URLs.
 */
export function extractVersionFromScripts(srcs: string[]): string | null {
  return findFirstVersionInUrls(srcs);
}

/**
 * Extracts the first Adyen SDK semver found in captured request URLs.
 */
export function extractVersionFromRequests(requests: CapturedRequest[]): string | null {
  return findFirstVersionInUrls(requests.map((request) => request.url));
}

/**
 * Merges inferred checkout config values into extracted page data.
 * Existing page config fields always take precedence over fallback fields.
 */
export function withCheckoutConfigFallback(
  pageData: PageExtractResult,
  fallback: Partial<CheckoutConfig> | null
): PageExtractResult {
  if (fallback === null) {
    return pageData;
  }

  const mergedConfig: CheckoutConfig = {
    ...(fallback.clientKey === undefined ? {} : { clientKey: fallback.clientKey }),
    ...(fallback.environment === undefined ? {} : { environment: fallback.environment }),
    ...(fallback.locale === undefined ? {} : { locale: fallback.locale }),
    ...(fallback.countryCode === undefined ? {} : { countryCode: fallback.countryCode }),
    ...(pageData.checkoutConfig ?? {}),
  };

  return {
    ...pageData,
    checkoutConfig: mergedConfig,
  };
}
