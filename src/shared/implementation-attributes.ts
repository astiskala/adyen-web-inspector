import type { AdyenEnvironment, AdyenRegion } from './constants.js';
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
import type { ScanPayload } from './types.js';
import { extractHostname, isAdyenHost, isAdyenCheckoutResource } from './utils.js';

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

const ANALYTICS_FLAVOR_MAP: Record<string, ImplementationFlavor> = {
  dropin: 'Drop-in',
  components: 'Components',
  custom: 'Custom',
};

type EnvironmentSource = 'config' | 'client-key' | 'network' | 'unknown';
type RegionSource = 'config' | 'network' | 'unknown';
export type IntegrationFlow = 'sessions' | 'advanced' | 'unknown';
type ImportMethod = 'CDN' | 'Adyen' | 'npm';
type ImplementationFlavor = 'Drop-in' | 'Components' | 'Custom' | 'Unknown';
type IntegrationFlavorSource =
  | 'analytics'
  | 'dropin-pattern'
  | 'dropin-dom'
  | 'checkout-config'
  | 'sdk-loaded-no-checkout'
  | 'unknown';

interface EnvironmentResolution {
  readonly env: AdyenEnvironment | null;
  readonly source: EnvironmentSource;
}

interface RegionResolution {
  readonly region: AdyenRegion;
  readonly source: RegionSource;
}

interface ImplementationAttributes {
  readonly sdkVersion: string;
  readonly environment: AdyenEnvironment | 'unknown';
  readonly region: AdyenRegion | null;
  readonly flow: IntegrationFlow;
  readonly flavor: ImplementationFlavor;
  readonly importMethod: ImportMethod;
}

interface IntegrationFlavorResolution {
  readonly flavor: ImplementationFlavor;
  readonly source: IntegrationFlavorSource;
}

interface IntegrationFlowSignals {
  readonly hasSessionsRequest: boolean;
  readonly hasSessionConfig: boolean;
  readonly hasAnalyticsSessionId: boolean;
  readonly hasCheckoutConfig: boolean;
  readonly hasAnalyticsData: boolean;
}

