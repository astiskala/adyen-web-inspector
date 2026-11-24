/**
Capture record — how the config interceptor accumulates what it observes in
one frame: options captured from AdyenCheckout and component calls with
their completeness, values inferred from partial signals tagged by signal,
the AdyenCheckout initialisation count, and what Adyen checkout analytics
requests reported. The page extractor reads the published record back
through `readCheckoutCapture()`.

Content scripts bundle this module inline, so it may depend only on types,
the config field schema, the Adyen endpoint reading, and checkout analytics.
*/

import { environmentOption, readAdyenEndpoint, readTranslationLocale } from './adyen-endpoint.js';
import {
  EMPTY_CHECKOUT_ANALYTICS,
  readCheckoutAnalytics,
  recordAnalyticsBody,
} from './checkout-analytics.js';
import { applyCapturedOptions, readCheckoutOptions } from './checkout-config-schema.js';
import type {
  CallbackSource,
  CapturedCheckoutOptions,
  CheckoutCapture,
  CheckoutConfig,
  InferenceSignal,
} from './types.js';

/**
The record of a frame where nothing was captured yet.
*/
export const EMPTY_CHECKOUT_CAPTURE: CheckoutCapture = {
  captured: null,
  inferred: {},
  initCount: 0,
  analytics: EMPTY_CHECKOUT_ANALYTICS,
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

/**
Records raw options passed to AdyenCheckout (`checkout`) or a component
(`component`). Options passed straight to AdyenCheckout are its whole
configuration, so options missing from them are known to be absent.
Returns the same record when the call carried no options.
*/
export function recordCheckoutOptions(
  capture: CheckoutCapture,
  raw: unknown,
  placement: CallbackSource
): CheckoutCapture {
  const fields = readCheckoutOptions(raw, placement);
  if (fields === null) return capture;
  const isComplete = placement === 'checkout';
  if (!isComplete && isEmpty(fields)) return capture;
  return {
    ...capture,
    captured: {
      options: applyCapturedOptions(capture.captured?.options ?? null, fields),
      complete: isComplete || capture.captured?.complete === true,
    },
  };
}

/**
Records values inferred from a partial signal; newer values win within the
signal. Returns the same record when there is nothing to record.
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
Records an Adyen checkout analytics request body. Returns the same record
when the body adds nothing.
*/
export function recordAnalytics(capture: CheckoutCapture, body: unknown): CheckoutCapture {
  const analytics = recordAnalyticsBody(capture.analytics, body);
  return analytics === capture.analytics ? capture : { ...capture, analytics };
}

/**
Records one AdyenCheckout initialisation.
*/
export function recordCheckoutInit(capture: CheckoutCapture): CheckoutCapture {
  return { ...capture, initCount: capture.initCount + 1 };
}

/**
Reads option values from an Adyen request URL: the environment its host
names, clientKey, locale, and countryCode parameters, and the locale of a
translation file. Returns null for URLs that are not Adyen requests.
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
  for (const parameter of URL_OPTION_PARAMS) {
    const value = parsed.searchParams.get(parameter);
    if (value !== null && value !== '') config[parameter] = value;
  }
  const translationLocale = readTranslationLocale(parsed.pathname);
  if (translationLocale !== null) config.locale = translationLocale;
  return config;
}

/**
The page extractor re-serialises the record, so a plain object is read as options as-is.
*/
function readConfig(value: unknown): CheckoutConfig | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function readCaptured(value: unknown): CapturedCheckoutOptions | null {
  if (!isPlainRecord(value)) return null;
  const options = readConfig(value['options']);
  return options === undefined ? null : { options, complete: value['complete'] === true };
}

/**
Reads a published capture record, tolerating page scripts that overwrote the global.
*/
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
    analytics: readCheckoutAnalytics(value['analytics']),
  };
}
