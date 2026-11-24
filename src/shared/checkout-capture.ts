/**
 * Capture record — how the config interceptor accumulates what it observes in
 * one frame: options captured from AdyenCheckout and component calls with
 * their completeness, values inferred from partial signals tagged by signal,
 * the AdyenCheckout initialisation count, and the component events of Adyen
 * checkout analytics requests. The page extractor reads the published record
 * back through `readCheckoutCapture()`.
 *
 * Content scripts bundle this module inline, so it may depend only on types,
 * the config field schema, and the Adyen endpoint reading.
 */

import { environmentOption, readAdyenEndpoint, readTranslationLocale } from './adyen-endpoint.js';
import { applyCapturedOptions, readCheckoutOptions } from './checkout-config-schema.js';
import type {
  AnalyticsComponentEvents,
  CallbackSource,
  CapturedCheckoutOptions,
  CheckoutCapture,
  CheckoutConfig,
  InferenceSignal,
  RenderedComponent,
} from './types.js';

const EMPTY_EVENTS: AnalyticsComponentEvents = { rendered: [], paymentMethods: [] };

/** The record of a frame where nothing was captured yet. */
export const EMPTY_CHECKOUT_CAPTURE: CheckoutCapture = {
  captured: null,
  inferred: {},
  initCount: 0,
  events: EMPTY_EVENTS,
};

const INFERENCE_SIGNALS = [
  'adyen-request',
  'page-json',
] as const satisfies readonly InferenceSignal[];
const URL_OPTION_PARAMS = ['clientKey', 'locale', 'countryCode'] as const;

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmpty(config: CheckoutConfig): boolean {
  return Object.keys(config).length === 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function renderedComponent(
  type: string,
  showPayButton: boolean,
  clickToPayDisabled: unknown
): RenderedComponent {
  return { type, showPayButton, ...(clickToPayDisabled === true ? { clickToPayDisabled } : {}) };
}

/** Reads a `rendered` event that reported showPayButton; stored payment methods are left out. */
function readRenderedEvent(event: PlainRecord): RenderedComponent | null {
  const { component, configData } = event;
  if (event['type'] !== 'rendered' || event['isStoredPaymentMethod'] === true) return null;
  if (!isNonEmptyString(component) || !isPlainRecord(configData)) return null;
  const showPayButton = configData['showPayButton'];
  return typeof showPayButton === 'boolean'
    ? renderedComponent(component, showPayButton, configData['_disableClickToPay'])
    : null;
}

/** Payment method types an info event names: its component and the methods Drop-in listed. */
function namedPaymentMethods(event: PlainRecord): string[] {
  const listed: unknown[] = Array.isArray(event['availablePaymentMethods'])
    ? event['availablePaymentMethods']
    : [];
  const listedTypes = listed.map((method) =>
    isPlainRecord(method) ? method['paymentMethodType'] : undefined
  );
  return [event['component'], ...listedTypes].filter(isNonEmptyString);
}

function applyInfoEvent(
  events: AnalyticsComponentEvents,
  event: unknown
): AnalyticsComponentEvents {
  if (!isPlainRecord(event)) return events;
  const rendered = readRenderedEvent(event);
  const named = namedPaymentMethods(event).filter((type) => !events.paymentMethods.includes(type));
  if (rendered === null && named.length === 0) return events;
  return {
    rendered:
      rendered === null
        ? events.rendered
        : [...events.rendered.filter(({ type }) => type !== rendered.type), rendered],
    paymentMethods: [...events.paymentMethods, ...new Set(named)],
  };
}

/**
 * Records raw options passed to AdyenCheckout (`checkout`) or a component
 * (`component`). Options passed straight to AdyenCheckout are its whole
 * configuration, so options missing from them are known to be absent.
 * Returns the same record when the call carried no options.
 */
export function recordCheckoutOptions(
  capture: CheckoutCapture,
  raw: unknown,
  placement: CallbackSource
): CheckoutCapture {
  const fields = readCheckoutOptions(raw, placement);
  if (fields === null) return capture;
  const complete = placement === 'checkout' && !Array.isArray(raw);
  if (isEmpty(fields) && !complete) return capture;
  return {
    ...capture,
    captured: {
      options: applyCapturedOptions(capture.captured?.options ?? null, fields),
      complete: complete || capture.captured?.complete === true,
    },
  };
}

/**
 * Records values inferred from a partial signal; newer values win within the
 * signal. Returns the same record when there is nothing to record.
 */
export function recordInference(
  capture: CheckoutCapture,
  signal: InferenceSignal,
  config: CheckoutConfig | null
): CheckoutCapture {
  if (config === null || isEmpty(config)) return capture;
  return {
    ...capture,
    inferred: { ...capture.inferred, [signal]: { ...capture.inferred[signal], ...config } },
  };
}

/**
 * Records the info events of an Adyen checkout analytics request body: each
 * component's latest rendered showPayButton and the payment methods the events
 * name. Nothing else in the body is kept. Returns the same record when the
 * body adds nothing.
 */
export function recordAnalyticsEvents(capture: CheckoutCapture, body: unknown): CheckoutCapture {
  const info: unknown[] = isPlainRecord(body) && Array.isArray(body['info']) ? body['info'] : [];
  let events = capture.events;
  for (const event of info) events = applyInfoEvent(events, event);
  return events === capture.events ? capture : { ...capture, events };
}

/** Records one AdyenCheckout initialisation. */
export function recordCheckoutInit(capture: CheckoutCapture): CheckoutCapture {
  return { ...capture, initCount: capture.initCount + 1 };
}

/**
 * Reads option values from an Adyen request URL: the environment its host
 * names, clientKey, locale, and countryCode parameters, and the locale of a
 * translation file. Returns null for URLs that are not Adyen requests.
 */
export function readRequestInference(url: string, base: string): CheckoutConfig | null {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return null;
  }
  const endpoint = readAdyenEndpoint(parsed.href);
  if (endpoint === null) return null;

  const config: { -readonly [K in keyof CheckoutConfig]: CheckoutConfig[K] } = {};
  const environment = environmentOption(endpoint);
  if (environment !== null) config.environment = environment;
  for (const param of URL_OPTION_PARAMS) {
    const value = parsed.searchParams.get(param);
    if (value !== null && value !== '') config[param] = value;
  }
  const translationLocale = readTranslationLocale(parsed.pathname);
  if (translationLocale !== null) config.locale = translationLocale;
  return config;
}

