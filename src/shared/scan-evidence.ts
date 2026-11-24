/**
Checkout configuration evidence — the only reader of a page's observed
checkout configuration (`ObservedCheckoutConfig`). Answers what the scan observed
about each checkout option and about checkout configuration as a whole, and
merges configuration across frames. Owns source precedence, the rule that
only directly captured AdyenCheckout options prove a field was not set, and
the rule that option-shaped page JSON alone does not show checkout is
configured.
*/

import { readTranslationLocale } from './adyen-endpoint.js';
import { mergeCheckoutConfigs } from './checkout-config-schema.js';
import type {
  CapturedRequest,
  CheckoutConfig,
  ObservedCheckoutConfig,
  CheckoutPage,
  InferenceSignal,
  ScanPayload,
} from './types.js';

/**
Where a Checkout configuration value was observed, in precedence order.
*/
export type ConfigSource = 'captured' | 'component' | 'inferred';

type ConfigKey = keyof CheckoutConfig;

interface ConfigObservation<K extends ConfigKey> {
  readonly value: NonNullable<CheckoutConfig[K]>;
  readonly source: ConfigSource;
  /**
  For inferred values: the partial signal the value was read from.
  */
  readonly signal?: InferenceSignal;
}

/**
Evidence for one field. `absent` means directly captured AdyenCheckout
options prove the field was not set; `unobserved` means absence cannot be
verified, with `no-config` when no checkout or component config was captured.
*/
export type CheckoutFieldEvidence<K extends ConfigKey> =
  | ({ readonly state: 'present' } & ConfigObservation<K>)
  | { readonly state: 'absent' }
  | { readonly state: 'unobserved'; readonly reason: 'no-config' | 'partial-config' };

interface ReadCheckoutFieldOptions {
  /**
  When false, values that were only inferred from requests or parsed JSON are ignored.
  */
  readonly includeInferred?: boolean;
}

/**
A frame's page extraction or the Checkout page.
*/
type ConfiguredPage = Pick<CheckoutPage, 'observedConfig'>;

interface ConfigSlot {
  readonly source: ConfigSource;
  readonly signal?: InferenceSignal;
  readonly read: (config: ObservedCheckoutConfig) => CheckoutConfig | undefined;
}

/**
Slots in precedence order: captured, component, then inferred from Adyen requests, then page JSON.
*/
const SLOTS: readonly ConfigSlot[] = [
  { source: 'captured', read: ({ captured }) => captured?.options },
  { source: 'component', read: ({ component }) => component ?? undefined },
  {
    source: 'inferred',
    signal: 'adyen-request',
    read: ({ inferred }) => inferred['adyen-request'],
  },
  { source: 'inferred', signal: 'page-json', read: ({ inferred }) => inferred['page-json'] },
];

/**
Slots that show checkout is configured; page JSON alone does not.
*/
const CONFIGURING_SLOTS = SLOTS.filter(({ signal }) => signal !== 'page-json');

function isObserved<V>(value: V | '' | undefined): value is V {
  return value !== undefined && value !== '';
}

/**
Returns every observation of a field, strongest source first.
*/
export function listCheckoutFieldObservations<K extends ConfigKey>(
  payload: ScanPayload,
  key: K
): ConfigObservation<K>[] {
  const observations: ConfigObservation<K>[] = [];
  for (const { source, signal, read } of SLOTS) {
    const value = read(payload.page.observedConfig)?.[key];
    if (!isObserved(value)) continue;
    const observed = value as NonNullable<CheckoutConfig[K]>;
    observations.push(
      signal === undefined ? { value: observed, source } : { value: observed, source, signal }
    );
  }
  return observations;
}

/**
Returns the sources that show checkout is configured: captured options,
a mounted tree, or values inferred from Adyen requests. Option-shaped page
JSON alone does not count, because any page data can carry such fields.
*/
export function checkoutConfigSources({
  observedConfig,
}: ConfiguredPage): ReadonlySet<ConfigSource> {
  return new Set(
    CONFIGURING_SLOTS.filter(({ read }) => read(observedConfig) !== undefined).map(
      ({ source }) => source
    )
  );
}

/**
Returns true when checkout or component configuration was captured, not merely inferred.
*/
export function hasCapturedCheckoutConfig({ observedConfig }: ConfiguredPage): boolean {
  return observedConfig.captured !== null || observedConfig.component !== null;
}

/**
Returns true when AdyenCheckout options were captured whole, so options missing from them are absent.
*/
export function hasCompleteCheckoutConfig({ observedConfig }: ConfiguredPage): boolean {
  return observedConfig.captured?.complete === true;
}

const INFERENCE_SIGNALS = SLOTS.flatMap(({ signal }) => signal ?? []);

/**
Merges the configuration of several frames: earlier frames win per field,
and captured options are complete when any frame captured them whole.
*/
export function mergeObservedConfigs(pages: readonly ConfiguredPage[]): ObservedCheckoutConfig {
  const configs = pages.map(({ observedConfig }) => observedConfig);
  const captures = configs.flatMap(({ captured }) => captured ?? []);
  const options = mergeCheckoutConfigs(captures.map((capture) => capture.options));
  const inferred: Partial<Record<InferenceSignal, CheckoutConfig>> = {};
  for (const signal of INFERENCE_SIGNALS) {
    const merged = mergeCheckoutConfigs(configs.flatMap((config) => config.inferred[signal] ?? []));
    if (merged !== null) inferred[signal] = merged;
  }
  return {
    captured:
      options === null ? null : { options, complete: captures.some((capture) => capture.complete) },
    component: mergeCheckoutConfigs(configs.flatMap(({ component }) => component ?? [])),
    inferred,
  };
}

/**
Reads the strongest observation of a field and whether its absence is proven.
*/
export function readCheckoutField<K extends ConfigKey>(
  payload: ScanPayload,
  key: K,
  options: ReadCheckoutFieldOptions = {}
): CheckoutFieldEvidence<K> {
  const isIncludeInferred = options.includeInferred ?? true;
  const observation = listCheckoutFieldObservations(payload, key).find(
    (candidate) => isIncludeInferred || candidate.source !== 'inferred'
  );
  if (observation !== undefined) return { state: 'present', ...observation };
  if (hasCompleteCheckoutConfig(payload.page)) return { state: 'absent' };
  return {
    state: 'unobserved',
    reason: hasCapturedCheckoutConfig(payload.page) ? 'partial-config' : 'no-config',
  };
}

/**
Infers a locale from Adyen translation requests when no stronger source shows one.
*/
export function withRequestDerivedLocale(
  page: CheckoutPage,
  requests: readonly CapturedRequest[]
): CheckoutPage {
  const { observedConfig } = page;
  const isLocaleObserved = CONFIGURING_SLOTS.some(({ read }) =>
    isObserved(read(observedConfig)?.locale)
  );
  if (isLocaleObserved) return page;

  const locale = requests
    .map((request) => readTranslationLocale(request.url))
    .find((candidate) => candidate !== null);
  if (locale === undefined) return page;
  const { inferred } = observedConfig;
  return {
    ...page,
    observedConfig: {
      ...observedConfig,
      inferred: { ...inferred, 'adyen-request': { ...inferred['adyen-request'], locale } },
    },
  };
}
