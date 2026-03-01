/**
 * Core type definitions shared across all extension components.
 * This module must not import from background/, content/, popup/, or devtools/.
 */

// ─── Severity ────────────────────────────────────────────────────────────────

export type Severity = 'pass' | 'warn' | 'fail' | 'notice' | 'info' | 'skip';

// ─── Check Categories ─────────────────────────────────────────────────────────

export type CheckCategory =
  | 'sdk-identity'
  | 'version-lifecycle'
  | 'environment'
  | 'auth'
  | 'callbacks'
  | 'risk'
  | 'security'
  | 'third-party';

// ─── Check IDs ───────────────────────────────────────────────────────────────

export type CheckId =
  // SDK Identity
  | 'sdk-detected'
  | 'sdk-flavor'
  | 'sdk-import-method'
  | 'sdk-bundle-type'
  | 'sdk-analytics'
  | 'sdk-multi-init'
  // Version & Lifecycle
  | 'version-detected'
  | 'version-latest'
  // Environment & Region
  | 'env-region'
  | 'env-cdn-mismatch'
  | 'env-region-mismatch'
  | 'env-key-mismatch'
  | 'env-not-iframe'
  // Auth
  | 'auth-client-key'
  | 'auth-country-code'
  | 'auth-locale'
  // Callbacks
  | 'flow-type'
  | 'callback-on-submit'
  | 'callback-on-submit-filtering'
  | 'callback-on-additional-details'
  | 'callback-on-payment-completed'
  | 'callback-on-payment-failed'
  | 'callback-on-error'
  | 'callback-before-submit'
  | 'callback-actions-pattern'
  | 'callback-multiple-submissions'
  | 'callback-custom-pay-button-compatibility'
  // Risk
  | 'risk-df-iframe'
  | 'risk-module-not-disabled'
  // Security
  | 'security-https'
  | 'security-sri-script'
  | 'security-sri-css'
  | 'security-csp-present'
  | 'security-csp-script-src'
  | 'security-csp-frame-src'
  | 'security-csp-frame-ancestors'
  | 'security-csp-reporting'
  | 'security-referrer-policy'
  | 'security-x-content-type'
  | 'security-xss-protection'
  | 'security-hsts'
  | 'security-iframe-referrerpolicy'
  // Third-party Scripts
  | '3p-tag-manager'
  | '3p-session-replay'
  | '3p-ad-pixels'
  | '3p-no-sri';

// ─── Check Result ─────────────────────────────────────────────────────────────

export interface CheckResult {
  readonly id: CheckId;
  readonly category: CheckCategory;
  readonly severity: Severity;
  /** One-sentence plain-language finding visible to all users. */
  readonly title: string;
  /** Optional technical detail, shown on expansion. */
  readonly detail?: string;
  /** Optional remediation guidance with code snippet. */
  readonly remediation?: string;
  /** Link to official Adyen docs. */
  readonly docsUrl?: string;
}

// ─── Check Interface ──────────────────────────────────────────────────────────

export interface Check {
  readonly id: CheckId;
  readonly category: CheckCategory;
  run(payload: ScanPayload): CheckResult;
}

// ─── SDK Metadata (from window.AdyenWebMetadata) ─────────────────────────────

export interface AdyenWebMetadata {
  readonly version?: string;
  /** e.g. 'auto', 'umd', 'esm' */
  readonly bundleType?: string;
  readonly variants?: string[];
}

// ─── Analytics Data (from checkout analytics POST bodies) ─────────────────────

/** Fields extracted from Adyen checkout analytics requests (setup + event POSTs). */
export interface AnalyticsData {
  /** Integration flavor reported by the SDK: 'dropin', 'components', or 'custom'. */
  readonly flavor?: string;
  /** SDK version string, e.g. '6.31.1'. */
  readonly version?: string;
  /** Build type, e.g. 'esm', 'eslegacy', 'umd'. */
  readonly buildType?: string;
  /** Channel, e.g. 'Web'. */
  readonly channel?: string;
  /** Platform, e.g. 'Web'. */
  readonly platform?: string;
  /** Locale, e.g. 'en-US'. */
  readonly locale?: string;
  /** Session ID — presence indicates Sessions integration flow. */
  readonly sessionId?: string;
}

