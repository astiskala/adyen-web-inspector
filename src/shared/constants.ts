/**
 * Shared constants used across all extension components.
 */

import type { CheckoutCapture, HealthScore, IntegrationFlow, Severity } from './types.js';

// ─── Client Key Prefixes ──────────────────────────────────────────────────────

export const CLIENT_KEY_TEST_PREFIX = 'test_';
export const CLIENT_KEY_LIVE_PREFIX = 'live_';
/** Legacy origin key prefix — should be migrated to client key. */
export const ORIGIN_KEY_PREFIX = 'pub.v2.';

// ─── Adyen Translation Locales ───────────────────────────────────────────────

/**
 * Locales available in Adyen Web translations.
 * @see https://github.com/Adyen/adyen-web/tree/522975889a4287fe9c81cc138fcf3457e6bd5a6e/packages/server/translations
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

export const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@adyen/adyen-web';
export const NPM_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Storage Keys ─────────────────────────────────────────────────────────────

export const STORAGE_SCAN_RESULT_PREFIX = 'scan_result_';
export const STORAGE_NPM_CACHE_KEY = 'npm_cache_adyen_web';
export const STORAGE_CHECKOUT_ACTIVITY_PREFIX = 'checkout_activity_';
export const STORAGE_VERSION_PREFIX = 'adyen_version_';

// ─── Page Globals ─────────────────────────────────────────────────────────────

/**
 * Page globals the MAIN-world config interceptor publishes its capture record
 * on, the page extractor reads, and the Chrome adapter collects the
 * extraction from.
 */
export const PAGE_GLOBALS = {
  checkoutCapture: '__adyenWebInspectorCheckoutCapture',
  interceptorInstalled: '__adyenWebInspectorCapturedConfig__installed',
  pageExtractResultJson: '__adyenWebInspectorPageExtractResultJson',
} as const;

/**
 * The page-global contract: what each page global holds. The config
 * interceptor writes the capture record, the page extractor reads it and
 * writes its serialized result. Page scripts can overwrite any of them, so
 * readers still check their shape.
 */
export interface PageGlobalValues {
  /** The config interceptor's capture record for this frame. */
  [PAGE_GLOBALS.checkoutCapture]?: CheckoutCapture;
  [PAGE_GLOBALS.interceptorInstalled]?: boolean;
  /** The page extractor's serialized `PageExtractResult` for this frame. */
  [PAGE_GLOBALS.pageExtractResultJson]?: string;
}

// ─── Version Gates ────────────────────────────────────────────────────────────

/** Minimum major version required for full inspection. Versions below this are blocked. */
export const MIN_SUPPORTED_MAJOR_VERSION = 6;

// ─── UI Constants ─────────────────────────────────────────────────────────────

/** Status colours for the badge and printed report, matching the light palette in base.css. */
export const STATUS_COLORS = {
  pass: '#188038',
  warn: '#f29900',
  fail: '#d93025',
  info: '#1a73e8',
} as const;

/** Colour of each check severity in reports. */
export const SEVERITY_COLORS: Readonly<Record<Severity, string>> = {
  pass: STATUS_COLORS.pass,
  warn: STATUS_COLORS.warn,
  fail: STATUS_COLORS.fail,
  notice: STATUS_COLORS.info,
  info: STATUS_COLORS.info,
  skip: '#6b7280',
};

/** Colour of each health tier, shared by the badge and reports. */
export const HEALTH_TIER_COLORS: Readonly<Record<HealthScore['tier'], string>> = {
  excellent: STATUS_COLORS.pass,
  issues: STATUS_COLORS.warn,
  critical: STATUS_COLORS.fail,
};

/** Display labels for integration flows, shared by every view. */
export const INTEGRATION_FLOW_LABELS: Readonly<Record<IntegrationFlow, string>> = {
  sessions: 'Sessions',
  advanced: 'Advanced',
  unknown: 'Unknown',
};

export const DEVTOOLS_PANEL_TITLE = 'Adyen Inspector';
export const DEVTOOLS_PANEL_ICON_PATH = '';
export const DEVTOOLS_PANEL_PAGE = 'devtools/panel/panel.html';
