/**
 * Category 1 — SDK Identity checks.
 */

import {
  detectImportMethod,
  hasCheckoutActivity,
  isCdnCheckoutScriptUrl,
  resolveIntegrationFlavor,
} from '../../shared/implementation-attributes.js';
import { isAdyenCheckoutResource } from '../../shared/utils.js';
import { createRegistry } from './registry.js';

const STRINGS = {
  DETECTED_INFO_TITLE: 'Adyen Web SDK detected on this page.',
  DETECTED_FAIL_TITLE: 'Adyen Web SDK was not detected on this page.',
  DETECTED_FAIL_DETAIL: 'No window.AdyenWebMetadata or CDN script tag was found.',
  DETECTED_FAIL_REMEDIATION:
    'Verify that the Adyen Web SDK is correctly loaded on this page. If using an npm import, enable exposeLibraryMetadata in your AdyenCheckout configuration so the inspector can detect the SDK. If using a CDN script tag, confirm the script URL is from an Adyen-hosted domain.',
  DETECTED_FAIL_URL: 'https://docs.adyen.com/online-payments/build-your-integration/',

  FLAVOR_ANALYTICS_DETAIL: 'Detected from Adyen checkout analytics data.',
  FLAVOR_DROPIN_DETAIL: 'Detected based on CDN resource URL patterns.',
  FLAVOR_CONFIG_DETAIL:
    'Detected based on checkout config presence (analytics disabled or unavailable).',
  FLAVOR_NO_CHECKOUT_TITLE: 'No Adyen Web checkout was mounted on this page.',
  FLAVOR_NO_CHECKOUT_DETAIL:
    'The Adyen Web SDK JavaScript is loaded, but no Drop-in or Component appears to have been initialised. Navigate to the page where checkout is rendered and scan again.',
  FLAVOR_UNKNOWN_DETAIL:
    'Could not determine the integration flavor from analytics, URL patterns, or page config.',

  IMPORT_METHOD_NPM_DETAIL: 'SDK bundled via npm import (no Adyen-hosted script tag detected).',
  IMPORT_METHOD_CDN_DETAIL: 'SDK loaded via <script src> from *.cdn.adyen.com.',
  IMPORT_METHOD_ADYEN_DETAIL: 'SDK loaded via <script src> from *.adyen.com (non-CDN host).',

  BUNDLE_TYPE_CDN_SKIP_TITLE: 'Bundle type check skipped.',
  BUNDLE_TYPE_CDN_SKIP_REASON: 'Not applicable for CDN imports.',
  BUNDLE_TYPE_UNKNOWN_SKIP_TITLE: 'Could not determine bundle type.',
  BUNDLE_TYPE_UNKNOWN_SKIP_REASON: 'AdyenWebMetadata not available.',
  BUNDLE_AUTO_WARN_TITLE: 'Using the auto bundle — consider switching to tree-shakable imports.',
  // BUNDLE_AUTO_WARN_DETAIL stays inline (dynamic: uses bundleType)
  BUNDLE_AUTO_WARN_REMEDIATION:
    'Switch from the auto bundle to tree-shakable imports. Instead of importing the entire Adyen Web package, import only the specific payment method components your integration uses. This significantly reduces JavaScript bundle size and improves checkout page load time.',
  BUNDLE_AUTO_WARN_URL: 'https://docs.adyen.com/online-payments/upgrade-your-integration/',

  ANALYTICS_SKIP_TITLE: 'Analytics check skipped.',
  ANALYTICS_SKIP_REASON: 'SDK not active on this page.',
  ANALYTICS_WARN_TITLE: 'Checkout analytics appear to be disabled.',
  ANALYTICS_WARN_DETAIL:
    'Checkout config sets analytics.enabled to false. When analytics is disabled, Adyen cannot optimise payment performance and the inspector must rely on fallback detection for flavor, version, and build type.',
  ANALYTICS_WARN_REMEDIATION:
    'Remove the analytics.enabled: false setting from your AdyenCheckout configuration. Checkout analytics are enabled by default and allow Adyen to optimise payment performance. Disabling analytics also prevents the inspector from reliably detecting integration flavor, version, and bundle type.',
  ANALYTICS_WARN_URL: 'https://docs.adyen.com/online-payments/analytics-and-data-tracking/',
  ANALYTICS_PASS_TITLE: 'Checkout analytics are not explicitly disabled.',
  ANALYTICS_PASS_DETAIL: 'analytics.enabled is not set to false in checkout config.',
} as const;

const CATEGORY = 'sdk-identity' as const;

