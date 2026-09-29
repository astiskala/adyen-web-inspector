/**
 * Implementation attributes — how the inspected integration is built: its
 * integration flavor and flow, environment and region, import method, and
 * checkout activity, each with the signal it came from. The rules live here
 * and run once per scan payload; everything else reads the resulting record.
 */

import {
  ADYEN_API_DOMAINS,
  ADYEN_CDN_DOMAINS,
  ADYEN_CHECKOUTSHOPPER_DOMAINS,
  CLIENT_KEY_LIVE_PREFIX,
  CLIENT_KEY_TEST_PREFIX,
  ENVIRONMENT_REGION_MAP,
  SESSIONS_API_PATTERN,
  ADYEN_CDN_HOST_SUFFIX,
} from './constants.js';
import { checkoutConfigSources, listCheckoutFieldObservations } from './scan-evidence.js';
import { detectSdkPresence } from './sdk-presence.js';
import type {
  AdyenEnvironment,
  AdyenRegion,
  ImplementationAttributes,
  IntegrationFlavor,
  ScanPayload,
} from './types.js';
import { extractHostname, isAdyenHost } from './utils.js';

const API_FALLBACK_PATTERN = /\/v\d+\/(?:payments\/details|paymentMethods)\b/;

const KNOWN_ADYEN_ENV_HOSTS = new Set<string>([
  ...ADYEN_CDN_DOMAINS,
  ...ADYEN_CHECKOUTSHOPPER_DOMAINS,
  ...ADYEN_API_DOMAINS,
]);
const CHECKOUTSHOPPER_TEST_HOST_PREFIX = 'checkoutshopper-test.';
const CHECKOUT_API_TEST_HOST_PREFIX = 'checkout-test.';
const CHECKOUTSHOPPER_LIVE_HOST_PREFIX = 'checkoutshopper-live';
const CHECKOUT_API_LIVE_HOST_PREFIX = 'checkout-live';

const ANALYTICS_FLAVOR_MAP: Record<string, IntegrationFlavor> = {
  dropin: 'Drop-in',
  components: 'Components',
  custom: 'Custom',
};

type Attribute<K extends keyof ImplementationAttributes> = ImplementationAttributes[K];

function mapRegionToken(token: string | undefined): AdyenRegion {
  if (token === undefined || token === '') return 'unknown';

  if (token === 'eu') return 'EU';
  if (token === 'us') return 'US';
  if (token === 'au') return 'AU';
  if (token === 'apse') return 'APSE';
  if (token === 'in') return 'IN';
  if (token === 'nea') return 'NEA';
  return 'unknown';
}

function parseConfigEnvironment(environment: string | undefined): {
  env: AdyenEnvironment | null;
  region: AdyenRegion;
} {
  if (environment === undefined || environment.trim() === '') {
    return { env: null, region: 'unknown' };
  }

  const value = environment.trim().toLowerCase();
  if (value === 'test') {
    return { env: 'test', region: 'unknown' };
  }
  if (value === 'live') {
    return { env: 'live', region: 'EU' };
  }

  const match = /^(test|live)(?:[-_]([a-z]+))?$/.exec(value);
  if (!match) {
    return { env: null, region: 'unknown' };
  }

  const envRaw = match[1];
  const regionToken = match[2];

  if (envRaw === 'live' && regionToken === 'in') {
    return { env: 'live-in', region: 'IN' };
  }

  const env = envRaw as AdyenEnvironment;
  const region = mapRegionToken(regionToken);
  return { env, region };
}

function detectEnvironmentFromClientKey(clientKey: string | undefined): AdyenEnvironment | null {
  if (clientKey === undefined || clientKey === '') return null;
  if (clientKey.startsWith(CLIENT_KEY_TEST_PREFIX)) return 'test';
  if (clientKey.startsWith(CLIENT_KEY_LIVE_PREFIX)) return 'live';
  return null;
}

function detectEnvironmentFromConfig(environment: string | undefined): AdyenEnvironment | null {
  return parseConfigEnvironment(environment).env;
}

function detectRegionFromConfig(environment: string | undefined): AdyenRegion | null {
  const { region } = parseConfigEnvironment(environment);
  return region === 'unknown' ? null : region;
}

/** Resolves the first observation that yields a value, strongest source first. */
function firstResolved<V, R>(
  observations: readonly { readonly value: V }[],
  resolve: (value: V) => R | null
): R | null {
  for (const { value } of observations) {
    const resolved = resolve(value);
    if (resolved !== null) return resolved;
  }
  return null;
}

function isAdyenApiRequest(url: string): boolean {
  return SESSIONS_API_PATTERN.test(url) || API_FALLBACK_PATTERN.test(url);
}

function detectRegionFromRequests(payload: ScanPayload): AdyenRegion {
  for (const req of payload.capturedRequests) {
    const host = extractHostname(req.url)?.toLowerCase() ?? '';
    if (isConfigRelatedHost(req.url, host)) {
      const region = ENVIRONMENT_REGION_MAP[host];
      if (region !== undefined) return region;
    }
  }
  return 'unknown';
}