/** The page extractor re-serialises the record, so a plain object is read as options as-is. */
function readConfig(value: unknown): CheckoutConfig | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function readCaptured(value: unknown): CapturedCheckoutOptions | null {
  if (!isPlainRecord(value)) return null;
  const options = readConfig(value['options']);
  return options === undefined ? null : { options, complete: value['complete'] === true };
}

function readRendered(value: unknown): RenderedComponent[] {
  if (!isPlainRecord(value)) return [];
  const { type, showPayButton } = value;
  return isNonEmptyString(type) && typeof showPayButton === 'boolean'
    ? [renderedComponent(type, showPayButton, value['clickToPayDisabled'])]
    : [];
}

function readEvents(value: unknown): AnalyticsComponentEvents {
  if (!isPlainRecord(value)) return EMPTY_EVENTS;
  const { rendered, paymentMethods } = value;
  if (!Array.isArray(rendered) || !Array.isArray(paymentMethods)) return EMPTY_EVENTS;
  return {
    rendered: rendered.flatMap(readRendered),
    paymentMethods: paymentMethods.filter(isNonEmptyString),
  };
}

/** Reads a published capture record, tolerating page scripts that overwrote the global. */
export function readCheckoutCapture(value: unknown): CheckoutCapture {
  if (!isPlainRecord(value)) return EMPTY_CHECKOUT_CAPTURE;
  const inferredValue = value['inferred'];
  const inferred: Partial<Record<InferenceSignal, CheckoutConfig>> = {};
  for (const signal of INFERENCE_SIGNALS) {
    const config = isPlainRecord(inferredValue) ? readConfig(inferredValue[signal]) : undefined;
    if (config !== undefined && !isEmpty(config)) inferred[signal] = config;
  }
  const initCount = value['initCount'];
  return {
    captured: readCaptured(value['captured']),
    inferred,
    initCount: typeof initCount === 'number' && initCount > 0 ? initCount : 0,
    events: readEvents(value['events']),
  };
}
