import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHECKOUT_CAPTURE,
  readCheckoutCapture,
  readRequestInference,
  recordAnalyticsEvents,
  recordCheckoutInit,
  recordCheckoutOptions,
  recordInference,
} from '../../../src/shared/checkout-capture';

const BASE = 'https://merchant.example/checkout';

describe('recordCheckoutOptions', () => {
  it('records AdyenCheckout options as a complete capture', () => {
    const capture = recordCheckoutOptions(
      EMPTY_CHECKOUT_CAPTURE,
      { clientKey: 'test_K', onSubmit: () => {} },
      'checkout'
    );

    expect(capture.captured).toEqual({
      options: { clientKey: 'test_K', onSubmit: 'checkout', onSubmitSources: ['() => {}'] },
      complete: true,
    });
  });

  it('records empty AdyenCheckout options, because they still prove absence', () => {
    expect(recordCheckoutOptions(EMPTY_CHECKOUT_CAPTURE, {}, 'checkout').captured).toEqual({
      options: {},
      complete: true,
    });
  });

  it('keeps component options partial and lets them fill in, without moving checkout callbacks', () => {
    const checkout = recordCheckoutOptions(
      EMPTY_CHECKOUT_CAPTURE,
      { onSubmit: () => {} },
      'checkout'
    );
    const withCard = recordCheckoutOptions(
      checkout,
      { locale: 'nl-NL', onSubmit: (state: unknown) => state },
      'component'
    );
    const componentOnly = recordCheckoutOptions(
      EMPTY_CHECKOUT_CAPTURE,
      { locale: 'nl-NL' },
      'component'
    );

    expect(withCard.captured).toEqual({
      options: {
        locale: 'nl-NL',
        onSubmit: 'checkout',
        onSubmitSources: ['() => {}', '(state) => state'],
      },
      complete: true,
    });
    expect(componentOnly.captured).toEqual({ options: { locale: 'nl-NL' }, complete: false });
  });

  it('returns the same record for calls without options', () => {
    expect(recordCheckoutOptions(EMPTY_CHECKOUT_CAPTURE, 'card', 'checkout')).toBe(
      EMPTY_CHECKOUT_CAPTURE
    );
    expect(recordCheckoutOptions(EMPTY_CHECKOUT_CAPTURE, {}, 'component')).toBe(
      EMPTY_CHECKOUT_CAPTURE
    );
    expect(recordCheckoutOptions(EMPTY_CHECKOUT_CAPTURE, [], 'checkout')).toBe(
      EMPTY_CHECKOUT_CAPTURE
    );
  });
});

describe('recordInference and recordCheckoutInit', () => {
  it('keeps each signal apart, newer values winning within a signal', () => {
    const first = recordInference(EMPTY_CHECKOUT_CAPTURE, 'adyen-request', {
      environment: 'test',
      locale: 'en-US',
    });
    const second = recordInference(first, 'adyen-request', { locale: 'nl-NL' });
    const withJson = recordInference(second, 'page-json', { countryCode: 'NL' });

    expect(withJson.inferred).toEqual({
      'adyen-request': { environment: 'test', locale: 'nl-NL' },
      'page-json': { countryCode: 'NL' },
    });
    expect(recordInference(withJson, 'page-json', {})).toBe(withJson);
    expect(recordInference(withJson, 'page-json', null)).toBe(withJson);
  });

  it('counts AdyenCheckout initialisations', () => {
    expect(recordCheckoutInit(recordCheckoutInit(EMPTY_CHECKOUT_CAPTURE)).initCount).toBe(2);
  });
});

function rendered(component: string, configData: Record<string, unknown>): unknown {
  return { type: 'rendered', component, configData };
}