function startsWithCheckoutLiveHostPrefix(host: string, prefix: string): boolean {
  return host.startsWith(`${prefix}.`) || host.startsWith(`${prefix}-`);
}

function detectEnvFromHost(host: string): AdyenEnvironment | null {
  if (KNOWN_ADYEN_ENV_HOSTS.has(host)) {
    if (host.includes('-test.')) return 'test';
    if (host.includes('-live-in.')) return 'live-in';
    return 'live';
  }
  if (
    host.startsWith(CHECKOUTSHOPPER_TEST_HOST_PREFIX) ||
    host.startsWith(CHECKOUT_API_TEST_HOST_PREFIX)
  )
    return 'test';
  if (
    startsWithCheckoutLiveHostPrefix(host, CHECKOUTSHOPPER_LIVE_HOST_PREFIX) ||
    startsWithCheckoutLiveHostPrefix(host, CHECKOUT_API_LIVE_HOST_PREFIX)
  ) {
    if (host.includes('-in.') || host.includes('-in-')) return 'live-in';
    return 'live';
  }
  if (isAdyenHost(host)) {
    return host.includes('test') ? 'test' : 'live';
  }
  return null;
}

/**
 * Returns true for CDN and checkoutshopper asset-serving hosts.
 * Their subdomains encode the environment (for example, checkoutshopper-live.cdn.adyen.com).
 * Excludes API/checkout hosts so CDN-based env detection stays separate from API-based detection.
 */
function isCheckoutshopperHost(host: string): boolean {
  return host.startsWith('checkoutshopper-');
}

function isAdyenAnalyticsHost(host: string): boolean {
  return host.startsWith('checkoutanalytics');
}

function isConfigRelatedHost(url: string, host: string): boolean {
  return isAdyenApiRequest(url) || isAdyenAnalyticsHost(host);
}

/** Environment of CDN / checkoutshopper asset hosts, independent of the configured environment. */
function detectEnvironmentFromCdnRequests(payload: ScanPayload): AdyenEnvironment | null {
  for (const req of payload.capturedRequests) {
    const host = extractHostname(req.url)?.toLowerCase() ?? '';
    if (isCheckoutshopperHost(host)) {
      const env = detectEnvFromHost(host);
      if (env !== null) return env;
    }
  }
  return null;
}

/**
 * Environment of captured Adyen API and analytics request hosts. Excludes
 * CDN/asset requests, which reflect asset delivery, not the configured environment.
 */
function detectEnvironmentFromRequests(payload: ScanPayload): AdyenEnvironment | null {
  for (const req of payload.capturedRequests) {
    const host = extractHostname(req.url)?.toLowerCase() ?? '';
    if (isConfigRelatedHost(req.url, host)) {
      const env = detectEnvFromHost(host);
      if (env !== null) return env;
    }
  }
  return null;
}

/** Region of regional CDN hosts such as checkoutshopper-live-us.cdn.adyen.com. */
function detectRegionFromCdnRequests(payload: ScanPayload): AdyenRegion {
  for (const req of payload.capturedRequests) {
    const host = extractHostname(req.url)?.toLowerCase() ?? '';
    if (isCheckoutshopperHost(host)) {
      const match = /checkoutshopper-live-([a-z0-9]+)\./.exec(host);
      if (match) return mapRegionToken(match[1]);
    }
  }
  return 'unknown';
}

/** Priority: checkout config, then client key, then network traffic. */
function resolveEnvironment(payload: ScanPayload): Attribute<'environment'> {
  const clientKeys = listCheckoutFieldObservations(payload, 'clientKey');
  const network = detectEnvironmentFromRequests(payload);
  const signals = {
    cdn: detectEnvironmentFromCdnRequests(payload),
    clientKey: detectEnvironmentFromClientKey(clientKeys[0]?.value),
    network,
  };

  const fromConfig = firstResolved(
    listCheckoutFieldObservations(payload, 'environment'),
    detectEnvironmentFromConfig
  );
  if (fromConfig !== null) return { value: fromConfig, source: 'config', ...signals };

  const fromKey = firstResolved(clientKeys, detectEnvironmentFromClientKey);
  if (fromKey !== null) return { value: fromKey, source: 'client-key', ...signals };

  if (network !== null) return { value: network, source: 'network', ...signals };
  return { value: null, source: 'unknown', ...signals };
}

/** Checkout config first, then captured request hosts. */
function resolveRegion(payload: ScanPayload): Attribute<'region'> {
  const cdn = detectRegionFromCdnRequests(payload);
  const fromConfig = firstResolved(
    listCheckoutFieldObservations(payload, 'environment'),
    detectRegionFromConfig
  );
  if (fromConfig !== null) return { value: fromConfig, source: 'config', cdn };

  const fromRequests = detectRegionFromRequests(payload);
  if (fromRequests !== 'unknown') return { value: fromRequests, source: 'network', cdn };
  return { value: 'unknown', source: 'unknown', cdn };
}

