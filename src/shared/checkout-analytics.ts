/**
Checkout analytics — what Adyen Web's own checkout analytics request bodies
report: the SDK fields of setup and event bodies, each component's latest
rendered pay button, and the payment methods the events name. The config
interceptor folds the bodies the page sends, and the Scan folds the bodies
it observes on the network, through `recordAnalyticsBody()`, so a body means
the same thing whichever source saw it.

Content scripts bundle this module inline, so it may depend on types only.
*/

import type { AnalyticsData, CheckoutAnalytics, RenderedComponent } from './types.js';

type PlainRecord = Record<string, unknown>;

/**
SDK fields kept from analytics bodies; the rest of each body is discarded.
*/
const SDK_KEYS = [
  'flavor',
  'version',
  'buildType',
  'channel',
  'platform',
  'locale',
  'sessionId',
] as const satisfies readonly (keyof AnalyticsData)[];

/**
The analytics of a page where no body reported anything yet.
*/
export const EMPTY_CHECKOUT_ANALYTICS: CheckoutAnalytics = {
  sdk: {},
  rendered: [],
  paymentMethods: [],
};

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function readSdkFields(record: PlainRecord): [keyof AnalyticsData, string][] {
  return SDK_KEYS.flatMap((key) => {
    const value = record[key];
    return isNonEmptyString(value) ? [[key, value] as [keyof AnalyticsData, string]] : [];
  });
}

function renderedComponent(
  type: string,
  isPayButtonShown: boolean,
  clickToPayDisabled: unknown
): RenderedComponent {
  return {
    type,
    showPayButton: isPayButtonShown,
    ...(clickToPayDisabled === true && { clickToPayDisabled }),
  };
}

/**
Reads a `rendered` event that reported showPayButton; stored payment methods are left out.
*/
function readRenderedEvent(event: PlainRecord): RenderedComponent | null {
  const { component, configData } = event;
  if (
    event['type'] !== 'rendered' ||
    event['isStoredPaymentMethod'] === true ||
    !isNonEmptyString(component) ||
    !isPlainRecord(configData)
  ) {
    return null;
  }
  const showPayButton = configData['showPayButton'];
  return typeof showPayButton === 'boolean'
    ? renderedComponent(component, showPayButton, configData['_disableClickToPay'])
    : null;
}

/**
Payment method types an info event names: its component and the methods Drop-in listed.
*/
function namedPaymentMethods(event: PlainRecord): string[] {
  const listed: unknown[] = Array.isArray(event['availablePaymentMethods'])
    ? event['availablePaymentMethods']
    : [];
  const listedTypes = listed.map((method) =>
    isPlainRecord(method) ? method['paymentMethodType'] : undefined
  );
  return [event['component'], ...listedTypes].filter(isNonEmptyString);
}

function applyInfoEvent(analytics: CheckoutAnalytics, event: unknown): CheckoutAnalytics {
  if (!isPlainRecord(event)) return analytics;
  const rendered = readRenderedEvent(event);
  const named = namedPaymentMethods(event).filter(
    (type) => !analytics.paymentMethods.includes(type)
  );
  if (rendered === null && named.length === 0) return analytics;
  return {
    ...analytics,
    rendered:
      rendered === null
        ? analytics.rendered
        : [...analytics.rendered.filter(({ type }) => type !== rendered.type), rendered],
    paymentMethods: [...analytics.paymentMethods, ...new Set(named)],
  };
}

function applySdkFields(analytics: CheckoutAnalytics, body: PlainRecord): CheckoutAnalytics {
  const changed = readSdkFields(body).filter(([key, value]) => analytics.sdk[key] !== value);
  return changed.length === 0
    ? analytics
    : { ...analytics, sdk: { ...analytics.sdk, ...Object.fromEntries(changed) } };
}

/**
Records one analytics request body: its SDK fields, where later bodies win
per field, and its info events. Returns the same record when the body adds
nothing.
*/
export function recordAnalyticsBody(
  analytics: CheckoutAnalytics,
  body: unknown
): CheckoutAnalytics {
  if (!isPlainRecord(body)) return analytics;
  const info: unknown[] = Array.isArray(body['info']) ? body['info'] : [];
  let recorded = applySdkFields(analytics, body);
  for (const event of info) recorded = applyInfoEvent(recorded, event);
  return recorded;
}

/**
Returns the analytics, or undefined when no body reported anything.
*/
export function reportedAnalytics(analytics: CheckoutAnalytics): CheckoutAnalytics | undefined {
  const { sdk, rendered, paymentMethods } = analytics;
  return Object.keys(sdk).length === 0 && rendered.length === 0 && paymentMethods.length === 0
    ? undefined
    : analytics;
}

/**
Merges the analytics of several frames: earlier frames win per SDK field
and rendered component type, and payment methods are combined. Returns
undefined when no frame reported anything.
*/
export function mergeCheckoutAnalytics(
  frames: readonly (CheckoutAnalytics | undefined)[]
): CheckoutAnalytics | undefined {
  const reported = frames.filter((analytics) => analytics !== undefined);
  if (reported.length === 0) return undefined;
  const rendered = reported.flatMap((analytics) => analytics.rendered);
  return {
    sdk: Object.fromEntries(reported.toReversed().flatMap(({ sdk }) => Object.entries(sdk))),
    rendered: rendered.filter(
      (component, index) => rendered.findIndex(({ type }) => type === component.type) === index
    ),
    paymentMethods: [...new Set(reported.flatMap((analytics) => analytics.paymentMethods))],
  };
}

function readRendered(value: unknown): RenderedComponent[] {
  if (!isPlainRecord(value)) return [];
  const { type, showPayButton } = value;
  return typeof showPayButton === 'boolean' && isNonEmptyString(type)
    ? [renderedComponent(type, showPayButton, value['clickToPayDisabled'])]
    : [];
}

/**
Reads published analytics back, tolerating page scripts that overwrote them.
*/
export function readCheckoutAnalytics(value: unknown): CheckoutAnalytics {
  if (!isPlainRecord(value)) return EMPTY_CHECKOUT_ANALYTICS;
  const { sdk, rendered, paymentMethods } = value;
  return {
    sdk: isPlainRecord(sdk) ? Object.fromEntries(readSdkFields(sdk)) : {},
    rendered: Array.isArray(rendered) ? rendered.flatMap(readRendered) : [],
    paymentMethods: Array.isArray(paymentMethods) ? paymentMethods.filter(isNonEmptyString) : [],
  };
}