describe('recordAnalyticsEvents', () => {
  it('keeps the latest rendered showPayButton per component and every component named', () => {
    const first = recordAnalyticsEvents(EMPTY_CHECKOUT_CAPTURE, {
      channel: 'Web',
      info: [
        rendered('paypal', { showPayButton: false, amount: '{"value":100}' }),
        rendered('scheme', { showPayButton: true, _disableClickToPay: true }),
        { type: 'sdkDownloadInitiated', component: 'clicktopay', cdnUrl: 'https://x' },
      ],
    });
    const second = recordAnalyticsEvents(first, {
      info: [rendered('paypal', { showPayButton: true })],
    });

    expect(second.events).toEqual({
      rendered: [
        { type: 'scheme', showPayButton: true, clickToPayDisabled: true },
        { type: 'paypal', showPayButton: true },
      ],
      paymentMethods: ['paypal', 'scheme', 'clicktopay'],
    });
  });

  it('reads the payment methods Drop-in lists as available', () => {
    const capture = recordAnalyticsEvents(EMPTY_CHECKOUT_CAPTURE, {
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

    expect(capture.events).toEqual({ rendered: [], paymentMethods: ['dropin', 'klarna_paynow'] });
  });

  it('ignores stored payment methods, rendered events without showPayButton, and malformed events', () => {
    const capture = recordAnalyticsEvents(EMPTY_CHECKOUT_CAPTURE, {
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

    expect(capture.events).toEqual({
      rendered: [],
      paymentMethods: ['scheme', 'ideal', 'giftcard'],
    });
  });

  it('returns the same record for bodies without info events', () => {
    expect(recordAnalyticsEvents(EMPTY_CHECKOUT_CAPTURE, { version: '6.0.0' })).toBe(
      EMPTY_CHECKOUT_CAPTURE
    );
    expect(recordAnalyticsEvents(EMPTY_CHECKOUT_CAPTURE, 'text')).toBe(EMPTY_CHECKOUT_CAPTURE);
    expect(recordAnalyticsEvents(EMPTY_CHECKOUT_CAPTURE, { info: [null] })).toBe(
      EMPTY_CHECKOUT_CAPTURE
    );
  });
});

describe('readRequestInference', () => {
  it('reads the environment, option parameters, and translation locale of an Adyen request', () => {
    expect(
      readRequestInference(
        'https://checkoutshopper-live-us.cdn.adyen.com/checkoutshopper/sdk/6.30.0/translations/fr-FR.json?clientKey=live_K&countryCode=FR',
        BASE
      )
    ).toEqual({ environment: 'live-us', clientKey: 'live_K', countryCode: 'FR', locale: 'fr-FR' });
    expect(
      readRequestInference('https://checkoutshopper-test.adyen.com/v1/setup?locale=nl-NL', BASE)
    ).toEqual({ environment: 'test', locale: 'nl-NL' });
  });

  it('ignores requests to other hosts and unparsable URLs', () => {
    expect(readRequestInference('/api/config?clientKey=test_K', BASE)).toBeNull();
    expect(readRequestInference('https://[bad', BASE)).toBeNull();
  });
});

describe('readCheckoutCapture', () => {
  it('reads a well-formed record', () => {
    const record = {
      captured: { options: { clientKey: 'test_K' }, complete: true },
      inferred: { 'adyen-request': { locale: 'nl-NL' } },
      initCount: 3,
      events: {
        rendered: [{ type: 'paypal', showPayButton: false }],
        paymentMethods: ['paypal'],
      },
    };
    expect(readCheckoutCapture(record)).toEqual(record);
  });

  it('keeps only well-formed analytics event entries', () => {
    expect(
      readCheckoutCapture({
        events: {
          rendered: [
            { type: 'scheme', showPayButton: true, clickToPayDisabled: true },
            { type: 'paypal', showPayButton: 'no' },
            { type: 7, showPayButton: false },
            null,
          ],
          paymentMethods: ['scheme', 4],
        },
      }).events
    ).toEqual({
      rendered: [{ type: 'scheme', showPayButton: true, clickToPayDisabled: true }],
      paymentMethods: ['scheme'],
    });
    expect(readCheckoutCapture({ events: { rendered: 'x' } }).events).toEqual(
      EMPTY_CHECKOUT_CAPTURE.events
    );
  });

  it('reads anything a page script left behind as an empty or partial record', () => {
    expect(readCheckoutCapture(undefined)).toEqual(EMPTY_CHECKOUT_CAPTURE);
    expect(readCheckoutCapture({ captured: 'x', inferred: [], initCount: -1 })).toEqual(
      EMPTY_CHECKOUT_CAPTURE
    );
    expect(readCheckoutCapture({ captured: { options: {} } })).toEqual({
      ...EMPTY_CHECKOUT_CAPTURE,
      captured: { options: {}, complete: false },
    });
  });
});

describe('readRequestInference without an environment', () => {
  it('reads option parameters from Adyen hosts that name no environment', () => {
    expect(readRequestInference('https://docs.adyen.com/x?clientKey=test_K', BASE)).toEqual({
      clientKey: 'test_K',
    });
  });
});