function isCdnAdyenHost(host: string): boolean {
  return host.endsWith(ADYEN_CDN_HOST_SUFFIX);
}

/** Classifies visible Adyen-hosted script origins; other import methods remain unknown. */
function detectImportMethod(scripts: ScanPayload['page']['scripts']): Attribute<'importMethod'> {
  let foundAdyenHost = false;
  for (const script of scripts) {
    const scriptHost = extractHostname(script.src);
    if (scriptHost === null) {
      continue;
    }
    const host = scriptHost.toLowerCase();

    if (isCdnAdyenHost(host)) {
      return 'CDN';
    }

    if (isAdyenHost(host)) {
      foundAdyenHost = true;
    }
  }

  return foundAdyenHost ? 'Adyen' : 'Unknown';
}

/** Checkout activity from config, analytics, Adyen iframes, or Adyen API traffic. */
function hasCheckoutActivity(payload: ScanPayload): boolean {
  const { page, capturedRequests, analyticsData } = payload;

  if (checkoutConfigSources(payload.page).size > 0) return true;
  if (analyticsData !== null) return true;

  if (
    page.iframes.some((f) => {
      const hasAdyenSrc = f.src?.includes('adyen') === true;
      const hasAdyenName = f.name?.startsWith('adyen-') === true;
      return hasAdyenSrc || hasAdyenName;
    })
  ) {
    return true;
  }

  return capturedRequests.some((r) => isAdyenApiRequest(r.url));
}

/** A session object, analytics session ID, or Sessions request indicates Sessions; config alone indicates Advanced. */
function resolveIntegrationFlow(payload: ScanPayload): Attribute<'flow'> {
  const signals = {
    hasSessionsRequest: payload.capturedRequests.some((request) =>
      SESSIONS_API_PATTERN.test(request.url)
    ),
    hasSessionConfig: listCheckoutFieldObservations(payload, 'hasSession').some(
      (observation) => observation.value
    ),
    hasAnalyticsSessionId: Boolean(payload.analyticsData?.sessionId),
    hasCheckoutConfig: checkoutConfigSources(payload.page).size > 0,
    hasAnalyticsData: payload.analyticsData !== null,
  };
  if (signals.hasSessionsRequest || signals.hasSessionConfig || signals.hasAnalyticsSessionId) {
    return { value: 'sessions', signals };
  }
  return { value: signals.hasCheckoutConfig ? 'advanced' : 'unknown', signals };
}

/** Flavor from analytics, then Drop-in URL patterns and DOM, then captured or inferred config. */
function resolveIntegrationFlavor(
  payload: ScanPayload,
  checkoutActivity: boolean
): Attribute<'flavor'> {
  const analyticsFlavor = payload.analyticsData?.flavor?.toLowerCase();
  const mappedFlavor =
    analyticsFlavor === undefined ? undefined : ANALYTICS_FLAVOR_MAP[analyticsFlavor];
  if (mappedFlavor !== undefined) {
    return { value: mappedFlavor, source: 'analytics' };
  }

  const hasDropin =
    payload.page.scripts.some((s) => s.src.includes('dropin')) ||
    payload.capturedRequests.some((r) => r.url.includes('dropin'));
  if (hasDropin) {
    return { value: 'Drop-in', source: 'dropin-pattern' };
  }

  if (payload.page.hasDropinDOM === true) {
    return { value: 'Drop-in', source: 'dropin-dom' };
  }

  const configSources = checkoutConfigSources(payload.page);
  if (configSources.has('captured') || configSources.has('inferred')) {
    return { value: 'Components', source: 'checkout-config' };
  }

  if (detectSdkPresence(payload.page).detected && !checkoutActivity) {
    return { value: 'Unknown', source: 'sdk-loaded-no-checkout' };
  }

  return { value: 'Unknown', source: 'unknown' };
}

function deriveImplementationAttributes(payload: ScanPayload): ImplementationAttributes {
  const checkoutActivity = hasCheckoutActivity(payload);
  return {
    flavor: resolveIntegrationFlavor(payload, checkoutActivity),
    flow: resolveIntegrationFlow(payload),
    environment: resolveEnvironment(payload),
    region: resolveRegion(payload),
    importMethod: detectImportMethod(payload.page.scripts),
    checkoutActivity,
  };
}

const derived = new WeakMap<ScanPayload, ImplementationAttributes>();

/**
 * Returns the implementation attributes of a scan payload. They are derived
 * on first read and shared by every later reader of the same payload, so the
 * checks, the assessment, and the stored scan result see one record.
 */
export function readImplementationAttributes(payload: ScanPayload): ImplementationAttributes {
  let attributes = derived.get(payload);
  if (attributes === undefined) {
    attributes = deriveImplementationAttributes(payload);
    derived.set(payload, attributes);
  }
  return attributes;
}
