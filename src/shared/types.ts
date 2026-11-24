/**
Core type definitions shared across all extension components.
This module must not import from background/, content/, popup/, or devtools/.
*/

// ─── Severity ────────────────────────────────────────────────────────────────

export type Severity = 'pass' | 'warn' | 'fail' | 'notice' | 'info' | 'skip';
export type CheckImpact = 'high' | 'medium' | 'low' | 'manual';

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
  | 'uplift-cobadged-version'
  // Environment & Region
  | 'env-region'
  | 'env-cdn-mismatch'
  | 'env-region-mismatch'
  | 'env-key-mismatch'
  | 'env-not-iframe'
  // Auth
  | 'auth-client-key'
  | 'auth-client-key-rejected'
  | 'auth-country-code'
  | 'auth-locale'
  // Callbacks
  | 'flow-type'
  | 'callback-on-submit'
  | 'callback-on-submit-filtering'
  | 'callback-on-submit-state-data'
  | 'callback-on-submit-state-data-fields'
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
  | 'risk-card-holder-name'
  // Security
  | 'security-https'
  | 'security-sri-script'
  | 'security-sri-css'
  | 'security-csp-present'
  | 'security-csp-script-src'
  | 'security-csp-frame-src'
  | 'security-csp-connect-src'
  | 'security-csp-img-src'
  | 'security-csp-form-action'
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
  | '3p-no-sri'
  | '3p-cookiebot-auto-blocking'
  // API Key Exposure
  | 'security-api-key-exposed'
  // Styling
  | 'styling-css-custom-props'
  // v6 Upgrade Deprecations
  | 'v6-deprecated-properties'
  | 'v6-deprecated-callbacks';

// ─── Check Result ─────────────────────────────────────────────────────────────

export interface CheckResult {
  readonly id: CheckId;
  readonly category: CheckCategory;
  readonly severity: Severity;
  readonly impact?: CheckImpact;
  /**
  One-sentence plain-language finding visible to all users.
  */
  readonly title: string;
  /**
  Optional technical detail, shown on expansion.
  */
  readonly detail?: string;
  /**
  Optional remediation guidance, sometimes with an example.
  */
  readonly remediation?: string;
  /**
  Optional reference link (Adyen or other relevant documentation).
  */
  readonly docsUrl?: string;
}

// ─── Check Interface ──────────────────────────────────────────────────────────

export interface Check {
  readonly id: CheckId;
  readonly category: CheckCategory;
  run: (payload: ScanPayload, conclusions: ScanConclusions) => CheckResult;
}

/**
What the scan assessment concludes from a scan payload before any check
runs. It is derived once per scan, and every check reads the same record.
*/
export type ScanConclusions = Pick<ScanResult, 'sdkPresence' | 'attributes'>;

// ─── SDK Metadata (from window.AdyenWebMetadata) ─────────────────────────────

export interface AdyenWebMetadata {
  readonly version?: string;
  /**
  For example, 'auto', 'umd', or 'esm'.
  */
  readonly bundleType?: string;
  readonly variants?: string[];
}

// ─── Analytics Data (from checkout analytics POST bodies) ─────────────────────

/**
SDK fields Adyen Web reports in its checkout analytics setup and event bodies.
*/
export interface AnalyticsData {
  /**
  Integration flavor reported by the SDK: 'dropin', 'components', or 'custom'.
  */
  readonly flavor?: string;
  /**
  SDK version string, e.g. '6.31.1'.
  */
  readonly version?: string;
  /**
  Build type, e.g. 'esm', 'eslegacy', 'umd'.
  */
  readonly buildType?: string;
  /**
  Channel, e.g. 'Web'.
  */
  readonly channel?: string;
  /**
  Platform, e.g. 'Web'.
  */
  readonly platform?: string;
  /**
  Locale, e.g. 'en-US'.
  */
  readonly locale?: string;
  /**
  Session ID — presence indicates Sessions integration flow.
  */
  readonly sessionId?: string;
}

