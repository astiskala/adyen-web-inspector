/**
 * Adyen Web v6 deprecation checks (`version-lifecycle`) — configuration properties and event
 * handlers that were removed or renamed in Adyen Web v6 and may remain after an upgrade.
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

const CATEGORY = 'version-lifecycle' as const;
const UPGRADE_DOCS_URL =
  'https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6';

const STRINGS = {
  PRE_V6_SKIP_REASON: 'SDK is running a pre-v6 version.',
  // WARN_TITLE stays inline (dynamic: lists the deprecated items found)
  PROPERTIES_SKIP_TITLE: 'v6 deprecated properties check skipped.',
  PROPERTIES_PASS_TITLE: 'No deprecated configuration properties detected.',
  PROPERTIES_SINGULAR: 'configuration property',
  PROPERTIES_PLURAL: 'configuration properties',
  PROPERTIES_REMEDIATION:
    'Remove or migrate the deprecated properties listed above. See the Adyen v6 upgrade guide for details.',
  CALLBACKS_SKIP_TITLE: 'v6 deprecated callbacks check skipped.',
  CALLBACKS_PASS_TITLE: 'No deprecated event handlers detected.',
  CALLBACKS_SINGULAR: 'event handler',
  CALLBACKS_PLURAL: 'event handlers',
  CALLBACKS_REMEDIATION:
    'Remove or rename the deprecated event handlers listed above. See the Adyen v6 upgrade guide for details.',
} as const;

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
    return skip(check.skipTitle, STRINGS.PRE_V6_SKIP_REASON);
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

export const V6_DEPRECATION_CHECKS = createRegistry(CATEGORY)
  .add('v6-deprecated-properties', (payload, context) =>
    runDeprecationCheck(
      payload,
      {
        items: DEPRECATED_PROPERTIES,
        skipTitle: STRINGS.PROPERTIES_SKIP_TITLE,
        passTitle: STRINGS.PROPERTIES_PASS_TITLE,
        singular: STRINGS.PROPERTIES_SINGULAR,
        plural: STRINGS.PROPERTIES_PLURAL,
        remediation: STRINGS.PROPERTIES_REMEDIATION,
      },
      context
    )
  )
  .add('v6-deprecated-callbacks', (payload, context) =>
    runDeprecationCheck(
      payload,
      {
        items: DEPRECATED_CALLBACKS,
        skipTitle: STRINGS.CALLBACKS_SKIP_TITLE,
        passTitle: STRINGS.CALLBACKS_PASS_TITLE,
        singular: STRINGS.CALLBACKS_SINGULAR,
        plural: STRINGS.CALLBACKS_PLURAL,
        remediation: STRINGS.CALLBACKS_REMEDIATION,
      },
      context
    )
  )
  .getChecks();
