/**
 * Adyen Web v6 upgrade deprecation checks.
 *
 * Detects configuration properties and event handlers that were removed or
 * renamed in Adyen Web v6. Warns merchants who may not have cleaned up their
 * integration after upgrading.
 * @see https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6
 */

import type { CheckoutConfig, ScanPayload } from '../../shared/types.js';
import {
  CALLBACK_KEYS,
  DEPRECATED_CALLBACK_KEYS,
  STRING_OPTION_KEYS,
} from '../../shared/checkout-config-schema.js';
import { readCheckoutField } from '../../shared/scan-evidence.js';
import { parseVersion } from '../../shared/utils.js';
import { SKIP_REASONS } from './constants.js';
import { createRegistry, type CheckContext, type CheckOutcome } from './registry.js';

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

const DEPRECATED_CALLBACK_GUIDANCE: Record<
  (typeof DEPRECATED_CALLBACK_KEYS)[number],
  Omit<DeprecatedItem, 'key'>
> = {
  onValid: {
    label: 'onValid',
    remediation: 'Remove it; this event listener is no longer used.',
  },
  onOrderCreated: {
    label: 'onOrderCreated',
    remediation: 'Rename to onOrderUpdated.',
  },
  onShippingChange: {
    label: 'onShippingChange (PayPal)',
    remediation: 'Replace with onShippingAddressChange() and onShippingOptionsChange().',
  },
  onShopperDetails: {
    label: 'onShopperDetails (PayPal)',
    remediation:
      'Rename to onAuthorized({authorizedEvent, billingAddress, deliveryAddress}, actions).',
  },
};

const DEPRECATED_CALLBACKS: readonly DeprecatedItem[] = DEPRECATED_CALLBACK_KEYS.map((key) => ({
  key,
  ...DEPRECATED_CALLBACK_GUIDANCE[key],
}));

/** Non-deprecated fields used as evidence that checkout config was captured. */
const KNOWN_FIELDS: readonly ConfigKey[] = [
  ...STRING_OPTION_KEYS,
  'riskEnabled',
  'analyticsEnabled',
  'hasSession',
  ...CALLBACK_KEYS,
];

function isCaptured(payload: ScanPayload, key: ConfigKey): boolean {
  return readCheckoutField(payload, key, { includeInferred: false }).state === 'present';
}

function canVerifyAbsence(payload: ScanPayload, items: readonly DeprecatedItem[]): boolean {
  return (
    items.every(
      (item) => readCheckoutField(payload, item.key, { includeInferred: false }).state === 'absent'
    ) && KNOWN_FIELDS.some((key) => isCaptured(payload, key))
  );
}

function buildDetail(found: readonly DeprecatedItem[]): string {
  return found.map((item) => `${item.label}: ${item.remediation}`).join('\n');
}

function isPreV6(payload: ScanPayload): boolean {
  const version = parseVersion(payload.versionInfo.detected ?? '');
  return version !== null && version.major < 6;
}

interface DeprecationCheck {
  readonly items: readonly DeprecatedItem[];
  readonly skipTitle: string;
  readonly passTitle: string;
  readonly singular: string;
  readonly plural: string;
  readonly remediation: string;
}

function runDeprecationCheck(
  payload: ScanPayload,
  check: DeprecationCheck,
  { warn, skip, pass }: CheckContext
): CheckOutcome {
  if (isPreV6(payload)) {
    return skip(check.skipTitle, 'SDK is running a pre-v6 version.');
  }
  const found = check.items.filter((item) => isCaptured(payload, item.key));
  if (found.length === 0) {
    return canVerifyAbsence(payload, check.items)
      ? pass(check.passTitle)
      : skip(check.skipTitle, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
  }

  const names = found.map((item) => item.label).join(', ');
  return warn(
    `Deprecated v6 ${found.length === 1 ? check.singular : check.plural} detected: ${names}.`,
    buildDetail(found),
    check.remediation,
    UPGRADE_DOCS_URL
  );
}

export const V6_DEPRECATION_CHECKS = createRegistry('version-lifecycle')
  .add('v6-deprecated-properties', (payload, context) =>
    runDeprecationCheck(
      payload,
      {
        items: DEPRECATED_PROPERTIES,
        skipTitle: 'v6 deprecated properties check skipped.',
        passTitle: 'No deprecated configuration properties detected.',
        singular: 'configuration property',
        plural: 'configuration properties',
        remediation:
          'Remove or migrate the deprecated properties listed above. See the Adyen v6 upgrade guide for details.',
      },
      context
    )
  )
  .add('v6-deprecated-callbacks', (payload, context) =>
    runDeprecationCheck(
      payload,
      {
        items: DEPRECATED_CALLBACKS,
        skipTitle: 'v6 deprecated callbacks check skipped.',
        passTitle: 'No deprecated event handlers detected.',
        singular: 'event handler',
        plural: 'event handlers',
        remediation:
          'Remove or rename the deprecated event handlers listed above. See the Adyen v6 upgrade guide for details.',
      },
      context
    )
  )
  .getChecks();
