/**
 * Category 6 — Risk Module checks.
 */

import { DF_IFRAME_NAME, DF_IFRAME_URL_PATTERN } from '../../shared/constants.js';
import { SKIP_REASONS } from './constants.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'risk' as const;

const RISK_MANAGEMENT_URL = 'https://docs.adyen.com/risk-management/';

const STRINGS = {
  DF_IFRAME_PASS_TITLE: 'Device fingerprint iframe loaded.',
  DF_IFRAME_PASS_DETAIL: 'Adyen risk module device fingerprinting is active.',
  DF_IFRAME_WARN_TITLE: 'Device fingerprint iframe was not detected.',
  DF_IFRAME_WARN_DETAIL:
    "The device fingerprint iframe provides signals to Adyen's risk engine; without it, fraud scoring is degraded, increasing chargeback risk.",
  DF_IFRAME_WARN_REMEDIATION:
    'Verify that the Adyen risk module is enabled and that your Content-Security-Policy allows the Adyen device fingerprinting iframe to load. Check that no browser extension or content blocker on the test device is preventing the iframe from being created.',
  DF_IFRAME_WARN_URL: RISK_MANAGEMENT_URL,
  MODULE_SKIP_TITLE: 'Risk module setting check skipped.',
  MODULE_PASS_TITLE: 'Risk module is enabled.',
  MODULE_WARN_TITLE: 'Risk module is explicitly disabled (riskEnabled: false).',
  MODULE_WARN_DETAIL:
    'Disabling the Adyen risk module removes fraud detection entirely, increasing chargeback exposure.',
  MODULE_WARN_REMEDIATION:
    "Remove the riskEnabled: false setting from your AdyenCheckout configuration, or replace it with a fully tested alternative fraud and risk management solution. Disabling the risk module eliminates Adyen's device fingerprinting signals entirely and increases your exposure to fraudulent transactions and chargebacks.",
  MODULE_WARN_URL: RISK_MANAGEMENT_URL,
} as const;

export const RISK_CHECKS = createRegistry(CATEGORY)
  .add('risk-df-iframe', (payload, { pass, warn }) => {
    const { page, capturedRequests } = payload;
    const hasDfIframe =
      page.iframes.some((f) => f.name === DF_IFRAME_NAME) ||
      capturedRequests.some((r) => DF_IFRAME_URL_PATTERN.test(r.url));

    if (hasDfIframe) {
      return pass(STRINGS.DF_IFRAME_PASS_TITLE, STRINGS.DF_IFRAME_PASS_DETAIL);
    }

    return warn(
      STRINGS.DF_IFRAME_WARN_TITLE,
      STRINGS.DF_IFRAME_WARN_DETAIL,
      STRINGS.DF_IFRAME_WARN_REMEDIATION,
      STRINGS.DF_IFRAME_WARN_URL
    );
  })
  .add('risk-module-not-disabled', (payload, { skip, warn, pass }) => {
    const config = payload.page.checkoutConfig ?? payload.page.componentConfig;

    if (!config) {
      return skip(STRINGS.MODULE_SKIP_TITLE, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
    }

    if (config.riskEnabled === false) {
      return warn(
        STRINGS.MODULE_WARN_TITLE,
        STRINGS.MODULE_WARN_DETAIL,
        STRINGS.MODULE_WARN_REMEDIATION,
        STRINGS.MODULE_WARN_URL
      );
    }

    return pass(STRINGS.MODULE_PASS_TITLE);
  })
  .getChecks();