// ─── Page Extraction Result ───────────────────────────────────────────────────

export interface ScriptTag {
  readonly src: string;
  readonly integrity?: string;
  readonly crossorigin?: string;
}

export interface LinkTag {
  readonly href: string;
  readonly rel: string;
  readonly integrity?: string;
  readonly crossorigin?: string;
}

export interface IframeInfo {
  readonly name?: string;
  readonly src?: string;
  readonly referrerpolicy?: string;
}

export interface ObservedRequest {
  readonly url: string;
  readonly initiatorType?: string;
}

export interface PageExtractResult {
  readonly adyenMetadata: AdyenWebMetadata | null;
  /** Serialised checkout config object (best-effort, may be null) */
  readonly checkoutConfig: CheckoutConfig | null;
  /** Configuration inferred from partial sources like network signals. */
  readonly inferredConfig: CheckoutConfig | null;
  readonly scripts: ScriptTag[];
  readonly links: LinkTag[];
  readonly iframes: IframeInfo[];
  /** Resource timing entries observed in the current document. */
  readonly observedRequests?: ObservedRequest[];
  /** Number of times AdyenCheckout has been initialised. */
  readonly checkoutInitCount?: number;
  readonly isInsideIframe: boolean;
  readonly pageUrl: string;
  readonly pageProtocol: string;
}

// ─── Checkout Config (detected from page) ────────────────────────────────────

/**
 * Where a callback was registered:
 * - `'checkout'` — on the AdyenCheckout instance (recommended).
 * - `'component'` — on a component such as Card or Dropin.
 */
export type CallbackSource = 'checkout' | 'component';

export interface CheckoutConfig {
  readonly clientKey?: string;
  readonly environment?: string;
  readonly locale?: string;
  readonly countryCode?: string;
  readonly riskEnabled?: boolean;
  /** Derived from checkout config analytics.enabled when present. */
  readonly analyticsEnabled?: boolean;
  readonly onSubmit?: CallbackSource;
  readonly onAdditionalDetails?: CallbackSource;
  readonly onPaymentCompleted?: CallbackSource;
  readonly onPaymentFailed?: CallbackSource;
  readonly onError?: CallbackSource;
  readonly beforeSubmit?: CallbackSource;
  /** Captured source of onSubmit as string for static analysis */
  readonly onSubmitSource?: string;
  /** Captured source of beforeSubmit as string for static analysis */
  readonly beforeSubmitSource?: string;
  /** True when a session object was detected in the checkout configuration (Sessions flow indicator). */
  readonly hasSession?: boolean;
}

// ─── Network Captures ─────────────────────────────────────────────────────────

export interface CapturedHeader {
  readonly name: string;
  readonly value: string;
}

export interface CapturedRequest {
  readonly url: string;
  readonly type: 'main_frame' | 'script' | 'stylesheet' | 'other';
  readonly responseHeaders: CapturedHeader[];
  readonly statusCode: number;
}

// ─── Scan Payload ─────────────────────────────────────────────────────────────

export interface VersionInfo {
  readonly detected: string | null;
  readonly latest: string | null;
}

export interface ScanPayload {
  readonly tabId: number;
  readonly pageUrl: string;
  readonly page: PageExtractResult;
  readonly mainDocumentHeaders: CapturedHeader[];
  readonly capturedRequests: CapturedRequest[];
  readonly versionInfo: VersionInfo;
  /** Data extracted from Adyen checkout analytics POST requests (merged from multiple calls). */
  readonly analyticsData: AnalyticsData | null;
  readonly scannedAt: string; // ISO 8601
}

// ─── Scan Result ─────────────────────────────────────────────────────────────

export interface HealthScore {
  readonly score: number; // 0-100
  readonly passing: number;
  readonly failing: number;
  readonly warnings: number;
  readonly total: number;
  readonly tier: 'excellent' | 'issues' | 'critical';
}

export interface ScanResult {
  readonly tabId: number;
  readonly pageUrl: string;
  readonly scannedAt: string;
  readonly checks: CheckResult[];
  readonly health: HealthScore;
  readonly payload: ScanPayload;
}
