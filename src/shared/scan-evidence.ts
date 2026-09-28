/**
 * Checkout configuration evidence — answers what the scan observed about each
 * checkout option. Owns source precedence, frame merging, and the rule that
 * only directly captured AdyenCheckout options prove a field was not set.
 */

import { mergeCheckoutConfigs } from './checkout-config-schema.js';
import type { CapturedRequest, CheckoutConfig, PageExtractResult, ScanPayload } from './types.js';
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

type ConfigSlots = Pick<PageExtractResult, 'checkoutConfig' | 'componentConfig' | 'inferredConfig'>;

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
export function checkoutConfigSources(payload: ScanPayload): ReadonlySet<ConfigSource> {
  return new Set(SOURCES.filter((source) => payload.page[SLOT_BY_SOURCE[source]] !== null));
}

/** Returns true when checkout or component configuration was captured, not merely inferred. */
export function hasCapturedCheckoutConfig(payload: ScanPayload): boolean {
  const sources = checkoutConfigSources(payload);
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
    reason: hasCapturedCheckoutConfig(payload) ? 'partial-config' : 'no-config',
  };
}

/** Infers a locale from Adyen translation requests when no configuration shows one. */
export function withRequestDerivedLocale(
  page: PageExtractResult,
  requests: readonly CapturedRequest[]
): PageExtractResult {
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

function mergeSlot(
  frames: readonly PageExtractResult[],
  slot: keyof ConfigSlots
): CheckoutConfig | null {
  return mergeCheckoutConfigs(
    frames.map((frame) => frame[slot]).filter((config) => config !== null)
  );
}

/**
 * Merges configuration observed across frames. Earlier frames win per field;
 * absence is provable when any frame captured AdyenCheckout options directly.
 */
export function mergeFrameCheckoutConfig(
  frames: readonly PageExtractResult[]
): ConfigSlots & Pick<PageExtractResult, 'checkoutConfigComplete'> {
  const complete = frames.some(
    (frame) => frame.checkoutConfigComplete === true && frame.checkoutConfig !== null
  );
  return {
    checkoutConfig: mergeSlot(frames, 'checkoutConfig'),
    componentConfig: mergeSlot(frames, 'componentConfig'),
    inferredConfig: mergeSlot(frames, 'inferredConfig'),
    ...(complete ? { checkoutConfigComplete: true } : {}),
  };
}