// ─── Page Extraction Result ───────────────────────────────────────────────────

export interface ScriptTag {
  readonly src: string;
  readonly integrity?: string;
  readonly crossorigin?: string;
  readonly blockingMode?: string;
  /**
  The script's nonce, read from the element because browsers hide the attribute, to match CSP nonce sources.
  */
  readonly nonce?: string;
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
  /**
  HTTP status from Resource Timing; absent when the browser does not expose it.
  */
  readonly responseStatus?: number;
}

/**
CSS styling information detected on the page for Adyen components.
*/
export interface AdyenStyleInfo {
  /**
  Number of non-Adyen CSS rules targeting .adyen-checkout__* selectors (class overrides).
  */
  readonly classOverrideCount: number;
  /**
  Sample selectors that override Adyen classes (up to 5).
  */
  readonly classOverrideSelectors: readonly string[];
  /**
  Number of CSS rules setting --adyen-sdk-* custom properties.
  */
  readonly customPropertyCount: number;
}

/**
Options captured directly from AdyenCheckout or component calls.
*/
export interface CapturedCheckoutOptions {
  readonly options: CheckoutConfig;
  /**
  True when AdyenCheckout's options were captured whole, so options missing from them are absent.
  */
  readonly complete: boolean;
}

/**
The partial signal an inferred configuration value was read from.
*/
export type InferenceSignal = 'adyen-request' | 'page-json';

/**
A component's latest analytics `rendered` event that reported its pay button.
*/
export interface RenderedComponent {
  /**
  Component type, such as `paypal`, `scheme`, or `dropin`.
  */
  readonly type: string;
  /**
  The showPayButton value the component rendered with, after inheriting AdyenCheckout's.
  */
  readonly showPayButton: boolean;
  /**
  True when the component was rendered with `_disableClickToPay: true`.
  */
  readonly clickToPayDisabled?: true;
}

/**
Checkout analytics: what Adyen Web's own analytics request bodies reported,
read the same way whether the page or the Scan's network capture saw them.
*/
export interface CheckoutAnalytics {
  /**
  SDK fields of setup and event bodies; later bodies win per field.
  */
  readonly sdk: AnalyticsData;
  /**
  The latest `rendered` event per component type, oldest first.
  */
  readonly rendered: readonly RenderedComponent[];
  /**
  Component types any info event named, and the payment methods Drop-in listed as available.
  */
  readonly paymentMethods: readonly string[];
}

/**
The capture record: everything the config interceptor observed in one
frame, published on a page global for the page extractor.
*/
export interface CheckoutCapture {
  readonly captured: CapturedCheckoutOptions | null;
  /**
  Values inferred from partial signals, per signal; newer values win within a signal.
  */
  readonly inferred: Readonly<Partial<Record<InferenceSignal, CheckoutConfig>>>;
  /**
  Number of AdyenCheckout initialisations.
  */
  readonly initCount: number;
  /**
  What the page's Adyen checkout analytics requests reported.
  */
  readonly analytics: CheckoutAnalytics;
}

/**
Checkout configuration as observed, by source. Only configuration evidence
(shared/scan-evidence.ts) reads it; everything else asks that module.
*/
export interface ObservedCheckoutConfig {
  /**
  Options captured from AdyenCheckout and component calls; null when none were.
  */
  readonly captured: CapturedCheckoutOptions | null;
  /**
  Config found in mounted Adyen Preact trees (including bundled integrations).
  */
  readonly component: CheckoutConfig | null;
  /**
  Values inferred from partial signals: Adyen request URLs (such as environment,
  clientKey, and locale) and option-shaped JSON the page parsed, which any page
  data can carry.
  */
  readonly inferred: Readonly<Partial<Record<InferenceSignal, CheckoutConfig>>>;
}

