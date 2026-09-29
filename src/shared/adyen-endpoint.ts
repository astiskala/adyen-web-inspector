/**
 * Adyen endpoint — what a URL means to Adyen Web: whether its host is Adyen's,
 * the role it plays (CDN assets, checkoutshopper, Checkout API, analytics),
 * and the environment and region its host names. It also resolves the origins
 * Adyen Web derives from its `environment` option, and reads Adyen Web API and
 * translation paths.
 *
 * Content scripts bundle this module inline, so it must not depend on
 * anything but types.
 */

import type { AdyenEnvironment, AdyenRegion } from './types.js';

/** The part an Adyen host plays for Adyen Web. */
type AdyenEndpointRole = 'cdn' | 'checkoutshopper' | 'checkout-api' | 'analytics' | 'other';

/** An Adyen host read as an Adyen Web endpoint. */
export interface AdyenEndpoint {
  readonly role: AdyenEndpointRole;
  /** Environment the host names, such as live in checkoutshopper-live; null when it names none. */
  readonly environment: AdyenEnvironment | null;
  /** Live region the host names, such as US in checkoutshopper-live-us; null when it names none. */
  readonly namedRegion: AdyenRegion | null;
}

/** Origins Adyen Web uses for API calls, CDN images and translations, and checkout analytics. */
export interface AdyenWebOrigins {
  readonly api: string;
  readonly cdn: string;
  readonly analytics: string;
}

const REGION_TOKENS: Readonly<Record<string, AdyenRegion>> = {
  eu: 'EU',
  us: 'US',
  au: 'AU',
  apse: 'APSE',
  in: 'IN',
  nea: 'NEA',
};

const CHECKOUT_ROLES: ReadonlySet<AdyenEndpointRole> = new Set([
  'cdn',
  'checkoutshopper',
  'checkout-api',
  'analytics',
]);

/** A test or live label, optionally with a region token, as in checkout-live-us.adyenpayments.com. */
const ENVIRONMENT_LABEL = /(?:^|[.-])(test|live)(?:-([a-z]+))?(?=[.-])/;
const CHECKOUT_API_LABEL = /(?:^|-)checkout-(?:test|live)/;
const CHECKOUT_RESOURCE_PATH =
  /checkoutshopper-sdk|\/checkoutshopper\/|\/sdk\/\d+\.\d+\.\d+\/adyen\.js(?:[?#]|$)/i;
const SESSIONS_PATH = /\/v\d+\/sessions/;
const PAYMENT_API_PATH = /\/v\d+\/(?:payments\/details|paymentMethods)\b/;
const TRANSLATION_PATH = /\/translations\/([^/]+)\.json$/;

/**
 * Base URLs Adyen Web v6 derives from the `environment` option for API calls,
 * CDN images and translations, and checkout analytics.
 */
const ADYEN_WEB_ORIGINS = {
  test: {
    api: 'https://checkoutshopper-test.adyen.com/checkoutshopper/',
    cdn: 'https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/',
    analytics: 'https://checkoutanalytics-test.adyen.com/checkoutanalytics/',
  },
  live: {
    api: 'https://checkoutshopper-live.adyen.com/checkoutshopper/',
    cdn: 'https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/',
    analytics: 'https://checkoutanalytics-live.adyen.com/checkoutanalytics/',
  },
  'live-us': {
    api: 'https://checkoutshopper-live-us.adyen.com/checkoutshopper/',
    cdn: 'https://checkoutshopper-live-us.cdn.adyen.com/checkoutshopper/',
    analytics: 'https://checkoutanalytics-live-us.adyen.com/checkoutanalytics/',
  },
  'live-au': {
    api: 'https://checkoutshopper-live-au.adyen.com/checkoutshopper/',
    cdn: 'https://checkoutshopper-live-au.cdn.adyen.com/checkoutshopper/',
    analytics: 'https://checkoutanalytics-live-au.adyen.com/checkoutanalytics/',
  },
  'live-apse': {
    api: 'https://checkoutshopper-live-apse.adyen.com/checkoutshopper/',
    cdn: 'https://checkoutshopper-live-apse.cdn.adyen.com/checkoutshopper/',
    analytics: 'https://checkoutanalytics-live-apse.adyen.com/checkoutanalytics/',
  },
  'live-in': {
    api: 'https://checkoutshopper-live-in.adyen.com/checkoutshopper/',
    cdn: 'https://checkoutshopper-live-in.cdn.adyen.com/checkoutshopper/',
    analytics: 'https://checkoutanalytics-live-in.adyen.com/checkoutanalytics/',
  },
  'live-nea': {
    api: 'https://checkoutshopper-live-nea.adyen.com/checkoutshopper/',
    cdn: 'https://checkoutshopper-live-nea.cdn.adyen.com/checkoutshopper/',
    analytics: 'https://checkoutanalytics-live-nea.adyen.com/checkoutanalytics/',
  },
} as const satisfies Readonly<Record<string, AdyenWebOrigins>>;

/**
 * URL match patterns for Adyen checkout analytics hosts. Browser request
 * filters cannot wildcard the middle of a host, so each host is listed.
 */
export const ANALYTICS_URL_PATTERNS: readonly string[] = [
  'test',
  'live',
  'live-us',
  'live-au',
  'live-apse',
  'live-in',
  'live-nea',
].map((environment) => `*://checkoutanalytics-${environment}.adyen.com/*`);

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Returns true for hosts on Adyen-controlled domains (adyen.com, adyenpayments.com). */
function isAdyenHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === 'adyen.com' ||
    normalized.endsWith('.adyen.com') ||
    normalized === 'adyenpayments.com' ||
    normalized.endsWith('.adyenpayments.com')
  );
}

