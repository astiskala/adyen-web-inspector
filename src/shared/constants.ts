/**
 * Shared constants used across all extension components.
 */

// ─── Adyen Host Suffixes ──────────────────────────────────────────────────────

export const ADYEN_CDN_HOST_SUFFIX = '.cdn.adyen.com';
export const ADYEN_HOST_SUFFIX = '.adyen.com';
export const ADYEN_PAYMENTS_HOST_SUFFIX = '.adyenpayments.com';

// ─── Adyen Checkout Domains ───────────────────────────────────────────────────

/** Static checkout assets hosted on CDN origins (`*.cdn.adyen.com`). */
export const ADYEN_CDN_DOMAINS = [
  'checkoutshopper-live-apse.cdn.adyen.com',
  'checkoutshopper-live-au.cdn.adyen.com',
  'checkoutshopper-live-in.cdn.adyen.com',
  'checkoutshopper-live-nea.cdn.adyen.com',
  'checkoutshopper-live-us.cdn.adyen.com',
  'checkoutshopper-live.cdn.adyen.com',
  'checkoutshopper-test.cdn.adyen.com',
] as const;

/** Checkoutshopper origins without `cdn` that may serve API interactions. */
export const ADYEN_CHECKOUTSHOPPER_DOMAINS = [
  'checkoutshopper-live-apse.adyen.com',
  'checkoutshopper-live-au.adyen.com',
  'checkoutshopper-live-in.adyen.com',
  'checkoutshopper-live-nea.adyen.com',
  'checkoutshopper-live-us.adyen.com',
  'checkoutshopper-live.adyen.com',
  'checkoutshopper-test.adyen.com',
] as const;

export const ADYEN_API_DOMAINS = [
  'checkout-live-apse.adyenpayments.com',
  'checkout-live-au.adyenpayments.com',
  'checkout-live-in.adyenpayments.com',
  'checkout-live-nea.adyenpayments.com',
  'checkout-live-us.adyenpayments.com',
  'checkout-live.adyenpayments.com',
  'checkout-test.adyen.com',
] as const;

const ADYEN_ANALYTICS_DOMAINS = [
  'checkoutanalytics-live.adyen.com',
  'checkoutanalytics-test.adyen.com',
] as const;

export const ANALYTICS_URL_PATTERNS = [
  '*://checkoutanalytics-live.adyen.com/*',
  '*://checkoutanalytics-test.adyen.com/*',
] as const;

export const ALL_ADYEN_DOMAINS = [
  ...ADYEN_CDN_DOMAINS,
  ...ADYEN_CHECKOUTSHOPPER_DOMAINS,
  ...ADYEN_API_DOMAINS,
  ...ADYEN_ANALYTICS_DOMAINS,
] as const;

// ─── Client Key Prefixes ──────────────────────────────────────────────────────

export const CLIENT_KEY_TEST_PREFIX = 'test_';
export const CLIENT_KEY_LIVE_PREFIX = 'live_';
/** Legacy origin key prefix — should be migrated to client key */
export const ORIGIN_KEY_PREFIX = 'pub.v2.';

// ─── Environment URLs ─────────────────────────────────────────────────────────

export type AdyenEnvironment = 'test' | 'live';
export type AdyenRegion = 'APSE' | 'AU' | 'IN' | 'EU' | 'NEA' | 'US' | 'unknown';

export const ENVIRONMENT_REGION_MAP: Record<string, AdyenRegion> = {
  'checkout-live-apse.adyenpayments.com': 'APSE',
  'checkout-live-au.adyenpayments.com': 'AU',
  'checkout-live-in.adyenpayments.com': 'IN',
  'checkout-live-nea.adyenpayments.com': 'NEA',
  'checkout-live-us.adyenpayments.com': 'US',
  'checkout-live.adyenpayments.com': 'EU',
  'checkout-test.adyen.com': 'EU',
  'checkoutshopper-live-apse.adyen.com': 'APSE',
  'checkoutshopper-live-apse.cdn.adyen.com': 'APSE',
  'checkoutshopper-live-au.adyen.com': 'AU',
  'checkoutshopper-live-au.cdn.adyen.com': 'AU',
  'checkoutshopper-live-in.adyen.com': 'IN',
  'checkoutshopper-live-in.cdn.adyen.com': 'IN',
  'checkoutshopper-live-nea.adyen.com': 'NEA',
  'checkoutshopper-live-nea.cdn.adyen.com': 'NEA',
  'checkoutshopper-live-us.adyen.com': 'US',
  'checkoutshopper-live-us.cdn.adyen.com': 'US',
  'checkoutshopper-live.adyen.com': 'EU',
  'checkoutshopper-live.cdn.adyen.com': 'EU',
  'checkoutshopper-test.adyen.com': 'EU',
  'checkoutshopper-test.cdn.adyen.com': 'EU',
};

