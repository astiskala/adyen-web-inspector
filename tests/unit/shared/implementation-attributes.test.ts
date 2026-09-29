import { describe, expect, it } from 'vitest';
import { readImplementationAttributes } from '../../../src/shared/implementation-attributes';
import {
  makeAdyenPayload,
  makeAnalyticsData,
  makeCheckoutPage,
  makeRequest,
  makeScanPayload,
} from '../../fixtures/makeScanPayload';

describe('readImplementationAttributes', () => {
  it('derives the record once per scan payload', () => {
    const payload = makeAdyenPayload();

    expect(readImplementationAttributes(payload)).toBe(readImplementationAttributes(payload));
    expect(readImplementationAttributes(makeAdyenPayload())).not.toBe(
      readImplementationAttributes(payload)
    );
  });
});

describe('environment and region', () => {
  it.each([
    ['test', { value: 'test', source: 'config' }, { value: 'unknown', source: 'unknown' }],
    ['live-us', { value: 'live', source: 'config' }, { value: 'US', source: 'config' }],
    ['live', { value: 'live', source: 'config' }, { value: 'EU', source: 'config' }],
    ['live-in', { value: 'live-in', source: 'config' }, { value: 'IN', source: 'config' }],
    ['staging', { value: null, source: 'unknown' }, { value: 'unknown', source: 'unknown' }],
  ])('reads the configured environment %s', (environment, expectedEnv, expectedRegion) => {
    const { environment: env, region } = readImplementationAttributes(
      makeAdyenPayload({}, { environment, clientKey: 'pub.v2.ORIGIN' })
    );

    expect(env).toMatchObject(expectedEnv);
    expect(region).toMatchObject(expectedRegion);
  });

  it('falls back to the client key prefix when environment config is missing', () => {
    const { environment } = readImplementationAttributes(
      makeAdyenPayload({}, { environment: undefined, clientKey: 'live_XXXX' })
    );

    expect(environment).toMatchObject({ value: 'live', source: 'client-key', clientKey: 'live' });
  });

  it('reads the strongest client key prefix separately from the resolved environment', () => {
    const { environment } = readImplementationAttributes(
      makeScanPayload({
        page: makeCheckoutPage({
          checkoutConfig: { clientKey: 'pub.v2.ORIGIN' },
          inferredConfig: { clientKey: 'test_INFERRED' },
        }),
      })
    );

    expect(environment).toMatchObject({ value: 'test', source: 'client-key', clientKey: null });
  });

  it('does not infer the environment from CDN-only traffic', () => {
    const { environment, region } = readImplementationAttributes(
      makeScanPayload({
        capturedRequests: [
          makeRequest('https://checkoutshopper-live-us.cdn.adyen.com/checkoutshopper/sdk.js'),
        ],
      })
    );

    expect(environment).toEqual({
      value: null,
      source: 'unknown',
      cdn: 'live',
      clientKey: null,
      network: null,
    });
    expect(region).toEqual({ value: 'unknown', source: 'unknown', cdn: 'US' });
  });

  it.each([
    ['https://checkoutanalytics-live.adyen.com/checkoutanalytics/v3/setup', 'live', 'unknown'],
    ['https://checkoutanalytics-test.adyen.com/checkoutanalytics/v3/setup', 'test', 'unknown'],
    ['https://checkout-live.adyenpayments.com/v71/sessions', 'live', 'EU'],
    ['https://checkout-live-nea.adyenpayments.com/v71/sessions', 'live', 'NEA'],
    ['https://checkout-live-in-x.adyenpayments.com/v71/paymentMethods', 'live-in', 'unknown'],
    ['https://pal-live.adyen.com/v71/payments/details', 'live', 'unknown'],
  ])('reads the network environment from %s', (url, env, region) => {
    const attributes = readImplementationAttributes(
      makeScanPayload({ capturedRequests: [makeRequest(url)] })
    );

    expect(attributes.environment).toMatchObject({ value: env, source: 'network', network: env });
    expect(attributes.region.value).toBe(region);
  });

  it('reports an unknown environment without any signal', () => {
    const { environment } = readImplementationAttributes(makeScanPayload());

    expect(environment).toMatchObject({ value: null, source: 'unknown' });
  });
});

