/**
 * v6 Upgrade Deprecation checks.
 *
 * Detects configuration properties and event handlers that were removed or
 * renamed in Adyen Web v6. Warns merchants who may not have cleaned up their
 * integration after upgrading.
 * @see https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6
 */

import type { CheckoutConfig, ScanPayload } from '../../shared/types.js';
import { SKIP_REASONS } from './constants.js';
import { createRegistry } from './registry.js';

const UPGRADE_DOCS_URL =
  'https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6';

type ConfigKey = keyof CheckoutConfig;

interface DeprecatedItem {
  readonly key: ConfigKey;
  readonly label: string;
  readonly remediation: string;
}

const DEPRECATED_PROPERTIES: readonly DeprecatedItem[] = [
  {
    key: 'setStatusAutomatically',
    label: 'setStatusAutomatically',
    remediation: 'Remove it; use disableFinalAnimation: true instead.',
  },
  {
    key: 'installmentOptions',
    label: 'installmentOptions (global)',
    remediation: 'Move it into your Card component configuration.',
  },
  {
    key: 'showBrandsUnderCardNumber',
    label: 'showBrandsUnderCardNumber',
    remediation: 'Remove it; this property is no longer used.',
  },
  {
    key: 'showFormInstruction',
    label: 'showFormInstruction',
    remediation: 'Remove it; this property is no longer used.',
  },
];

const DEPRECATED_CALLBACKS: readonly DeprecatedItem[] = [
  {
    key: 'onValid',
    label: 'onValid',
    remediation: 'Remove it; this event listener is no longer used.',
  },
  {
    key: 'onOrderCreated',
    label: 'onOrderCreated',
    remediation: 'Rename to onOrderUpdated.',
  },
  {
    key: 'onShippingChange',
    label: 'onShippingChange (PayPal)',
    remediation: 'Replace with onShippingAddressChange() and onShippingOptionsChange().',
  },
  {
    key: 'onShopperDetails',
    label: 'onShopperDetails (PayPal)',
    remediation:
      'Rename to onAuthorized({authorizedEvent, billingAddress, deliveryAddress}, actions).',
  },
];

/** Standard (non-deprecated) config fields that prove config interception is working. */
const KNOWN_PROPERTIES: readonly ConfigKey[] = [
  'clientKey',
  'environment',
  'locale',
  'countryCode',
  'riskEnabled',
  'analyticsEnabled',
  'hasSession',
];

const KNOWN_CALLBACKS: readonly ConfigKey[] = [
  'onSubmit',
  'onAdditionalDetails',
  'onPaymentCompleted',
  'onPaymentFailed',
  'onError',
  'beforeSubmit',
];

function hasAnyKnownField(payload: ScanPayload, keys: readonly ConfigKey[]): boolean {
  for (const key of keys) {
    if (
      payload.page.checkoutConfig?.[key] !== undefined ||
      payload.page.componentConfig?.[key] !== undefined
    ) {
      return true;
    }
  }
  return false;
}

function canVerifyConfig(payload: ScanPayload): boolean {
  return hasAnyKnownField(payload, KNOWN_PROPERTIES) || hasAnyKnownField(payload, KNOWN_CALLBACKS);
}

function detectPresent(payload: ScanPayload, items: readonly DeprecatedItem[]): DeprecatedItem[] {
  return items.filter(
    (item) =>
      payload.page.checkoutConfig?.[item.key] !== undefined ||
      payload.page.componentConfig?.[item.key] !== undefined
  );
}

function buildDetail(found: readonly DeprecatedItem[]): string {
  return found.map((item) => `${item.label}: ${item.remediation}`).join('\n');
}

export const V6_DEPRECATION_CHECKS = createRegistry('version-lifecycle')
  .add('v6-deprecated-properties', (payload, { warn, skip, pass }) => {
    if (!canVerifyConfig(payload)) {
      return skip(
        'v6 deprecated properties check skipped.',
        SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED
      );
    }

    const found = detectPresent(payload, DEPRECATED_PROPERTIES);

    if (found.length === 0) {
      return pass('No deprecated configuration properties detected.');
    }

    const names = found.map((item) => item.label).join(', ');

    return warn(
      `Deprecated v6 configuration propert${found.length === 1 ? 'y' : 'ies'} detected: ${names}.`,
      buildDetail(found),
      'Remove or migrate the deprecated properties listed above. See the Adyen v6 upgrade guide for details.',
      UPGRADE_DOCS_URL
    );
  })
  .add('v6-deprecated-callbacks', (payload, { warn, skip, pass }) => {
    if (!canVerifyConfig(payload)) {
      return skip(
        'v6 deprecated callbacks check skipped.',
        SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED
      );
    }

    const found = detectPresent(payload, DEPRECATED_CALLBACKS);

    if (found.length === 0) {
      return pass('No deprecated event handlers detected.');
    }

    const names = found.map((item) => item.label).join(', ');

    return warn(
      `Deprecated v6 event handler${found.length === 1 ? '' : 's'} detected: ${names}.`,
      buildDetail(found),
      'Remove or rename the deprecated event handlers listed above. See the Adyen v6 upgrade guide for details.',
      UPGRADE_DOCS_URL
    );
  })
  .getChecks();