// ─── Adyen Translation Locales ───────────────────────────────────────────────

/**
 * Locales available in Adyen Web translations.
 * Source (pinned): https://github.com/Adyen/adyen-web/tree/522975889a4287fe9c81cc138fcf3457e6bd5a6e/packages/server/translations
 */
export const ADYEN_WEB_TRANSLATION_LOCALES = [
  'ar',
  'bg-BG',
  'ca-ES',
  'cs-CZ',
  'da-DK',
  'de-DE',
  'el-GR',
  'en-US',
  'es-ES',
  'et-EE',
  'fi-FI',
  'fr-FR',
  'hr-HR',
  'hu-HU',
  'is-IS',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'lt-LT',
  'lv-LV',
  'nl-NL',
  'no-NO',
  'pl-PL',
  'pt-BR',
  'pt-PT',
  'ro-RO',
  'ru-RU',
  'sk-SK',
  'sl-SI',
  'sv-SE',
  'zh-CN',
  'zh-TW',
] as const;

// ─── Sessions API Pattern ─────────────────────────────────────────────────────

export const SESSIONS_API_PATTERN = /\/v\d+\/sessions/;

// ─── Third-party Script Patterns ──────────────────────────────────────────────

export const SESSION_REPLAY_PATTERNS = [
  { name: 'Hotjar', pattern: /hotjar\.com|hjid|hjsv/ },
  { name: 'FullStory', pattern: /fullstory\.com|FS\.identify/ },
  { name: 'Microsoft Clarity', pattern: /clarity\.ms/ },
  { name: 'Mouseflow', pattern: /mouseflow\.com/ },
  { name: 'LogRocket', pattern: /logrocket\.com|LogRocket\.init/ },
  { name: 'Inspectlet', pattern: /inspectlet\.com/ },
  { name: 'Smartlook', pattern: /smartlook\.com/ },
] as const;

export const TAG_MANAGER_PATTERNS = [
  { name: 'Google Tag Manager', pattern: /googletagmanager\.com|gtm\.js/ },
  { name: 'Tealium', pattern: /tealiumiq\.com|utag\.js/ },
  { name: 'Adobe Launch', pattern: /assets\.adobedtm\.com/ },
  { name: 'Segment', pattern: /segment\.com|analytics\.js/ },
] as const;

export const ANALYTICS_PATTERNS = [
  { name: 'Google Analytics', pattern: /google-analytics\.com\/analytics\.js|gtag\/js/ },
  { name: 'GA4', pattern: /googletagmanager\.com\/gtag\/js/ },
] as const;

export const AD_PIXEL_PATTERNS = [
  { name: 'Meta Pixel', pattern: /connect\.facebook\.net|fbq\(/ },
  { name: 'TikTok Pixel', pattern: /analytics\.tiktok\.com/ },
  { name: 'LinkedIn Insight', pattern: /snap\.licdn\.com/ },
  { name: 'Twitter/X Pixel', pattern: /static\.ads-twitter\.com/ },
] as const;

// ─── Risk Module ──────────────────────────────────────────────────────────────

export const DF_IFRAME_NAME = 'dfIframe';
export const DF_IFRAME_URL_PATTERN = /dfp\.[^/]+\.html/;

// ─── NPM Registry ─────────────────────────────────────────────────────────────

export const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@adyen/adyen-web/latest';
export const NPM_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Storage Keys ─────────────────────────────────────────────────────────────

export const STORAGE_SCAN_RESULT_PREFIX = 'scan_result_';
export const STORAGE_NPM_CACHE_KEY = 'npm_cache_adyen_web';
export const STORAGE_DETECTED_PREFIX = 'adyen_detected_';
export const STORAGE_VERSION_PREFIX = 'adyen_version_';

// ─── Version Gates ────────────────────────────────────────────────────────────

/** Minimum major version required for full inspection. Versions below this are blocked. */
export const MIN_SUPPORTED_MAJOR_VERSION = 6;

// ─── UI Constants ─────────────────────────────────────────────────────────────

export const DEVTOOLS_PANEL_TITLE = 'Adyen Inspector';
export const DEVTOOLS_PANEL_ICON_PATH = '';
export const DEVTOOLS_PANEL_PAGE = 'devtools/panel/panel.html';
