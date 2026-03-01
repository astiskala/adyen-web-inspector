/**
 * Category 3 — Environment & Region checks.
 */

import {
  detectEnvironmentFromCdnRequests,
  detectEnvironmentFromClientKey,
  detectEnvironmentFromRequests,
  detectRegionFromCdnRequests,
  resolveEnvironment,
  resolveRegion,
} from '../../shared/implementation-attributes.js';
import { createRegistry } from './registry.js';

const STRINGS = {
  CDN_SKIP_TITLE: 'CDN environment check skipped.',
  CDN_NO_REQUESTS_SKIP_REASON: 'No Adyen CDN requests detected.',
  CDN_ENV_UNKNOWN_SKIP_REASON: 'Configured environment unknown.',
  CDN_MISMATCH_FAIL_URL:
    'https://docs.adyen.com/online-payments/web-best-practices/#embed-script-and-stylesheet',

  REGION_SKIP_TITLE: 'Region check skipped.',
  REGION_SKIP_REASON: 'Environment is test, which uses a global endpoint.',
  REGION_SOURCE_CONFIG_DETAIL: 'Determined from checkoutConfig.environment.',
  REGION_SOURCE_UNKNOWN_DETAIL: 'No Adyen CDN or API requests captured to determine region.',
  REGION_SOURCE_NETWORK_DETAIL: 'Determined from captured Adyen CDN / API request hostnames.',

  KEY_SKIP_TITLE: 'Key-environment mismatch check skipped.',
  KEY_NO_KEY_SKIP_REASON: 'Client key not detected.',
  KEY_NO_ENV_SKIP_REASON: 'Unable to determine environment.',
  KEY_MISMATCH_FAIL_REMEDIATION:
    'Ensure your client key prefix matches the environment your checkout is configured for. Test client keys (prefixed with test_) must only be used against Adyen test endpoints, and live client keys (prefixed with live_) must only be used against live endpoints. Mixing them causes authentication failures at payment time.',
  KEY_MISMATCH_FAIL_URL: 'https://docs.adyen.com/development-resources/client-side-authentication/',
  KEY_PASS_TITLE: 'Client key prefix matches the API environment.',

  IFRAME_WARN_TITLE: 'Checkout appears to be rendered inside an <iframe>.',
  IFRAME_WARN_DETAIL:
    'Embedding checkout in an iframe may cause issues with 3DS redirects, cookies, and CSP.',
  IFRAME_WARN_REMEDIATION:
    'Render Drop-in or Components directly in the top-level page document rather than inside a parent iframe. Embedding checkout in an iframe breaks 3DS redirect flows, causes cookie restrictions in cross-origin contexts, and complicates CSP configuration.',
  IFRAME_WARN_URL: 'https://docs.adyen.com/online-payments/web-best-practices/#iframe',
  IFRAME_PASS_TITLE: 'Checkout is not embedded inside an iframe.',

  REGION_MISMATCH_WARN_TITLE: 'CDN region does not match configured region.',
  REGION_MISMATCH_WARN_DETAIL:
    'Loading assets from a different region than your API endpoints can cause latency issues and potentially result in inconsistent payment method availability or localised content.',
  REGION_MISMATCH_WARN_REMEDIATION:
    'Ensure your script and stylesheet URLs use the CDN origin that matches your configured region. For example, if your environment is live-us, load assets from checkoutshopper-live-us.cdn.adyen.com.',
} as const;

const CATEGORY = 'environment' as const;

