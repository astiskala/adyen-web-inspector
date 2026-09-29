import { readImplementationAttributes } from '../../src/shared/implementation-attributes';
import type {
  ScanPayload,
  PageExtractResult,
  CapturedCheckoutOptions,
  DocumentHeaders,
  CheckoutConfig,
  CheckoutPage,
  AdyenWebMetadata,
  AnalyticsData,
  CapturedHeader,
  CapturedRequest,
  ScanResult,
} from '../../src/shared/types';

type VersionInfo = ScanPayload['versionInfo'];

const EMPTY_PAGE = {
  adyenMetadata: null,
  capturedConfig: null,
  inferredConfig: null,
  pageJsonConfig: null,
  componentConfig: null,
  scripts: [],
  links: [],
  iframes: [],
  adyenStyles: { classOverrideCount: 0, classOverrideSelectors: [], customPropertyCount: 0 },
  pageUrl: 'https://example.com/checkout',
  pageProtocol: 'https:',
} as const satisfies Partial<CheckoutPage>;

/** Default minimal Checkout page with all Adyen-related fields set as safe defaults. */
export function makeCheckoutPage(overrides: Partial<CheckoutPage> = {}): CheckoutPage {
  return { ...EMPTY_PAGE, checkoutInIframe: false, ...overrides };
}

/** Default minimal single-frame page extraction, as the page extractor produces it. */
export function makePageExtract(overrides: Partial<PageExtractResult> = {}): PageExtractResult {
  return { ...EMPTY_PAGE, isInsideIframe: false, ...overrides };
}

/**
 * Creates default Adyen metadata with optional field overrides.
 */
export function makeAdyenMetadata(overrides: Partial<AdyenWebMetadata> = {}): AdyenWebMetadata {
  return {
    version: '5.67.0',
    bundleType: 'esm',
    variants: ['dropin'],
    ...overrides,
  };
}

type CheckoutConfigOverrides = {
  [K in keyof CheckoutConfig]?: CheckoutConfig[K] | undefined;
};

/**
 * Creates a checkout config fixture and drops any override keys set to `undefined`.
 */
export function makeCheckoutConfig(overrides: CheckoutConfigOverrides = {}): CheckoutConfig {
  const base: CheckoutConfig = {
    clientKey: 'test_ABCDEFGHIJK',
    environment: 'test',
    locale: 'en-US',
    countryCode: 'US',
  };

  const merged = { ...base, ...overrides };
  const withoutUndefined = Object.fromEntries(
    Object.entries(merged).filter((entry) => entry[1] !== undefined)
  );
  return withoutUndefined;
}

/**
 * Wraps options as captured from AdyenCheckout or component calls. Pass
 * `complete` when AdyenCheckout's options were captured whole, so options
 * missing from them count as absent.
 */
export function makeCapturedConfig(
  options: CheckoutConfig,
  complete = false
): CapturedCheckoutOptions {
  return { options, complete };
}

/**
 * Creates detected/latest version info for scan fixtures.
 */
export function makeVersionInfo(overrides: Partial<VersionInfo> = {}): VersionInfo {
  return {
    detected: '5.67.0',
    latest: '5.68.0',
    ...overrides,
  };
}

/**
 * Creates checkout analytics fixture data with sensible defaults.
 */
export function makeAnalyticsData(overrides: Partial<AnalyticsData> = {}): AnalyticsData {
  return {
    flavor: 'dropin',
    version: '5.67.0',
    buildType: 'esm',
    locale: 'en-US',
    ...overrides,
  };
}

/** Checkout document headers the scan could not observe. */
export const UNAVAILABLE_DOCUMENT_HEADERS: DocumentHeaders = { status: 'unavailable' };

/** Checkout document headers captured from the tab's own response. */
export function makeDocumentHeaders(
  headers: readonly CapturedHeader[] = [],
  url = 'https://example.com/checkout'
): DocumentHeaders {
  return { status: 'observed', url, source: 'captured', headers };
}

/**
 * Creates a complete scan payload fixture with optional overrides.
 */
export function makeScanPayload(overrides: Partial<ScanPayload> = {}): ScanPayload {
  return {
    tabId: 1,
    pageUrl: 'https://example.com/checkout',
    page: makeCheckoutPage(),
    documentHeaders: makeDocumentHeaders(),
    capturedRequests: [],
    versionInfo: makeVersionInfo(),
    analyticsData: null,
    scannedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a stored scan result fixture with no checks and optional overrides.
 */
export function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  const payload = overrides.payload ?? makeScanPayload();
  return {
    tabId: 1,
    pageUrl: 'https://example.com/checkout',
    scannedAt: '2026-09-28T00:00:00.000Z',
    sdkPresence: { detected: true, source: 'metadata' },
    attributes: readImplementationAttributes(payload),
    checks: [],
    health: { score: 100, passing: 0, failing: 0, warnings: 0, total: 0, tier: 'excellent' },
    standardCompliance: { compliant: false, reasons: [] },
    ...overrides,
    payload,
  };
}

/**
 * Convenience factory for a payload with Adyen metadata and checkout config prefilled.
 */
export function makeAdyenPayload(
  metaOverrides: Partial<AdyenWebMetadata> = {},
  configOverrides: CheckoutConfigOverrides = {},
  payloadOverrides: Partial<ScanPayload> = {}
): ScanPayload {
  return makeScanPayload({
    page: makeCheckoutPage({
      adyenMetadata: makeAdyenMetadata(metaOverrides),
      capturedConfig: makeCapturedConfig(makeCheckoutConfig(configOverrides), true),
    }),
    ...payloadOverrides,
  });
}

/**
 * Creates a captured response header fixture.
 */
export function makeHeader(name: string, value: string): CapturedHeader {
  return { name, value };
}

/**
 * Creates a captured request fixture with overridable fields.
 */
export function makeRequest(
  url: string,
  overrides: Partial<CapturedRequest> = {}
): CapturedRequest {
  return {
    url,
    type: 'script',
    statusCode: 200,
    responseHeaders: [],
    ...overrides,
  };
}
