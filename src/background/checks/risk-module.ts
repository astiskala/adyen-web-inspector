/**
 * Risk checks (`risk`) — device fingerprinting, risk data collection, and the cardholder name
 * field.
 */

import { DF_IFRAME_NAME, DF_IFRAME_URL_PATTERN } from '../../shared/constants.js';
import { readCheckoutField } from '../../shared/scan-evidence.js';
import { SKIP_REASONS } from './constants.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'risk' as const;

const RISK_MANAGEMENT_URL = 'https://docs.adyen.com/risk-management/';

const STRINGS = {
  DF_IFRAME_SKIP_TITLE: 'Device fingerprint check skipped.',
  DF_IFRAME_SKIP_REASON: 'No active Adyen checkout detected.',
  DF_IFRAME_PASS_TITLE: 'Device fingerprint iframe loaded.',
  DF_IFRAME_PASS_DETAIL: 'Adyen risk module device fingerprinting is active.',
  DF_IFRAME_WARN_TITLE: 'Device fingerprint iframe was not detected.',
  DF_IFRAME_WARN_DETAIL:
    "The device fingerprint iframe provides signals to Adyen's risk engine; without it, fraud scoring is degraded, increasing chargeback risk.",
  DF_IFRAME_WARN_REMEDIATION:
    'Verify that the Adyen risk module is enabled and that your Content-Security-Policy allows the Adyen device fingerprinting iframe to load. Check that no browser extension or content blocker on the test device is preventing the iframe from being created.',
  DF_IFRAME_WARN_URL: RISK_MANAGEMENT_URL,
  MODULE_SKIP_TITLE: 'Risk module setting check skipped.',
  MODULE_PARTIAL_SKIP_REASON: 'Risk setting was not visible in partial checkout configuration.',
  MODULE_PASS_TITLE: 'Risk data collection is not explicitly disabled in observed checkout config.',
  MODULE_WARN_TITLE: 'Risk data collection is explicitly disabled.',
  MODULE_WARN_DETAIL:
    "Disabling browser data collection removes device signals used by Adyen's risk engine and can reduce fraud detection effectiveness.",
  MODULE_WARN_REMEDIATION:
    'Remove risk.enabled: false (or legacy riskEnabled: false) from your AdyenCheckout configuration unless you have intentionally disabled browser data collection after assessing the fraud-detection impact.',
  MODULE_WARN_URL: RISK_MANAGEMENT_URL,
  HOLDER_NAME_SKIP_TITLE: 'Cardholder name field check skipped.',
  HOLDER_NAME_SKIP_REASON: 'No rendered new-card form was detected.',
  HOLDER_NAME_PASS_TITLE: 'Card form collects the cardholder name.',
  HOLDER_NAME_NOTICE_TITLE: 'Card form does not show a cardholder name field.',
  HOLDER_NAME_NOTICE_DETAIL:
    'For 3D Secure 2, Adyen documents holderName as required for Visa and JCB transactions and recommends including it whenever available for higher authentication rates. If you collect the name elsewhere and send holderName in the /payments request, no change is needed.',
  HOLDER_NAME_NOTICE_REMEDIATION:
    'Set hasHolderName: true (and holderNameRequired: true where appropriate) in your Card configuration, or confirm that your server sends holderName from another source.',
  HOLDER_NAME_NOTICE_URL: 'https://docs.adyen.com/online-payments/3d-secure/api-reference/',
} as const;

export const RISK_CHECKS = createRegistry(CATEGORY)
  .add(
    'risk-df-iframe',
    (payload, { attributes, pass, skip, warn }) => {
      if (!attributes.checkoutActivity) {
        return skip(STRINGS.DF_IFRAME_SKIP_TITLE, STRINGS.DF_IFRAME_SKIP_REASON);
      }

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
    },
    { warnImpact: 'high' }
  )
  .add(
    'risk-module-not-disabled',
    (payload, { skip, warn, pass }) => {
      const risk = readCheckoutField(payload, 'riskEnabled', { includeInferred: false });

      if (risk.state === 'unobserved' && risk.reason === 'no-config') {
        return skip(STRINGS.MODULE_SKIP_TITLE, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
      }

      if (risk.state === 'present' && !risk.value) {
        return warn(
          STRINGS.MODULE_WARN_TITLE,
          STRINGS.MODULE_WARN_DETAIL,
          STRINGS.MODULE_WARN_REMEDIATION,
          STRINGS.MODULE_WARN_URL
        );
      }
      if (risk.state === 'unobserved') {
        return skip(STRINGS.MODULE_SKIP_TITLE, STRINGS.MODULE_PARTIAL_SKIP_REASON);
      }

      return pass(STRINGS.MODULE_PASS_TITLE);
    },
    { warnImpact: 'high' }
  )
  .add('risk-card-holder-name', (payload, { skip, pass, notice }) => {
    if (payload.page.hasNewCardFormDOM !== true) {
      return skip(STRINGS.HOLDER_NAME_SKIP_TITLE, STRINGS.HOLDER_NAME_SKIP_REASON);
    }
    if (payload.page.hasCardHolderNameDOM === true) {
      return pass(STRINGS.HOLDER_NAME_PASS_TITLE);
    }
    return notice(
      STRINGS.HOLDER_NAME_NOTICE_TITLE,
      STRINGS.HOLDER_NAME_NOTICE_DETAIL,
      STRINGS.HOLDER_NAME_NOTICE_REMEDIATION,
      STRINGS.HOLDER_NAME_NOTICE_URL
    );
  })
  .getChecks();
