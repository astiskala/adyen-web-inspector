/**
 * Category 3 — Environment & Region checks.
 */

import {
  detectEnvironmentFromCdnRequests,
  detectEnvironmentFromClientKey,
  detectEnvironmentFromRequests,
  resolveEnvironment,
  resolveRegion,
} from '../../shared/implementation-attributes.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'environment' as const;

function regionSourceDetail(source: 'config' | 'network' | 'unknown'): string {
  if (source === 'config') {
    return 'Determined from checkoutConfig.environment.';
  }
  if (source === 'unknown') {
    return 'No Adyen CDN or API requests captured to determine region.';
  }
  return 'Determined from captured Adyen CDN / API request hostnames.';
}

export const ENVIRONMENT_CHECKS = createRegistry(CATEGORY)
  .add('env-cdn-mismatch', (payload, { skip, pass, fail }) => {
    const cdnEnv = detectEnvironmentFromCdnRequests(payload);
    if (cdnEnv === null) {
      return skip('CDN environment check skipped — no Adyen CDN requests observed.');
    }

    const configuredEnv = resolveEnvironment(payload).env;
    if (configuredEnv === null) {
      return skip('CDN environment check skipped — configured environment unknown.');
    }

    if (cdnEnv !== configuredEnv) {
      return fail(
        `CDN environment (${cdnEnv}) does not match configured environment (${configuredEnv}).`,
        `Assets are being loaded from the Adyen ${cdnEnv} CDN, but the checkout is configured for ${configuredEnv}. This mismatch can cause subtle failures such as mismatched locale files, component versions, or payment method availability.`,
        `Ensure your checkoutConfig.environment matches the CDN you are loading assets from. If you intend to use the ${configuredEnv} environment, update your script and stylesheet URLs to use the corresponding ${configuredEnv} CDN origin.`,
        'https://docs.adyen.com/online-payments/web-best-practices/#embed-script-and-stylesheet'
      );
    }

    return pass(`CDN environment matches configured environment (${configuredEnv}).`);
  })
  .add('env-region', (payload, { skip, info }) => {
    const env = resolveEnvironment(payload).env;
    if (env === 'test') {
      return skip('Region check skipped — test environment.');
    }

    const regionResolution = resolveRegion(payload);
    const region = regionResolution.region;
    const detail = regionSourceDetail(regionResolution.source);

    return info(`Region: ${region}.`, detail);
  })
  .add('env-key-mismatch', (payload, { skip, fail, pass }) => {
    const clientKey = payload.page.checkoutConfig?.clientKey;
    if (clientKey === undefined || clientKey === '') {
      return skip('Key-environment mismatch check skipped — client key not detected.');
    }

    const envFromKey = detectEnvironmentFromClientKey(clientKey);
    const envFromRequests = detectEnvironmentFromRequests(payload);

    if (envFromKey === null || envFromRequests === null) {
      return skip('Key-environment mismatch check skipped — insufficient data.');
    }

    if (envFromKey !== envFromRequests) {
      return fail(
        `Client key prefix (${envFromKey}) does not match API endpoint environment (${envFromRequests}).`,
        `Using a ${envFromKey} client key against a ${envFromRequests} endpoint will cause authentication errors.`,
        'Ensure your client key prefix matches the environment your checkout is configured for. Test client keys (prefixed with test_) must only be used against Adyen test endpoints, and live client keys (prefixed with live_) must only be used against live endpoints. Mixing them causes authentication failures at payment time.',
        'https://docs.adyen.com/development-resources/client-side-authentication/'
      );
    }

    return pass('Client key prefix matches the API environment.');
  })
  .add('env-not-iframe', (payload, { pass, warn }) => {
    if (payload.page.isInsideIframe) {
      return warn(
        'Checkout appears to be rendered inside an <iframe>.',
        'Embedding checkout in an iframe may cause issues with 3DS redirects, cookies, and CSP.',
        'Render Drop-in or Components directly in the top-level page document rather than inside a parent iframe. Embedding checkout in an iframe breaks 3DS redirect flows, causes cookie restrictions in cross-origin contexts, and complicates CSP configuration.',
        'https://docs.adyen.com/online-payments/web-best-practices/#iframe'
      );
    }

    return pass('Checkout is not embedded inside an iframe.');
  })
  .getChecks();
