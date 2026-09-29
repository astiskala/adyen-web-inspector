/**
 * Checkout configuration evidence — answers what the scan observed about each
 * checkout option and about checkout configuration as a whole. Owns source
 * precedence, the rule that only directly captured AdyenCheckout options prove
 * a field was not set, and the rule that option-shaped page JSON alone does
 * not show checkout is configured.
 */

import { readTranslationLocale } from './adyen-endpoint.js';
import type {
  CapturedRequest,
  CheckoutConfig,
  CheckoutPage,
  InferenceSignal,
  ScanPayload,
} from './types.js';

/** Where a Checkout configuration value was observed, in precedence order. */
export type ConfigSource = 'captured' | 'component' | 'inferred';

type ConfigKey = keyof CheckoutConfig;

interface ConfigObservation<K extends ConfigKey> {
  readonly value: NonNullable<CheckoutConfig[K]>;
  readonly source: ConfigSource;
  /** For inferred values: the partial signal the value was read from. */
  readonly signal?: InferenceSignal;
}

/**
 * Evidence for one field. `absent` means directly captured AdyenCheckout
 * options prove the field was not set; `unobserved` means absence cannot be
 * verified, with `no-config` when no checkout or component config was captured.
 */
export type CheckoutFieldEvidence<K extends ConfigKey> =
  | ({ readonly state: 'present' } & ConfigObservation<K>)
  | { readonly state: 'absent' }
  | { readonly state: 'unobserved'; readonly reason: 'no-config' | 'partial-config' };

interface ReadCheckoutFieldOptions {
  /** When false, values that were only inferred from requests or parsed JSON are ignored. */
  readonly includeInferred?: boolean;
}

/** The configuration slots of a frame's page extraction or of the Checkout page. */
type ConfigSlots = Pick<
  CheckoutPage,
  'capturedConfig' | 'componentConfig' | 'inferredConfig' | 'pageJsonConfig'
>;

interface ConfigSlot {
  readonly source: ConfigSource;
  readonly signal?: InferenceSignal;
  readonly read: (page: ConfigSlots) => CheckoutConfig | null;
}

/** Slots in precedence order: captured, component, then inferred from Adyen requests, then page JSON. */
const SLOTS: readonly ConfigSlot[] = [
  { source: 'captured', read: (page) => page.capturedConfig?.options ?? null },
  { source: 'component', read: (page) => page.componentConfig },
  { source: 'inferred', signal: 'adyen-request', read: (page) => page.inferredConfig },
  { source: 'inferred', signal: 'page-json', read: (page) => page.pageJsonConfig },
];

/** Slots that show checkout is configured; page JSON alone does not. */
const CONFIGURING_SLOTS = SLOTS.filter(({ signal }) => signal !== 'page-json');

function isObserved<V>(value: V | '' | undefined): value is V {
  return value !== undefined && value !== '';
}

/** Returns every observation of a field, strongest source first. */
export function listCheckoutFieldObservations<K extends ConfigKey>(
  payload: ScanPayload,
  key: K
): ConfigObservation<K>[] {
  return SLOTS.flatMap(({ source, signal, read }) => {
    const value = read(payload.page)?.[key];
    if (!isObserved(value)) return [];
    const observed = value as NonNullable<CheckoutConfig[K]>;
    return [
      signal === undefined ? { value: observed, source } : { value: observed, source, signal },
    ];
  });
}

/**
 * Returns the sources that show checkout is configured: captured options,
 * a mounted tree, or values inferred from Adyen requests. Option-shaped page
 * JSON alone does not count, because any page data can carry such fields.
 */
export function checkoutConfigSources(page: ConfigSlots): ReadonlySet<ConfigSource> {
  return new Set(
    CONFIGURING_SLOTS.filter(({ read }) => read(page) !== null).map(({ source }) => source)
  );
}

/** Returns true when checkout or component configuration was captured, not merely inferred. */
export function hasCapturedCheckoutConfig(page: ConfigSlots): boolean {
  return page.capturedConfig !== null || page.componentConfig !== null;
}

/** Returns true when AdyenCheckout options were captured whole, so options missing from them are absent. */
export function hasCompleteCheckoutConfig(page: ConfigSlots): boolean {
  return page.capturedConfig?.complete === true;
}

/** Reads the strongest observation of a field and whether its absence is proven. */
export function readCheckoutField<K extends ConfigKey>(
  payload: ScanPayload,
  key: K,
  options: ReadCheckoutFieldOptions = {}
): CheckoutFieldEvidence<K> {
  const includeInferred = options.includeInferred ?? true;
  const observation = listCheckoutFieldObservations(payload, key).find(
    (candidate) => includeInferred || candidate.source !== 'inferred'
  );
  if (observation !== undefined) return { state: 'present', ...observation };
  if (hasCompleteCheckoutConfig(payload.page)) return { state: 'absent' };
  return {
    state: 'unobserved',
    reason: hasCapturedCheckoutConfig(payload.page) ? 'partial-config' : 'no-config',
  };
}

/** Infers a locale from Adyen translation requests when no stronger source shows one. */
export function withRequestDerivedLocale(
  page: CheckoutPage,
  requests: readonly CapturedRequest[]
): CheckoutPage {
  const observed = CONFIGURING_SLOTS.some(({ read }) => isObserved(read(page)?.locale));
  if (observed) return page;

  const locale = requests
    .map((request) => readTranslationLocale(request.url))
    .find((candidate) => candidate !== null);
  return locale === undefined
    ? page
    : { ...page, inferredConfig: { ...page.inferredConfig, locale } };
}