/**
One frame's page extraction, produced by the page extractor in each accessible frame.
*/
export interface PageExtractResult {
  readonly adyenMetadata: AdyenWebMetadata | null;
  readonly observedConfig: ObservedCheckoutConfig;
  /**
  Number of vnode mount points whose trees exposed Adyen core options.
  */
  readonly componentMountCount?: number;
  /**
  What the frame's Adyen checkout analytics requests reported; absent when none reported anything.
  */
  readonly analytics?: CheckoutAnalytics;
  /**
  True when a `.adyen-checkout__dropin` element is present in the DOM.
  */
  readonly hasDropinDOM?: boolean;
  /**
  True when a `.adyen-checkout__card-input` Card component element is present.
  */
  readonly hasCardDOM?: boolean;
  /**
  True when a new-card (not stored-card) Card form is rendered.
  */
  readonly hasNewCardFormDOM?: boolean;
  /**
  True when the Card component renders its cardholder name field.
  */
  readonly hasCardHolderNameDOM?: boolean;
  readonly scripts: ScriptTag[];
  readonly links: LinkTag[];
  readonly iframes: IframeInfo[];
  /**
  Resource timing entries observed in the current document.
  */
  readonly observedRequests?: ObservedRequest[];
  /**
  Number of times AdyenCheckout has been initialised.
  */
  readonly checkoutInitCount?: number;
  /**
  True when an Adyen API key pattern was found in inline scripts or config.
  */
  readonly apiKeyDetected?: boolean;
  /**
  CSS styling info for Adyen components (class overrides vs custom properties).
  */
  readonly adyenStyles: AdyenStyleInfo;
  /**
  True when this frame is not the top-level document.
  */
  readonly isInsideIframe: boolean;
  readonly pageUrl: string;
  readonly pageProtocol: string;
}

/**
Fields of the Checkout page that the frame merge reads from more than the selected frame.
*/
type MergedFrameField =
  | 'adyenMetadata'
  | 'observedConfig'
  | 'analytics'
  | 'hasDropinDOM'
  | 'hasCardDOM'
  | 'hasNewCardFormDOM'
  | 'hasCardHolderNameDOM'
  | 'apiKeyDetected'
  | 'isInsideIframe';

/**
The Checkout page: every accessible frame's page extraction merged into one
view. Fields come from the selected frame, the frame with the strongest
checkout signals, unless their comment names a wider scope.
*/
export interface CheckoutPage extends Omit<PageExtractResult, MergedFrameField> {
  /**
  Selected frame, else the first frame that exposed SDK metadata.
  */
  readonly adyenMetadata: AdyenWebMetadata | null;
  /**
  All frames; earlier frames win per field, and captured options are complete when any frame's are.
  */
  readonly observedConfig: ObservedCheckoutConfig;
  /**
  All frames; earlier frames win per SDK field and rendered component type, and payment methods
  are combined. The page's evidence only: checks read the Scan's reading, `ScanPayload.analytics`.
  */
  readonly analytics?: CheckoutAnalytics;
  /**
  Selected frame or any merchant frame: a `.adyen-checkout__dropin` element is present.
  */
  readonly hasDropinDOM?: boolean;
  /**
  Selected frame or any merchant frame: a `.adyen-checkout__card-input` Card element is present.
  */
  readonly hasCardDOM?: boolean;
  /**
  Selected frame or any merchant frame: a new-card (not stored-card) Card form is rendered.
  */
  readonly hasNewCardFormDOM?: boolean;
  /**
  Selected frame or any merchant frame: the Card component renders its cardholder name field.
  */
  readonly hasCardHolderNameDOM?: boolean;
  /**
  All frames: an Adyen API key pattern was found in inline scripts or config.
  */
  readonly apiKeyDetected?: boolean;
  /**
  Merchant frames: checkout runs inside a merchant iframe rather than the top-level document.
  */
  readonly checkoutInIframe: boolean;
}

