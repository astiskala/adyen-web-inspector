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

const CATEGORY = 'sdk-identity' as const;

export const SDK_IDENTITY_CHECKS = createRegistry(CATEGORY)
  .add('sdk-detected', (payload, { info, fail }) => {
    const { adyenMetadata, scripts } = payload.page;
    const hasAdyenScript = scripts.some((s) => isAdyenCheckoutResource(s.src));
    if (adyenMetadata !== null || hasAdyenScript) {
      return info('Adyen Web SDK detected on this page.');
    }
    return fail(
      'Adyen Web SDK was not detected on this page.',
      'No window.AdyenWebMetadata or CDN script tag was found.',
      'Verify that the Adyen Web SDK is correctly loaded on this page. If using an npm import, enable exposeLibraryMetadata in your AdyenCheckout configuration so the inspector can detect the SDK. If using a CDN script tag, confirm the script URL is from an Adyen-hosted domain.',
      'https://docs.adyen.com/online-payments/build-your-integration/'
    );
  })
  .add('sdk-flavor', (payload, { info }) => {
    const flavorResolution = resolveIntegrationFlavor(payload);

    if (flavorResolution.source === 'analytics') {
      return info(
        `Integration flavor: ${flavorResolution.flavor}.`,
        'Detected from Adyen checkout analytics data.'
      );
    }

    if (flavorResolution.source === 'dropin-pattern') {
      return info(
        `Integration flavor: ${flavorResolution.flavor}.`,
        'Detected based on CDN resource URL patterns.'
      );
    }

    if (flavorResolution.source === 'checkout-config') {
      return info(
        `Integration flavor: ${flavorResolution.flavor}.`,
        'Detected based on checkout config presence (analytics disabled or unavailable).'
      );
    }

    if (flavorResolution.source === 'sdk-loaded-no-checkout') {
      return info(
        'No Adyen Web checkout was mounted on this page.',
        'The Adyen Web SDK JavaScript is loaded, but no Drop-in or Component appears to have been initialised. Navigate to the page where checkout is rendered and scan again.'
      );
    }

    return info(
      `Integration flavor: ${flavorResolution.flavor}.`,
      'Could not determine the integration flavor from analytics, URL patterns, or page config.'
    );
  })
  .add('sdk-import-method', (payload, { info }) => {
    const { scripts } = payload.page;
    const method = detectImportMethod(scripts);

    let detail = 'SDK bundled via npm import (no Adyen-hosted script tag detected).';
    if (method === 'CDN') {
      detail = 'SDK loaded via <script src> from *.cdn.adyen.com.';
    } else if (method === 'Adyen') {
      detail = 'SDK loaded via <script src> from *.adyen.com (non-CDN host).';
    }

    return info(`Import method: ${method}.`, detail);
  })
  .add('sdk-bundle-type', (payload, { skip, warn, pass }) => {
    const { adyenMetadata, scripts } = payload.page;
    const isCdn = scripts.some((s) => isCdnCheckoutScriptUrl(s.src));

    if (isCdn) {
      return skip('Bundle type check not applicable for CDN imports.');
    }

    const bundleType = adyenMetadata?.bundleType ?? payload.analyticsData?.buildType ?? 'unknown';

    if (adyenMetadata === null && payload.analyticsData?.buildType === undefined) {
      return skip('Could not determine bundle type (AdyenWebMetadata not available).');
    }

    if (bundleType === 'auto') {
      return warn(
        'Using the auto bundle — consider switching to tree-shakable imports.',
        `Bundle type is "${bundleType}". The auto bundle includes all payment methods, increasing bundle size.`,
        'Switch from the auto bundle to tree-shakable imports. Instead of importing the entire Adyen Web package, import only the specific payment method components your integration uses. This significantly reduces JavaScript bundle size and improves checkout page load time.',
        'https://docs.adyen.com/online-payments/upgrade-your-integration/'
      );
    }

    return pass(`Bundle type "${bundleType}" is optimised.`);
  })
  .add('sdk-analytics', (payload, { skip, warn, pass }) => {
    const sdkLoaded =
      payload.page.adyenMetadata !== null ||
      payload.page.scripts.some((s) => isAdyenCheckoutResource(s.src));
    if (!sdkLoaded || !hasCheckoutActivity(payload)) {
      return skip('Analytics check skipped — SDK not active on this page.');
    }

    if (payload.page.checkoutConfig?.analyticsEnabled === false) {
      return warn(
        'Checkout analytics appear to be disabled.',
        'Checkout config sets analytics.enabled to false. When analytics is disabled, Adyen cannot optimise payment performance and the inspector must rely on fallback detection for flavor, version, and build type.',
        'Remove the analytics.enabled: false setting from your AdyenCheckout configuration. Checkout analytics are enabled by default and allow Adyen to optimise payment performance. Disabling analytics also prevents the inspector from reliably detecting integration flavor, version, and bundle type.',
        'https://docs.adyen.com/online-payments/analytics-and-data-tracking/'
      );
    }

    return pass(
      'Checkout analytics are not explicitly disabled.',
      'analytics.enabled is not set to false in checkout config.'
    );
  })
  .getChecks();
