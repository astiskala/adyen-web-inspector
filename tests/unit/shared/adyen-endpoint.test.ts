import { describe, expect, it } from 'vitest';
import {
  environmentOption,
  isAdyenCheckoutResource,
  isCheckoutApiRequest,
  isSessionsRequest,
  readAdyenEndpoint,
  readEnvironmentOption,
  readTranslationLocale,
  resolveAdyenWebOrigins,
  servedRegion,
} from '../../../src/shared/adyen-endpoint';

describe('readAdyenEndpoint', () => {
  it.each([
    // [url, role, environment, namedRegion, servedRegion, environment option]
    ['https://checkoutshopper-live-us.cdn.adyen.com/x.js', 'cdn', 'live', 'US', 'US', 'live-us'],
    ['https://checkoutshopper-live.cdn.adyen.com/x.js', 'cdn', 'live', null, 'EU', 'live'],
    ['https://checkoutshopper-test.cdn.adyen.com/x.js', 'cdn', 'test', null, null, 'test'],
    [
      'https://checkoutshopper-live-in.adyen.com/v1',
      'checkoutshopper',
      'live-in',
      'IN',
      'IN',
      'live-in',
    ],
    [
      'https://checkoutshopper-live-apse.adyen.com/v1',
      'checkoutshopper',
      'live',
      'APSE',
      'APSE',
      'live-apse',
    ],
    [
      'https://checkoutanalytics-live-nea.adyen.com/v3',
      'analytics',
      'live',
      'NEA',
      'NEA',
      'live-nea',
    ],
    ['https://checkoutanalytics-test.adyen.com/v3', 'analytics', 'test', null, null, 'test'],
    ['https://checkout-test.adyen.com/v71/sessions', 'checkout-api', 'test', null, null, 'test'],
    [
      'https://checkout-live-au.adyenpayments.com/v71',
      'checkout-api',
      'live',
      'AU',
      'AU',
      'live-au',
    ],
    [
      'https://1a2b-Merchant-checkout-live.adyenpayments.com/v71',
      'checkout-api',
      'live',
      null,
      'EU',
      'live',
    ],
    [
      'https://checkout-live-in-x.adyenpayments.com/v71',
      'checkout-api',
      'live-in',
      'IN',
      'IN',
      'live-in',
    ],
    [
      'https://checkoutshopper-live-xx.adyen.com/v1',
      'checkoutshopper',
      'live',
      'unknown',
      'unknown',
      'live',
    ],
    ['https://pal-live.adyen.com/pal', 'other', 'live', null, null, 'live'],
    ['https://docs.adyen.com/', 'other', null, null, null, null],
    ['https://adyen.com/', 'other', null, null, null, null],
  ] as const)('reads %s', (url, role, environment, namedRegion, served, option) => {
    const endpoint = readAdyenEndpoint(url);

    expect(endpoint).toEqual({ role, environment, namedRegion });
    expect(endpoint === null ? undefined : servedRegion(endpoint)).toBe(served);
    expect(endpoint === null ? undefined : environmentOption(endpoint)).toBe(option);
  });

  it.each([
    'https://merchant.example/checkoutshopper-live.cdn.adyen.com.js',
    'https://adyen.com.evil.example/',
    'https://testadyen.com/',
    'not a URL',
  ])('does not read %s as an Adyen endpoint', (url) => {
    expect(readAdyenEndpoint(url)).toBeNull();
  });

  it('matches Adyen hosts case-insensitively', () => {
    expect(readAdyenEndpoint('https://CheckoutShopper-Live.ADYEN.com/x')).toMatchObject({
      role: 'checkoutshopper',
      environment: 'live',
    });
    expect(readAdyenEndpoint('https://adyenpayments.com/')).toMatchObject({ role: 'other' });
  });
});

describe('Adyen Web environment options', () => {
  it.each([
    ['test', { environment: 'test', region: null }],
    ['live', { environment: 'live', region: 'EU' }],
    [' LIVE-US ', { environment: 'live', region: 'US' }],
    ['live_au', { environment: 'live', region: 'AU' }],
    ['live-in', { environment: 'live-in', region: 'IN' }],
    ['live-xx', { environment: 'live', region: 'unknown' }],
    ['staging', null],
  ])('reads the environment option %s', (option, expected) => {
    expect(readEnvironmentOption(option)).toEqual(expected);
  });

  it('resolves the origins Adyen Web uses, falling back to live for unknown names', () => {
    expect(resolveAdyenWebOrigins('LIVE-US').api).toBe(
      'https://checkoutshopper-live-us.adyen.com/checkoutshopper/'
    );
    expect(resolveAdyenWebOrigins('test').cdn).toBe(
      'https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/'
    );
    expect(resolveAdyenWebOrigins('staging')).toEqual(resolveAdyenWebOrigins('live'));
  });
});

describe('Adyen Web paths', () => {
  it('recognises Adyen-hosted SDK resources only on Adyen hosts', () => {
    expect(
      isAdyenCheckoutResource('https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk.js')
    ).toBe(true);
    expect(
      isAdyenCheckoutResource('https://checkoutshopper-live.adyen.com/sdk/6.1.0/adyen.js')
    ).toBe(true);
    expect(isAdyenCheckoutResource('https://merchant.example/checkoutshopper/sdk.js')).toBe(false);
    expect(isAdyenCheckoutResource('https://checkoutanalytics-live.adyen.com/v3/setup')).toBe(
      false
    );
  });

  it('recognises Sessions and Checkout API paths on any host', () => {
    expect(isSessionsRequest('https://merchant.example/api/v71/sessions')).toBe(true);
    expect(isCheckoutApiRequest('https://merchant.example/api/v71/sessions')).toBe(true);
    expect(isCheckoutApiRequest('https://checkout-test.adyen.com/v71/paymentMethods')).toBe(true);
    expect(isCheckoutApiRequest('https://checkout-test.adyen.com/v71/payments/details')).toBe(true);
    expect(isCheckoutApiRequest('https://checkout-test.adyen.com/v71/payments')).toBe(false);
  });

  it('reads translation locales from translation file paths', () => {
    expect(readTranslationLocale('/checkoutshopper/sdk/6.0.0/translations/nl-NL.json')).toBe(
      'nl-NL'
    );
    expect(readTranslationLocale('/translations/.json')).toBeNull();
    expect(readTranslationLocale('/translations/nl-NL.json?v=1')).toBeNull();
  });
});
