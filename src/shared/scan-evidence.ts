/**
 * Checkout configuration evidence — answers what the scan observed about each
 * checkout option. Owns source precedence and the rule that only directly
 * captured AdyenCheckout options prove a field was not set.
 */

import type { CapturedRequest, CheckoutConfig, CheckoutPage, ScanPayload } from './types.js';
import { extractLocaleFromUrl } from './utils.js';

/** Where a Checkout configuration value was observed, in precedence order. */
export type ConfigSource = 'captured' | 'component' | 'inferred';

type ConfigKey = keyof CheckoutConfig;

interface ConfigObservation<K extends ConfigKey> {
  readonly value: NonNullable<CheckoutConfig[K]>;
  readonly source: ConfigSource;
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

type ConfigSlots = Pick<CheckoutPage, 'checkoutConfig' | 'componentConfig' | 'inferredConfig'>;

const SLOT_BY_SOURCE = {
  captured: 'checkoutConfig',
  component: 'componentConfig',
  inferred: 'inferredConfig',
} as const satisfies Record<ConfigSource, keyof ConfigSlots>;

const SOURCES = ['captured', 'component', 'inferred'] as const satisfies readonly ConfigSource[];

function isObserved<V>(value: V | '' | undefined): value is V {
  return value !== undefined && value !== '';
}

/** Returns every observation of a field, strongest source first. */
export function listCheckoutFieldObservations<K extends ConfigKey>(
  payload: ScanPayload,
  key: K
): ConfigObservation<K>[] {
  return SOURCES.flatMap((source) => {
    const value = payload.page[SLOT_BY_SOURCE[source]]?.[key];
    return isObserved(value) ? [{ value: value as NonNullable<CheckoutConfig[K]>, source }] : [];
  });
}

/** Returns the sources that produced any Checkout configuration. */
export function checkoutConfigSources(page: ConfigSlots): ReadonlySet<ConfigSource> {
  return new Set(SOURCES.filter((source) => page[SLOT_BY_SOURCE[source]] !== null));
}

/** Returns true when checkout or component configuration was captured, not merely inferred. */
export function hasCapturedCheckoutConfig(page: ConfigSlots): boolean {
  const sources = checkoutConfigSources(page);
  return sources.has('captured') || sources.has('component');
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
  if (payload.page.checkoutConfigComplete === true && payload.page.checkoutConfig !== null) {
    return { state: 'absent' };
  }
  return {
    state: 'unobserved',
    reason: hasCapturedCheckoutConfig(payload.page) ? 'partial-config' : 'no-config',
  };
}

/** Infers a locale from Adyen translation requests when no configuration shows one. */
export function withRequestDerivedLocale(
  page: CheckoutPage,
  requests: readonly CapturedRequest[]
): CheckoutPage {
  const observed = [page.checkoutConfig, page.componentConfig, page.inferredConfig].some((config) =>
    isObserved(config?.locale)
  );
  if (observed) return page;

  const locale = requests
    .map((request) => extractLocaleFromUrl(request.url))
    .find((candidate) => candidate !== null);
  return locale === undefined
    ? page
    : { ...page, inferredConfig: { ...page.inferredConfig, locale } };
}