// ─── Checkout Config (detected from page) ────────────────────────────────────

/**
Where a callback was registered:
- `'checkout'` — on the AdyenCheckout instance (recommended).
- `'component'` — on a component such as Card or Dropin.
*/
export type CallbackSource = 'checkout' | 'component';

export interface CheckoutConfig {
  readonly clientKey?: string;
  readonly environment?: string;
  readonly locale?: string;
  readonly countryCode?: string;
  readonly riskEnabled?: boolean;
  /**
  Derived from checkout config analytics.enabled when present.
  */
  readonly analyticsEnabled?: boolean;
  readonly onSubmit?: CallbackSource;
  readonly onAdditionalDetails?: CallbackSource;
  readonly onPaymentCompleted?: CallbackSource;
  readonly onPaymentFailed?: CallbackSource;
  readonly onError?: CallbackSource;
  readonly beforeSubmit?: CallbackSource;
  /**
  Every distinct captured onSubmit function source, AdyenCheckout's first, each cut to 1,200 characters.
  */
  readonly onSubmitSources?: readonly string[];
  /**
  Every distinct captured beforeSubmit function source, AdyenCheckout's first, each cut to 1,200 characters.
  */
  readonly beforeSubmitSources?: readonly string[];
  /**
  True when a session object was detected in the checkout configuration (Sessions flow indicator).
  */
  readonly hasSession?: boolean;
  /**
  When true, Adyen Web performs redirects in the top-level window when checkout runs in an iframe.
  */
  readonly redirectFromTopWhenInIframe?: boolean;
  /**
  AdyenCheckout-level showPayButton, which every component inherits unless it sets its own.
  */
  readonly showPayButton?: boolean;
  /**
  Payment method types whose `paymentMethodsConfiguration` entry sets `showPayButton: false`.
  */
  readonly hiddenPayButtonMethods?: readonly string[];
  // ─── v6 Deprecated Properties ───────────────────────────────────────────────
  /**
  Deprecated in v6: use disableFinalAnimation instead.
  */
  readonly setStatusAutomatically?: boolean;
  /**
  Deprecated in v6: must be set in Card config, not globally. Presence-only flag.
  */
  readonly installmentOptions?: true;
  /**
  Deprecated in v6: no longer used.
  */
  readonly showBrandsUnderCardNumber?: boolean;
  /**
  Deprecated in v6: no longer used.
  */
  readonly showFormInstruction?: boolean;
  /**
  Deprecated in v6: removed, should be deleted from config.
  */
  readonly onValid?: CallbackSource;
  /**
  Deprecated in v6: renamed to onOrderUpdated.
  */
  readonly onOrderCreated?: CallbackSource;
  /**
  Deprecated in v6 (PayPal): use onShippingAddressChange + onShippingOptionsChange.
  */
  readonly onShippingChange?: CallbackSource;
  /**
  Deprecated in v6 (PayPal): renamed to onAuthorized.
  */
  readonly onShopperDetails?: CallbackSource;
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

/**
The browser signal that established the running SDK version, strongest first.
*/
export type SdkVersionSource = 'metadata' | 'analytics' | 'script-url' | 'request-url' | 'bundle';

export interface VersionInfo {
  readonly detected: string | null;
  /**
  Signal that produced the detected version; absent when no version was detected.
  */
  readonly source?: SdkVersionSource;
  readonly latest: string | null;
  /**
  ISO timestamp when the detected version was published to npm, when known.
  */
  readonly detectedReleasedAt?: string;
}

/**
The checkout document's response headers. Unavailable means neither the
tab's response nor a separate request exposed them, so header checks cannot
tell a missing header from an unseen one.
*/
export type DocumentHeaders =
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'observed';
      /**
      URL of the document the headers belong to.
      */
      readonly url: string;
      /**
      `captured`: the tab's own response during the scan; `fetched`: a separate request for the URL.
      */
      readonly source: 'captured' | 'fetched';
      readonly headers: readonly CapturedHeader[];
    };

