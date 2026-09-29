/**
 * Implementation attributes — how the inspected integration is built: its
 * integration flavor and flow, environment and region, import method, and
 * checkout activity, each with the signal it came from. The rules live here
 * and run once per scan payload; everything else reads the resulting record.
 */

import {
  isCheckoutApiRequest,
  isSessionsRequest,
  readAdyenEndpoint,
  readEnvironmentOption,
  servedRegion,
  type AdyenEndpoint,
} from './adyen-endpoint.js';
import { hasCheckoutActivity } from './checkout-signals.js';
import { CLIENT_KEY_LIVE_PREFIX, CLIENT_KEY_TEST_PREFIX } from './constants.js';
import {
  checkoutConfigSources,
  listCheckoutFieldObservations,
  readCheckoutField,
} from './scan-evidence.js';
import { detectSdkPresence } from './sdk-presence.js';
import type {
  AdyenEnvironment,
  AdyenRegion,
  ImplementationAttributes,
  IntegrationFlavor,
  ScanPayload,
} from './types.js';

const ANALYTICS_FLAVOR_MAP: Record<string, IntegrationFlavor> = {
  dropin: 'Drop-in',
  components: 'Components',
  custom: 'Custom',
};

type Attribute<K extends keyof ImplementationAttributes> = ImplementationAttributes[K];

function detectEnvironmentFromClientKey(clientKey: string | undefined): AdyenEnvironment | null {
  if (clientKey === undefined || clientKey === '') return null;
  if (clientKey.startsWith(CLIENT_KEY_TEST_PREFIX)) return 'test';
  if (clientKey.startsWith(CLIENT_KEY_LIVE_PREFIX)) return 'live';
  return null;
}

function detectEnvironmentFromConfig(environment: string): AdyenEnvironment | null {
  return readEnvironmentOption(environment)?.environment ?? null;
}

function detectRegionFromConfig(environment: string): AdyenRegion | null {
  const region = readEnvironmentOption(environment)?.region ?? null;
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

/** Captured traffic read as Adyen endpoints, split by what it can tell about the integration. */
interface EndpointTraffic {
  /** CDN and checkoutshopper hosts, which reflect asset delivery. */
  readonly assets: readonly AdyenEndpoint[];
  /** Checkout API calls and analytics, which reflect the configured environment. */
  readonly config: readonly AdyenEndpoint[];
}

function readEndpointTraffic(payload: ScanPayload): EndpointTraffic {
  const assets: AdyenEndpoint[] = [];
  const config: AdyenEndpoint[] = [];
  for (const { url } of payload.capturedRequests) {
    const endpoint = readAdyenEndpoint(url);
    if (endpoint === null) continue;
    if (endpoint.role === 'cdn' || endpoint.role === 'checkoutshopper') assets.push(endpoint);
    if (isCheckoutApiRequest(url) || endpoint.role === 'analytics') config.push(endpoint);
  }
  return { assets, config };
}

function firstOf<T>(
  endpoints: readonly AdyenEndpoint[],
  read: (e: AdyenEndpoint) => T | null
): T | null {
  for (const endpoint of endpoints) {
    const value = read(endpoint);
    if (value !== null) return value;
  }
  return null;
}

/** Priority: checkout config, then client key, then network traffic. */
function resolveEnvironment(
  payload: ScanPayload,
  traffic: EndpointTraffic
): Attribute<'environment'> {
  const clientKeys = listCheckoutFieldObservations(payload, 'clientKey');
  const network = firstOf(traffic.config, (endpoint) => endpoint.environment);
  const signals = {
    cdn: firstOf(traffic.assets, (endpoint) => endpoint.environment),
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

/** Checkout config first, then the region Checkout API and analytics hosts serve. */
function resolveRegion(payload: ScanPayload, traffic: EndpointTraffic): Attribute<'region'> {
  const cdn = firstOf(traffic.assets, (endpoint) => endpoint.namedRegion) ?? 'unknown';
  const fromConfig = firstResolved(
    listCheckoutFieldObservations(payload, 'environment'),
    detectRegionFromConfig
  );
  if (fromConfig !== null) return { value: fromConfig, source: 'config', cdn };

  const fromRequests = firstOf(traffic.config, servedRegion);
  if (fromRequests !== null) return { value: fromRequests, source: 'network', cdn };
  return { value: 'unknown', source: 'unknown', cdn };
}

/** Classifies visible Adyen-hosted script origins; other import methods remain unknown. */
function detectImportMethod(scripts: ScanPayload['page']['scripts']): Attribute<'importMethod'> {
  const endpoints = scripts.map((script) => readAdyenEndpoint(script.src));
  if (endpoints.some((endpoint) => endpoint?.role === 'cdn')) return 'CDN';
  return endpoints.some((endpoint) => endpoint !== null) ? 'Adyen' : 'Unknown';
}

/** A session object, analytics session ID, or Sessions request indicates Sessions; config alone indicates Advanced. */
function resolveIntegrationFlow(payload: ScanPayload): Attribute<'flow'> {
  // A session object only counts in captured or mounted options: any page JSON can carry one.
  const session = readCheckoutField(payload, 'hasSession', { includeInferred: false });
  const signals = {
    hasSessionsRequest: payload.capturedRequests.some((request) => isSessionsRequest(request.url)),
    hasSessionConfig: session.state === 'present' && session.value,
    hasAnalyticsSessionId: Boolean(payload.analyticsData?.sessionId),
    hasCheckoutConfig: checkoutConfigSources(payload.page).size > 0,
    hasAnalyticsData: payload.analyticsData !== null,
  };
  if (signals.hasSessionsRequest || signals.hasSessionConfig || signals.hasAnalyticsSessionId) {
    return { value: 'sessions', signals };
  }
  return { value: signals.hasCheckoutConfig ? 'advanced' : 'unknown', signals };
}

/** Flavor from analytics, then Drop-in URL patterns and DOM, then captured or request-inferred config. */
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
  const traffic = readEndpointTraffic(payload);
  return {
    flavor: resolveIntegrationFlavor(payload, checkoutActivity),
    flow: resolveIntegrationFlow(payload),
    environment: resolveEnvironment(payload, traffic),
    region: resolveRegion(payload, traffic),
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
