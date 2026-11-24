import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHECKOUT_ANALYTICS,
  mergeCheckoutAnalytics,
  readCheckoutAnalytics,
  recordAnalyticsBody,
  reportedAnalytics,
} from '../../../src/shared/checkout-analytics';

function rendered(component: string, configData: Record<string, unknown>): unknown {
  return { type: 'rendered', component, configData };
}

describe('recordAnalyticsBody', () => {
  it('keeps the SDK fields of setup and event bodies, later bodies winning per field', () => {
    const setup = recordAnalyticsBody(EMPTY_CHECKOUT_ANALYTICS, {
      flavor: 'dropin',
      version: '6.30.0',
      buildType: 'esm',
      sessionId: '',
      referrer: 'https://merchant.example',
      level: 'all',
    });
    const event = recordAnalyticsBody(setup, { version: '6.31.0', sessionId: 'S1', channel: 7 });

    expect(event.sdk).toEqual({
      flavor: 'dropin',
      version: '6.31.0',
      buildType: 'esm',
      sessionId: 'S1',
    });
  });

  it('keeps the latest rendered showPayButton per component and every component named', () => {
    const first = recordAnalyticsBody(EMPTY_CHECKOUT_ANALYTICS, {
      info: [
        rendered('paypal', { showPayButton: false, amount: '{"value":100}' }),
        rendered('scheme', { showPayButton: true, _disableClickToPay: true }),
        { type: 'sdkDownloadInitiated', component: 'clicktopay', cdnUrl: 'https://x' },
      ],
    });
    const second = recordAnalyticsBody(first, {
      info: [rendered('paypal', { showPayButton: true })],
    });

    expect(second).toEqual({
      sdk: {},
      rendered: [
        { type: 'scheme', showPayButton: true, clickToPayDisabled: true },
        { type: 'paypal', showPayButton: true },
      ],
      paymentMethods: ['paypal', 'scheme', 'clicktopay'],
    });
  });

  it('reads the payment methods Drop-in lists as available', () => {
    const analytics = recordAnalyticsBody(EMPTY_CHECKOUT_ANALYTICS, {
      info: [
        {
          type: 'paymentListDisplayed',
          component: 'dropin',
          availablePaymentMethods: [
            { paymentMethodType: 'klarna_paynow', displayMode: 'list' },
            { paymentMethodType: 3 },
            'paypal',
          ],
        },
      ],
    });

    expect(analytics.paymentMethods).toEqual(['dropin', 'klarna_paynow']);
  });

  it('ignores stored payment methods, rendered events without showPayButton, and malformed events', () => {
    const analytics = recordAnalyticsBody(EMPTY_CHECKOUT_ANALYTICS, {
      info: [
        {
          ...(rendered('scheme', { showPayButton: false }) as object),
          isStoredPaymentMethod: true,
        },
        rendered('ideal', {}),
        { type: 'rendered', component: 'giftcard' },
        { type: 'rendered', component: '', configData: { showPayButton: false } },
        null,
      ],
    });

    expect(analytics).toEqual({
      sdk: {},
      rendered: [],
      paymentMethods: ['scheme', 'ideal', 'giftcard'],
    });
  });

  it('returns the same record for bodies that add nothing', () => {
    const analytics = recordAnalyticsBody(EMPTY_CHECKOUT_ANALYTICS, { flavor: 'dropin' });

    expect(recordAnalyticsBody(analytics, { flavor: 'dropin', info: [null] })).toBe(analytics);
    expect(recordAnalyticsBody(analytics, 'text')).toBe(analytics);
    expect(recordAnalyticsBody(analytics, ['flavor'])).toBe(analytics);
  });
});

describe('reportedAnalytics', () => {
  it('returns analytics that report anything, and undefined otherwise', () => {
    const sdkOnly = { ...EMPTY_CHECKOUT_ANALYTICS, sdk: { flavor: 'dropin' } };
    const eventsOnly = { ...EMPTY_CHECKOUT_ANALYTICS, paymentMethods: ['paypal'] };
    const renderedOnly = {
      ...EMPTY_CHECKOUT_ANALYTICS,
      rendered: [{ type: 'paypal', showPayButton: true }],
    };

    expect(reportedAnalytics(EMPTY_CHECKOUT_ANALYTICS)).toBeUndefined();
    expect(reportedAnalytics(sdkOnly)).toBe(sdkOnly);
    expect(reportedAnalytics(eventsOnly)).toBe(eventsOnly);
    expect(reportedAnalytics(renderedOnly)).toBe(renderedOnly);
  });
});

describe('mergeCheckoutAnalytics', () => {
  it('returns undefined when no frame reported analytics', () => {
    expect(mergeCheckoutAnalytics([undefined, undefined])).toBeUndefined();
  });
});

describe('readCheckoutAnalytics', () => {
  it('keeps only well-formed SDK fields and event entries', () => {
    expect(
      readCheckoutAnalytics({
        sdk: { flavor: 'dropin', version: 6, referrer: 'https://x' },
        rendered: [
          { type: 'scheme', showPayButton: true, clickToPayDisabled: true },
          { type: 'paypal', showPayButton: 'no' },
          { type: 7, showPayButton: false },
          null,
        ],
        paymentMethods: ['scheme', 4],
      })
    ).toEqual({
      sdk: { flavor: 'dropin' },
      rendered: [{ type: 'scheme', showPayButton: true, clickToPayDisabled: true }],
      paymentMethods: ['scheme'],
    });
  });

  it('reads anything a page script left behind as empty analytics', () => {
    expect(readCheckoutAnalytics(undefined)).toBe(EMPTY_CHECKOUT_ANALYTICS);
    expect(readCheckoutAnalytics({ sdk: 'x', rendered: 'x', paymentMethods: {} })).toEqual(
      EMPTY_CHECKOUT_ANALYTICS
    );
  });
});