export interface ScanPayload {
  readonly tabId: number;
  readonly pageUrl: string;
  readonly page: CheckoutPage;
  readonly documentHeaders: DocumentHeaders;
  readonly capturedRequests: CapturedRequest[];
  readonly versionInfo: VersionInfo;
  /**
  Checkout analytics the page reported, then the bodies the Scan observed on the network; null
  when no body reported anything.
  */
  readonly analytics: CheckoutAnalytics | null;
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

export interface StandardCompliance {
  readonly compliant: boolean;
  readonly reasons: readonly string[];
}

/**
Whether Adyen Web is loaded on the page; distinct from checkout activity.
*/
export interface SdkPresence {
  readonly detected: boolean;
  readonly source: 'metadata' | 'adyen-script' | 'none';
}

// ─── Implementation Attributes ───────────────────────────────────────────────

export type AdyenEnvironment = 'test' | 'live' | 'live-in';
export type AdyenRegion = 'APSE' | 'AU' | 'IN' | 'EU' | 'NEA' | 'US' | 'unknown';
export type IntegrationFlavor = 'Drop-in' | 'Components' | 'Custom' | 'Unknown';
export type IntegrationFlow = 'sessions' | 'advanced' | 'unknown';
type ImportMethod = 'CDN' | 'Adyen' | 'Unknown';

/**
Signals that establish the integration flow.
*/
interface IntegrationFlowSignals {
  readonly hasSessionsRequest: boolean;
  readonly hasSessionConfig: boolean;
  readonly hasAnalyticsSessionId: boolean;
  readonly hasCheckoutConfig: boolean;
  readonly hasAnalyticsData: boolean;
}

/**
What the Scan concluded about how the integration is built, each with the
signal it came from. Derived once per scan payload; checks, the Standard
Drop-in frontend assessment, views, and reports all read the same record.
*/
export interface ImplementationAttributes {
  readonly flavor: {
    readonly value: IntegrationFlavor;
    readonly source:
      | 'analytics'
      | 'dropin-pattern'
      | 'dropin-dom'
      | 'checkout-config'
      | 'sdk-loaded-no-checkout'
      | 'unknown';
  };
  readonly flow: { readonly value: IntegrationFlow; readonly signals: IntegrationFlowSignals };
  readonly environment: {
    /**
    Strongest environment: checkout configuration, then client key prefix, then API and analytics traffic.
    */
    readonly value: AdyenEnvironment | null;
    readonly source: 'config' | 'client-key' | 'network' | 'unknown';
    /**
    Environment of Adyen CDN asset hosts, independent of configuration.
    */
    readonly cdn: AdyenEnvironment | null;
    /**
    Environment of the strongest observed client key's prefix.
    */
    readonly clientKey: AdyenEnvironment | null;
    /**
    Environment of Adyen API and analytics hosts.
    */
    readonly network: AdyenEnvironment | null;
  };
  readonly region: {
    /**
    Configured region, else the region of Adyen API and analytics hosts.
    */
    readonly value: AdyenRegion;
    readonly source: 'config' | 'network' | 'unknown';
    /**
    Region of regional Adyen CDN asset hosts.
    */
    readonly cdn: AdyenRegion;
  };
  /**
  Visible Adyen-hosted script origin; other import methods stay unknown.
  */
  readonly importMethod: ImportMethod;
  /**
  Observable signs of an active checkout, distinct from SDK presence.
  */
  readonly checkoutActivity: boolean;
}

export interface ScanResult {
  readonly tabId: number;
  readonly pageUrl: string;
  readonly scannedAt: string;
  readonly sdkPresence: SdkPresence;
  readonly attributes: ImplementationAttributes;
  readonly checks: CheckResult[];
  readonly health: HealthScore;
  readonly standardCompliance: StandardCompliance;
  readonly payload: ScanPayload;
}