describe('integration flow', () => {
  it('does not infer advanced flow from a /payments request or analytics alone', () => {
    const fromPayments = makeScanPayload({
      capturedRequests: [makeRequest('https://checkout-test.adyen.com/v71/payments')],
    });
    const fromAnalytics = makeScanPayload({ analyticsData: makeAnalyticsData() });

    expect(readImplementationAttributes(fromPayments).flow.value).toBe('unknown');
    expect(readImplementationAttributes(fromAnalytics).flow).toMatchObject({
      value: 'unknown',
      signals: { hasAnalyticsData: true, hasCheckoutConfig: false },
    });
  });

  it('derives Sessions flow from a Sessions request and records the signal', () => {
    const { flow } = readImplementationAttributes(
      makeScanPayload({
        capturedRequests: [makeRequest('https://checkout-test.adyen.com/v71/sessions')],
      })
    );

    expect(flow).toMatchObject({ value: 'sessions', signals: { hasSessionsRequest: true } });
  });

  it('derives Advanced flow from checkout configuration', () => {
    expect(readImplementationAttributes(makeAdyenPayload()).flow.value).toBe('advanced');
  });
});

describe('integration flavor, import method, and checkout activity', () => {
  it('uses analytics as the primary flavor signal, over the Drop-in DOM', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({ checkoutConfig: { clientKey: 'test_ABC' }, hasDropinDOM: true }),
      analyticsData: makeAnalyticsData({ flavor: 'components' }),
    });

    expect(readImplementationAttributes(payload).flavor).toEqual({
      value: 'Components',
      source: 'analytics',
    });
  });

  it.each([
    [
      'analytics custom flavor',
      makeScanPayload({ analyticsData: makeAnalyticsData({ flavor: 'custom' }) }),
      { value: 'Custom', source: 'analytics' },
    ],
    [
      'a Drop-in resource URL',
      makeScanPayload({
        analyticsData: makeAnalyticsData({ flavor: 'unexpected' }),
        capturedRequests: [makeRequest('https://checkoutshopper-test.adyen.com/dropin.js')],
      }),
      { value: 'Drop-in', source: 'dropin-pattern' },
    ],
    [
      'the Drop-in DOM',
      makeScanPayload({ page: makeCheckoutPage({ hasDropinDOM: true }) }),
      { value: 'Drop-in', source: 'dropin-dom' },
    ],
    [
      'inferred configuration',
      makeScanPayload({ page: makeCheckoutPage({ inferredConfig: { locale: 'nl-NL' } }) }),
      { value: 'Components', source: 'checkout-config' },
    ],
    ['no signal', makeScanPayload(), { value: 'Unknown', source: 'unknown' }],
  ])('derives flavor from %s', (_label, payload, expected) => {
    expect(readImplementationAttributes(payload).flavor).toEqual(expected);
  });

  it('marks SDK-loaded pages with no checkout activity as unknown flavor', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        scripts: [
          { src: 'https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/6.0.0/adyen.js' },
        ],
      }),
    });

    expect(readImplementationAttributes(payload)).toMatchObject({
      checkoutActivity: false,
      flavor: { value: 'Unknown', source: 'sdk-loaded-no-checkout' },
      importMethod: 'Adyen',
    });
  });

  it.each([
    [
      'an Adyen iframe',
      makeScanPayload({ page: makeCheckoutPage({ iframes: [{ name: 'adyen-card' }] }) }),
    ],
    [
      'an Adyen API request',
      makeScanPayload({
        capturedRequests: [makeRequest('https://checkout-test.adyen.com/v71/paymentMethods')],
      }),
    ],
    ['analytics', makeScanPayload({ analyticsData: makeAnalyticsData() })],
  ])('detects checkout activity from %s', (_label, payload) => {
    expect(readImplementationAttributes(payload).checkoutActivity).toBe(true);
  });

  it('classifies the import method from visible script hosts', () => {
    const cdn = makeScanPayload({
      page: makeCheckoutPage({
        scripts: [
          { src: 'not a URL' },
          { src: 'https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk/6.0.0/adyen.js' },
        ],
      }),
    });
    const npm = makeScanPayload({
      page: makeCheckoutPage({ scripts: [{ src: 'https://merchant.example/main.js' }] }),
    });

    expect(readImplementationAttributes(cdn).importMethod).toBe('CDN');
    expect(readImplementationAttributes(npm).importMethod).toBe('Unknown');
  });
});
