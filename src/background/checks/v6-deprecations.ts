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
  hasVerifiedCheckoutConfig,
  resolveCapturedCheckoutConfig,
} from '../../shared/scan-evidence.js';
import { parseVersion } from '../../shared/utils.js';
import { SKIP_REASONS } from './constants.js';
import { createRegistry, type CheckContext } from './registry.js';

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

/** Non-deprecated fields used as evidence that checkout config was captured. */
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

function hasAnyKnownField(config: CheckoutConfig, keys: readonly ConfigKey[]): boolean {
  return keys.some((key) => config[key] !== undefined);
}

function canVerifyConfig(payload: ScanPayload, config: CheckoutConfig | null): boolean {
  return (
    config !== null &&
    hasVerifiedCheckoutConfig(payload) &&
    (hasAnyKnownField(config, KNOWN_PROPERTIES) || hasAnyKnownField(config, KNOWN_CALLBACKS))
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
): ReturnType<CheckContext['pass']> {
  if (isPreV6(payload)) {
    return skip(check.skipTitle, 'SDK is running a pre-v6 version.');
  }
  const config = resolveCapturedCheckoutConfig(payload);
  const found = check.items.filter((item) => config?.[item.key] !== undefined);
  if (found.length === 0) {
    return canVerifyConfig(payload, config)
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