export const SDK_IDENTITY_CHECKS = createRegistry(CATEGORY)
  .add('sdk-detected', (payload, { info, fail }) => {
    const { adyenMetadata, scripts } = payload.page;
    const hasAdyenScript = scripts.some((s) => isAdyenCheckoutResource(s.src));
    if (adyenMetadata !== null || hasAdyenScript) {
      return info(STRINGS.DETECTED_INFO_TITLE);
    }
    return fail(
      STRINGS.DETECTED_FAIL_TITLE,
      STRINGS.DETECTED_FAIL_DETAIL,
      STRINGS.DETECTED_FAIL_REMEDIATION,
      STRINGS.DETECTED_FAIL_URL
    );
  })
  .add('sdk-flavor', (payload, { info }) => {
    const flavorResolution = resolveIntegrationFlavor(payload);

    if (flavorResolution.source === 'analytics') {
      return info(
        `Integration flavor: ${flavorResolution.flavor}.`,
        STRINGS.FLAVOR_ANALYTICS_DETAIL
      );
    }

    if (flavorResolution.source === 'dropin-pattern') {
      return info(`Integration flavor: ${flavorResolution.flavor}.`, STRINGS.FLAVOR_DROPIN_DETAIL);
    }

    if (flavorResolution.source === 'checkout-config') {
      return info(`Integration flavor: ${flavorResolution.flavor}.`, STRINGS.FLAVOR_CONFIG_DETAIL);
    }

    if (flavorResolution.source === 'sdk-loaded-no-checkout') {
      return info(STRINGS.FLAVOR_NO_CHECKOUT_TITLE, STRINGS.FLAVOR_NO_CHECKOUT_DETAIL);
    }

    return info(`Integration flavor: ${flavorResolution.flavor}.`, STRINGS.FLAVOR_UNKNOWN_DETAIL);
  })
  .add('sdk-import-method', (payload, { info }) => {
    const { scripts } = payload.page;
    const method = detectImportMethod(scripts);

    let detail: string = STRINGS.IMPORT_METHOD_NPM_DETAIL;
    if (method === 'CDN') {
      detail = STRINGS.IMPORT_METHOD_CDN_DETAIL;
    } else if (method === 'Adyen') {
      detail = STRINGS.IMPORT_METHOD_ADYEN_DETAIL;
    }

    return info(`Import method: ${method}.`, detail);
  })
  .add('sdk-bundle-type', (payload, { skip, warn, pass }) => {
    const { adyenMetadata, scripts } = payload.page;
    const isCdn = scripts.some((s) => isCdnCheckoutScriptUrl(s.src));

    if (isCdn) {
      return skip(STRINGS.BUNDLE_TYPE_CDN_SKIP_TITLE, STRINGS.BUNDLE_TYPE_CDN_SKIP_REASON);
    }

    const bundleType = adyenMetadata?.bundleType ?? payload.analyticsData?.buildType ?? 'unknown';

    if (adyenMetadata === null && payload.analyticsData?.buildType === undefined) {
      return skip(STRINGS.BUNDLE_TYPE_UNKNOWN_SKIP_TITLE, STRINGS.BUNDLE_TYPE_UNKNOWN_SKIP_REASON);
    }

    if (bundleType === 'auto') {
      return warn(
        STRINGS.BUNDLE_AUTO_WARN_TITLE,
        `Bundle type is "${bundleType}". The auto bundle includes all payment methods, increasing bundle size.`,
        STRINGS.BUNDLE_AUTO_WARN_REMEDIATION,
        STRINGS.BUNDLE_AUTO_WARN_URL
      );
    }

    return pass(`Bundle type "${bundleType}" is optimised.`);
  })
  .add('sdk-analytics', (payload, { skip, warn, pass }) => {
    const sdkLoaded =
      payload.page.adyenMetadata !== null ||
      payload.page.scripts.some((s) => isAdyenCheckoutResource(s.src));
    if (!sdkLoaded || !hasCheckoutActivity(payload)) {
      return skip(STRINGS.ANALYTICS_SKIP_TITLE, STRINGS.ANALYTICS_SKIP_REASON);
    }

    if (payload.page.checkoutConfig?.analyticsEnabled === false) {
      return warn(
        STRINGS.ANALYTICS_WARN_TITLE,
        STRINGS.ANALYTICS_WARN_DETAIL,
        STRINGS.ANALYTICS_WARN_REMEDIATION,
        STRINGS.ANALYTICS_WARN_URL
      );
    }

    return pass(STRINGS.ANALYTICS_PASS_TITLE, STRINGS.ANALYTICS_PASS_DETAIL);
  })
  .getChecks();