function roleOf(host: string): AdyenEndpointRole {
  if (host.endsWith('.cdn.adyen.com')) return 'cdn';
  if (host.startsWith('checkoutshopper-')) return 'checkoutshopper';
  if (host.startsWith('checkoutanalytics')) return 'analytics';
  if (CHECKOUT_API_LABEL.test(host)) return 'checkout-api';
  return 'other';
}

function readEnvironment(host: string): Omit<AdyenEndpoint, 'role'> {
  const match = ENVIRONMENT_LABEL.exec(host);
  if (match === null) return { environment: null, namedRegion: null };
  if (match[1] === 'test') return { environment: 'test', namedRegion: null };
  const token = match[2];
  const namedRegion = token === undefined ? null : (REGION_TOKENS[token] ?? 'unknown');
  return { environment: namedRegion === 'IN' ? 'live-in' : 'live', namedRegion };
}

/** Reads a URL as an Adyen Web endpoint, or returns null for non-Adyen and unparsable URLs. */
export function readAdyenEndpoint(url: string): AdyenEndpoint | null {
  const host = hostnameOf(url);
  if (host === null || !isAdyenHost(host)) return null;
  return { role: roleOf(host), ...readEnvironment(host) };
}

/**
 * Region an endpoint serves: the region its host names, else EU for a live
 * Checkout endpoint that names none. Test endpoints are global, so null.
 */
export function servedRegion(endpoint: AdyenEndpoint): AdyenRegion | null {
  if (endpoint.namedRegion !== null) return endpoint.namedRegion;
  return endpoint.environment === 'live' && CHECKOUT_ROLES.has(endpoint.role) ? 'EU' : null;
}

/** The Adyen Web `environment` option an endpoint's host names, such as live-us; null when it names none. */
export function environmentOption(endpoint: AdyenEndpoint): string | null {
  const { environment, namedRegion } = endpoint;
  if (environment !== 'live' || namedRegion === null || namedRegion === 'unknown') {
    return environment;
  }
  return `live-${namedRegion.toLowerCase()}`;
}

/**
 * Reads an Adyen Web `environment` option, such as live-us, as the environment
 * and region it selects: plain live is EU, and test is global, so it has no
 * region. Returns null for values Adyen Web does not name this way.
 */
export function readEnvironmentOption(
  option: string
): { readonly environment: AdyenEnvironment; readonly region: AdyenRegion | null } | null {
  const match = /^(test|live)(?:[-_]([a-z]+))?$/.exec(option.trim().toLowerCase());
  if (match === null) return null;
  if (match[1] === 'test') return { environment: 'test', region: null };
  const token = match[2];
  if (token === undefined) return { environment: 'live', region: 'EU' };
  const region = REGION_TOKENS[token] ?? 'unknown';
  return { environment: region === 'IN' ? 'live-in' : 'live', region };
}

function isAdyenWebEnvironment(name: string): name is keyof typeof ADYEN_WEB_ORIGINS {
  return Object.hasOwn(ADYEN_WEB_ORIGINS, name);
}

/**
 * Origins Adyen Web uses for an `environment` option. Mirrors Adyen Web v6:
 * names are lowercased and unknown names fall back to the default live origins.
 */
export function resolveAdyenWebOrigins(environment: string): AdyenWebOrigins {
  const name = environment.toLowerCase();
  return isAdyenWebEnvironment(name) ? ADYEN_WEB_ORIGINS[name] : ADYEN_WEB_ORIGINS.live;
}

/** Returns true when a URL refers to an Adyen-hosted Adyen Web resource (SDK script or CSS). */
export function isAdyenCheckoutResource(url: string): boolean {
  return readAdyenEndpoint(url) !== null && CHECKOUT_RESOURCE_PATH.test(url);
}

/** Returns true for Adyen Sessions API paths, such as /v71/sessions, on any host. */
export function isSessionsRequest(url: string): boolean {
  return SESSIONS_PATH.test(url);
}

/** Returns true for Checkout API paths Adyen Web calls or merchants proxy: sessions, payment methods, and payment details. */
export function isCheckoutApiRequest(url: string): boolean {
  return SESSIONS_PATH.test(url) || PAYMENT_API_PATH.test(url);
}

/** Reads the locale of an Adyen Web translation file path, such as /translations/nl-NL.json. */
export function readTranslationLocale(url: string): string | null {
  const locale = TRANSLATION_PATH.exec(url)?.[1];
  return locale === undefined || locale === '' ? null : locale;
}
