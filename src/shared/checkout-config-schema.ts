/**
 * Config field schema — the single mapping from raw Adyen Web options to
 * Checkout configuration fields, shared by every capture path.
 *
 * Content scripts bundle this module inline, so it must not depend on
 * anything but types.
 */

import type { CallbackSource, CheckoutConfig } from './types.js';

/** Callback registrations evaluated by the callback checks. */
export const CALLBACK_KEYS = [
  'onSubmit',
  'onAdditionalDetails',
  'onPaymentCompleted',
  'onPaymentFailed',
  'onError',
  'beforeSubmit',
] as const satisfies readonly (keyof CheckoutConfig)[];

/** Callbacks removed or renamed in Adyen Web v6. */
export const DEPRECATED_CALLBACK_KEYS = [
  'onValid',
  'onOrderCreated',
  'onShippingChange',
  'onShopperDetails',
] as const satisfies readonly (keyof CheckoutConfig)[];

const ALL_CALLBACK_KEYS = [...CALLBACK_KEYS, ...DEPRECATED_CALLBACK_KEYS] as const;
type CallbackKey = (typeof ALL_CALLBACK_KEYS)[number];

/** String options copied verbatim from checkout options. */
export const STRING_OPTION_KEYS = [
  'clientKey',
  'environment',
  'locale',
  'countryCode',
] as const satisfies readonly (keyof CheckoutConfig)[];

const BOOLEAN_OPTION_KEYS = [
  'redirectFromTopWhenInIframe',
  'setStatusAutomatically',
  'showBrandsUnderCardNumber',
  'showFormInstruction',
] as const satisfies readonly (keyof CheckoutConfig)[];

const SOURCE_CALLBACK_KEYS = {
  onSubmit: 'onSubmitSource',
  beforeSubmit: 'beforeSubmitSource',
} as const satisfies Partial<Record<keyof CheckoutConfig, keyof CheckoutConfig>>;

/** Maximum captured callback source length; a source this long may be truncated. */
export const CALLBACK_SOURCE_LIMIT = 1200;

type PlainRecord = Record<string, unknown>;
type MutableConfig = { -readonly [K in keyof CheckoutConfig]: CheckoutConfig[K] };

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null;
}

function isCallbackRegistered(value: unknown): boolean {
  return typeof value === 'boolean' ? value : typeof value === 'function';
}

/**
 * Reads an explicit `enabled` flag. SDK defaults are not assumed, because
 * parsed page JSON also passes through this schema as inferred evidence.
 */
function readModuleToggle(value: unknown): boolean | undefined {
  if (!isPlainRecord(value)) return undefined;
  const enabled = value['enabled'];
  return typeof enabled === 'boolean' ? enabled : undefined;
}

function readRiskEnabled(options: PlainRecord): boolean | undefined {
  const risk = readModuleToggle(options['risk']);
  if (risk !== undefined) return risk;
  const legacy = options['riskEnabled'];
  if (typeof legacy === 'boolean') return legacy;
  return typeof legacy === 'function' ? true : undefined;
}

function readCallbackSource(callback: unknown): string | undefined {
  if (typeof callback !== 'function') return undefined;
  try {
    return (callback as () => unknown).toString().slice(0, CALLBACK_SOURCE_LIMIT);
  } catch {
    return undefined;
  }
}

function copyCallbacks(
  options: PlainRecord,
  placement: CallbackSource,
  target: MutableConfig
): void {
  for (const key of ALL_CALLBACK_KEYS) {
    if (isCallbackRegistered(options[key])) target[key] = placement;
  }
  for (const [key, sourceKey] of Object.entries(SOURCE_CALLBACK_KEYS)) {
    const source = readCallbackSource(options[key]);
    if (source !== undefined) target[sourceKey] = source;
  }
}

/**
 * Maps raw checkout or component options to Checkout configuration fields.
 * Returns null when the value is not an options object; otherwise returns the
 * observed fields, which may be empty.
 */
export function readCheckoutOptions(
  raw: unknown,
  placement: CallbackSource
): CheckoutConfig | null {
  if (!isPlainRecord(raw)) return null;
  const config: MutableConfig = {};

  for (const key of STRING_OPTION_KEYS) {
    const value = raw[key];
    if (typeof value === 'string') config[key] = value;
  }
  for (const key of BOOLEAN_OPTION_KEYS) {
    const value = raw[key];
    if (typeof value === 'boolean') config[key] = value;
  }

  const riskEnabled = readRiskEnabled(raw);
  if (riskEnabled !== undefined) config.riskEnabled = riskEnabled;
  const analyticsEnabled = readModuleToggle(raw['analytics']);
  if (analyticsEnabled !== undefined) config.analyticsEnabled = analyticsEnabled;
  if (isPlainRecord(raw['session'])) config.hasSession = true;
  if (isPlainRecord(raw['installmentOptions'])) config.installmentOptions = true;

  copyCallbacks(raw, placement, config);
  return config;
}

/** Merges configurations where earlier values win and later ones only fill gaps. */
export function mergeCheckoutConfigs(configs: readonly CheckoutConfig[]): CheckoutConfig | null {
  let merged: CheckoutConfig | null = null;
  for (const config of configs) {
    if (merged === null) {
      merged = config;
      continue;
    }
    const base: CheckoutConfig = merged;
    const gaps = Object.entries(config).filter(
      ([key, value]) => value !== undefined && base[key as keyof CheckoutConfig] === undefined
    );
    merged = { ...base, ...Object.fromEntries(gaps) };
  }
  return merged;
}

/**
 * Applies a newer capture over an existing one. Newer values win, except that
 * a callback already registered on AdyenCheckout keeps its checkout placement.
 */
export function applyCapturedOptions(
  current: CheckoutConfig | null,
  incoming: CheckoutConfig
): CheckoutConfig {
  if (current === null) return incoming;
  const allowed = Object.entries(incoming).filter(
    ([key]) => !isCallbackKey(key) || current[key] !== 'checkout'
  );
  return { ...current, ...Object.fromEntries(allowed) };
}

function isCallbackKey(key: string): key is CallbackKey {
  return (ALL_CALLBACK_KEYS as readonly string[]).includes(key);
}
