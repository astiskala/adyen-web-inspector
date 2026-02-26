/**
 * Category 6 — Risk Module checks.
 */

import { DF_IFRAME_NAME, DF_IFRAME_URL_PATTERN } from '../../shared/constants.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'risk' as const;

export const RISK_CHECKS = createRegistry(CATEGORY)
  .add('risk-df-iframe', (payload, { pass, warn }) => {
    const { page, capturedRequests } = payload;
    const hasDfIframe =
      page.iframes.some((f) => f.name === DF_IFRAME_NAME) ||
      capturedRequests.some((r) => DF_IFRAME_URL_PATTERN.test(r.url));

    if (hasDfIframe) {
      return pass(
        'Device fingerprint iframe loaded.',
        'Adyen risk module device fingerprinting is active.'
      );
    }

    return warn(
      'Device fingerprint iframe was not detected.',
      "The device fingerprint iframe provides signals to Adyen's risk engine; without it, fraud scoring is degraded, increasing chargeback risk.",
      'Verify that the Adyen risk module is enabled and that your Content-Security-Policy allows the Adyen device fingerprinting iframe to load. Check that no browser extension or content blocker on the test device is preventing the iframe from being created.',
      'https://docs.adyen.com/risk-management/'
    );
  })
  .add('risk-module-not-disabled', (payload, { skip, warn, pass }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip('Risk module setting check skipped — checkout config not detected.');
    }

    if (config.riskEnabled === false) {
      return warn(
        'Risk module is explicitly disabled (riskEnabled: false).',
        'Disabling the Adyen risk module removes fraud detection entirely, increasing chargeback exposure.',
        "Remove the riskEnabled: false setting from your AdyenCheckout configuration, or replace it with a fully tested alternative fraud and risk management solution. Disabling the risk module eliminates Adyen's device fingerprinting signals entirely and increases your exposure to fraudulent transactions and chargebacks.",
        'https://docs.adyen.com/risk-management/'
      );
    }

    return pass('Risk module is enabled.');
  })
  .getChecks();
