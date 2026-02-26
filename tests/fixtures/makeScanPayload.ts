import type {
  ScanPayload,
  PageExtractResult,
  CheckoutConfig,
  AdyenWebMetadata,
  AnalyticsData,
  CapturedHeader,
  CapturedRequest,
  VersionInfo,
} from '../../src/shared/types';

/** Default minimal PageExtractResult with all Adyen-related fields set as safe defaults. */
export function makePageExtract(overrides: Partial<PageExtractResult> = {}): PageExtractResult {
  return {
    adyenMetadata: null,
    checkoutConfig: null,
    scripts: [],
    links: [],
    iframes: [],
    isInsideIframe: false,
    pageUrl: 'https://example.com/checkout',
    pageProtocol: 'https:',
    ...overrides,
  };
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
  return withoutUndefined as CheckoutConfig;
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

/**
 * Creates a complete scan payload fixture with optional overrides.
 */
export function makeScanPayload(overrides: Partial<ScanPayload> = {}): ScanPayload {
  return {
    tabId: 1,
    pageUrl: 'https://example.com/checkout',
    page: makePageExtract(),
    mainDocumentHeaders: [],
    capturedRequests: [],
    versionInfo: makeVersionInfo(),
    analyticsData: null,
    scannedAt: new Date().toISOString(),
    ...overrides,
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
    page: makePageExtract({
      adyenMetadata: makeAdyenMetadata(metaOverrides),
      checkoutConfig: makeCheckoutConfig(configOverrides),
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