function mapRegionToken(token: string | undefined): AdyenRegion {
  if (token === undefined || token === '') return 'unknown';

  if (token === 'eu') return 'EU';
  if (token === 'us') return 'US';
  if (token === 'au') return 'AU';
  if (token === 'apse') return 'APSE';
  if (token === 'in') return 'IN';
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
    return { env: 'live', region: 'unknown' };
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

/**
 * Infers environment from client key prefix (`test_`/`live_`).
 */
export function detectEnvironmentFromClientKey(
  clientKey: string | undefined
): AdyenEnvironment | null {
  if (clientKey === undefined || clientKey === '') return null;
  if (clientKey.startsWith(CLIENT_KEY_TEST_PREFIX)) return 'test';
  if (clientKey.startsWith(CLIENT_KEY_LIVE_PREFIX)) return 'live';
  return null;
}

function detectEnvironmentFromConfig(environment: string | undefined): AdyenEnvironment | null {
  return parseConfigEnvironment(environment).env;
}

function detectRegionFromConfig(environment: string | undefined): AdyenRegion {
  return parseConfigEnvironment(environment).region;
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
 * These encode the environment in their subdomain (e.g. checkoutshopper-live.cdn.adyen.com).
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

/**
 * Infers environment from CDN / checkoutshopper asset requests only.
 * Used to validate CDN environment consistency independently of the configured environment.
 */
export function detectEnvironmentFromCdnRequests(payload: ScanPayload): AdyenEnvironment | null {
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
 * Infers environment by inspecting captured Adyen API and analytics request hosts.
 * Excludes CDN/asset requests — those reflect asset delivery, not the configured environment.
 */
export function detectEnvironmentFromRequests(payload: ScanPayload): AdyenEnvironment | null {
  for (const req of payload.capturedRequests) {
    const host = extractHostname(req.url)?.toLowerCase() ?? '';
    if (isConfigRelatedHost(req.url, host)) {
      const env = detectEnvFromHost(host);
      if (env !== null) return env;
    }
  }
  return null;
}

/**
 * Resolves the most reliable environment and records which signal produced it.
 * Priority: checkout config, client key, then network traffic.
 */
export function resolveEnvironment(payload: ScanPayload): EnvironmentResolution {
  const envFromConfig = detectEnvironmentFromConfig(payload.page.checkoutConfig?.environment);
  if (envFromConfig !== null) {
    return { env: envFromConfig, source: 'config' };
  }

  const envFromInferred = detectEnvironmentFromConfig(payload.page.inferredConfig?.environment);
  if (envFromInferred !== null) {
    return { env: envFromInferred, source: 'config' };
  }

  const envFromComponent = detectEnvironmentFromConfig(payload.page.componentConfig?.environment);
  if (envFromComponent !== null) {
    return { env: envFromComponent, source: 'config' };
  }

  const envFromKey =
    detectEnvironmentFromClientKey(payload.page.checkoutConfig?.clientKey) ??
    detectEnvironmentFromClientKey(payload.page.componentConfig?.clientKey) ??
    detectEnvironmentFromClientKey(payload.page.inferredConfig?.clientKey);
  if (envFromKey !== null) {
    return { env: envFromKey, source: 'client-key' };
  }

  const envFromRequests = detectEnvironmentFromRequests(payload);
  if (envFromRequests !== null) {
    return { env: envFromRequests, source: 'network' };
  }

  return { env: null, source: 'unknown' };
}

/**
 * Resolves region from checkout config first, then captured request hosts.
 */
export function resolveRegion(payload: ScanPayload): RegionResolution {
  let regionFromConfig = detectRegionFromConfig(payload.page.checkoutConfig?.environment);
  if (regionFromConfig === 'unknown') {
    regionFromConfig = detectRegionFromConfig(payload.page.inferredConfig?.environment);
  }
  if (regionFromConfig === 'unknown') {
    regionFromConfig = detectRegionFromConfig(payload.page.componentConfig?.environment);
  }

  if (regionFromConfig !== 'unknown') {
    return { region: regionFromConfig, source: 'config' };
  }

  const regionFromRequests = detectRegionFromRequests(payload);
  if (regionFromRequests !== 'unknown') {
    return { region: regionFromRequests, source: 'network' };
  }

  return { region: 'unknown', source: 'unknown' };
}

/**
 * Returns whether a script URL points to an Adyen checkout CDN asset.
 */
export function isCdnCheckoutScriptUrl(url: string): boolean {
  return isAdyenCheckoutResource(url);
}

function isCdnAdyenHost(host: string): boolean {
  return host.endsWith(ADYEN_CDN_HOST_SUFFIX);
}

/**
 * Classifies how checkout was loaded: Adyen CDN script, other Adyen host, or bundled npm.
 */
export function detectImportMethod(scripts: ScanPayload['page']['scripts']): ImportMethod {
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

  if (foundAdyenHost) {
    return 'Adyen';
  }

  return 'npm';
}

/**
 * Detects whether checkout activity is present from config, analytics, iframes, or API traffic.
 */
export function hasCheckoutActivity(payload: ScanPayload): boolean {
  const { page, capturedRequests, analyticsData } = payload;

  if (page.checkoutConfig || page.componentConfig || page.inferredConfig) return true;
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

  if (capturedRequests.some((r) => isAdyenApiRequest(r.url))) {
    return true;
  }

  return false;
}

/**
 * Collects boolean signals used to infer Sessions versus Advanced flow.
 */
export function collectIntegrationFlowSignals(payload: ScanPayload): IntegrationFlowSignals {
  return {
    hasSessionsRequest: payload.capturedRequests.some((request) =>
      SESSIONS_API_PATTERN.test(request.url)
    ),
    hasSessionConfig:
      Boolean(payload.page.checkoutConfig?.hasSession) ||
      Boolean(payload.page.componentConfig?.hasSession) ||
      Boolean(payload.page.inferredConfig?.hasSession),
    hasAnalyticsSessionId: Boolean(payload.analyticsData?.sessionId),
    hasCheckoutConfig:
      payload.page.checkoutConfig !== null ||
      payload.page.componentConfig !== null ||
      payload.page.inferredConfig !== null,
    hasAnalyticsData: payload.analyticsData !== null,
  };
}

/**
 * Infers integration flow from observed flow signals.
 */
export function detectIntegrationFlow(payload: ScanPayload): IntegrationFlow {
  const signals = collectIntegrationFlowSignals(payload);
  if (signals.hasSessionsRequest || signals.hasSessionConfig || signals.hasAnalyticsSessionId) {
    return 'sessions';
  }
  if (signals.hasCheckoutConfig) {
    return 'advanced';
  }
  return 'unknown';
}

/**
 * Infers region from CDN requests (e.g. checkoutshopper-live-us.cdn.adyen.com).
 */
export function detectRegionFromCdnRequests(payload: ScanPayload): AdyenRegion {
  for (const req of payload.capturedRequests) {
    const host = extractHostname(req.url)?.toLowerCase() ?? '';
    if (isCheckoutshopperHost(host)) {
      const match = /checkoutshopper-live-([a-z0-9]+)\./.exec(host);
      if (match) return mapRegionToken(match[1]);
    }
  }
  return 'unknown';
}

/**
 * Resolves integration flavor (Drop-in/Components/Custom/Unknown) and source signal.
 */
export function resolveIntegrationFlavor(payload: ScanPayload): IntegrationFlavorResolution {
  const analyticsFlavor = payload.analyticsData?.flavor?.toLowerCase();
  if (analyticsFlavor !== undefined && analyticsFlavor !== '') {
    const mappedFlavor = ANALYTICS_FLAVOR_MAP[analyticsFlavor];
    if (mappedFlavor !== undefined) {
      return {
        flavor: mappedFlavor,
        source: 'analytics',
      };
    }
  }

  const hasDropin =
    payload.page.scripts.some((s) => /dropin/.test(s.src)) ||
    payload.capturedRequests.some((r) => /dropin/.test(r.url));
  if (hasDropin) {
    return {
      flavor: 'Drop-in',
      source: 'dropin-pattern',
    };
  }

  if (payload.page.hasDropinDOM === true) {
    return {
      flavor: 'Drop-in',
      source: 'dropin-dom',
    };
  }

  if (payload.page.checkoutConfig || payload.page.inferredConfig) {
    return {
      flavor: 'Components',
      source: 'checkout-config',
    };
  }

  const sdkLoaded =
    payload.page.adyenMetadata !== null ||
    payload.page.scripts.some((s) => isAdyenCheckoutResource(s.src));
  if (sdkLoaded && !hasCheckoutActivity(payload)) {
    return {
      flavor: 'Unknown',
      source: 'sdk-loaded-no-checkout',
    };
  }

  return {
    flavor: 'Unknown',
    source: 'unknown',
  };
}

/**
 * Builds the final implementation-attributes snapshot shown in the UI/export.
 */
export function buildImplementationAttributes(payload: ScanPayload): ImplementationAttributes {
  const resolvedEnvironment = resolveEnvironment(payload);
  const environment = resolvedEnvironment.env ?? 'unknown';
  const region = environment === 'test' ? null : resolveRegion(payload).region;

  return {
    sdkVersion: payload.versionInfo.detected ?? 'Unknown',
    environment,
    region,
    flow: detectIntegrationFlow(payload),
    flavor: resolveIntegrationFlavor(payload).flavor,
    importMethod: detectImportMethod(payload.page.scripts),
  };
}