export const ENVIRONMENT_CHECKS = createRegistry(CATEGORY)
  .add('env-cdn-mismatch', (payload, { skip, pass, fail }) => {
    const cdnEnv = detectEnvironmentFromCdnRequests(payload);
    if (cdnEnv === null) {
      return skip(STRINGS.CDN_SKIP_TITLE, STRINGS.CDN_NO_REQUESTS_SKIP_REASON);
    }

    const configuredEnv = resolveEnvironment(payload).env;
    if (configuredEnv === null) {
      return skip(STRINGS.CDN_SKIP_TITLE, STRINGS.CDN_ENV_UNKNOWN_SKIP_REASON);
    }

    if (cdnEnv !== configuredEnv) {
      return fail(
        `CDN environment (${cdnEnv}) does not match configured environment (${configuredEnv}).`,
        `Assets are being loaded from the Adyen ${cdnEnv} CDN, but the checkout is configured for ${configuredEnv}. This mismatch can cause subtle failures such as mismatched locale files, component versions, or payment method availability.`,
        `Ensure your checkoutConfig.environment matches the CDN you are loading assets from. If you intend to use the ${configuredEnv} environment, update your script and stylesheet URLs to use the corresponding ${configuredEnv} CDN origin.`,
        STRINGS.CDN_MISMATCH_FAIL_URL
      );
    }

    return pass(`CDN environment matches configured environment (${configuredEnv}).`);
  })
  .add('env-region-mismatch', (payload, { skip, pass, warn }) => {
    const cdnRegion = detectRegionFromCdnRequests(payload);
    if (cdnRegion === 'unknown') {
      return skip('CDN region check skipped.', 'No regional Adyen CDN requests detected.');
    }

    const configuredRegion = resolveRegion(payload).region;
    if (configuredRegion === 'unknown') {
      return skip('CDN region check skipped.', 'Configured region unknown.');
    }

    if (cdnRegion !== configuredRegion) {
      return warn(
        `${STRINGS.REGION_MISMATCH_WARN_TITLE} (${cdnRegion} vs ${configuredRegion})`,
        STRINGS.REGION_MISMATCH_WARN_DETAIL,
        STRINGS.REGION_MISMATCH_WARN_REMEDIATION,
        STRINGS.CDN_MISMATCH_FAIL_URL
      );
    }

    return pass(`CDN region matches configured region (${configuredRegion}).`);
  })
  .add('env-region', (payload, { skip, info }) => {
    const env = resolveEnvironment(payload).env;
    if (env === 'test') {
      return skip(STRINGS.REGION_SKIP_TITLE, STRINGS.REGION_SKIP_REASON);
    }

    const regionResolution = resolveRegion(payload);
    const region = regionResolution.region;
    let detail: string = STRINGS.REGION_SOURCE_NETWORK_DETAIL;
    if (regionResolution.source === 'config') {
      detail = STRINGS.REGION_SOURCE_CONFIG_DETAIL;
    } else if (regionResolution.source === 'unknown') {
      detail = STRINGS.REGION_SOURCE_UNKNOWN_DETAIL;
    }

    return info(`Region: ${region}.`, detail);
  })
  .add('env-key-mismatch', (payload, { skip, fail, pass }) => {
    const clientKey =
      payload.page.checkoutConfig?.clientKey ?? payload.page.inferredConfig?.clientKey;
    if (clientKey === undefined || clientKey === '') {
      return skip(STRINGS.KEY_SKIP_TITLE, STRINGS.KEY_NO_KEY_SKIP_REASON);
    }

    const envFromKey = detectEnvironmentFromClientKey(clientKey);
    const envFromRequests = detectEnvironmentFromRequests(payload);

    if (envFromKey === null || envFromRequests === null) {
      return skip(STRINGS.KEY_SKIP_TITLE, STRINGS.KEY_NO_ENV_SKIP_REASON);
    }

    if (envFromKey !== envFromRequests) {
      return fail(
        `Client key prefix (${envFromKey}) does not match API endpoint environment (${envFromRequests}).`,
        `Using a ${envFromKey} client key against a ${envFromRequests} endpoint will cause authentication errors.`,
        STRINGS.KEY_MISMATCH_FAIL_REMEDIATION,
        STRINGS.KEY_MISMATCH_FAIL_URL
      );
    }

    return pass(STRINGS.KEY_PASS_TITLE);
  })
  .add('env-not-iframe', (payload, { pass, warn }) => {
    if (payload.page.isInsideIframe) {
      return warn(
        STRINGS.IFRAME_WARN_TITLE,
        STRINGS.IFRAME_WARN_DETAIL,
        STRINGS.IFRAME_WARN_REMEDIATION,
        STRINGS.IFRAME_WARN_URL
      );
    }

    return pass(STRINGS.IFRAME_PASS_TITLE);
  })
  .getChecks();
