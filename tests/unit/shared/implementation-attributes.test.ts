import { describe, expect, it } from 'vitest';
import {
  buildImplementationAttributes,
  detectEnvironmentFromRequests,
  hasCheckoutActivity,
  resolveIntegrationFlavor,
  resolveEnvironment,
} from '../../../src/shared/implementation-attributes';
import {
  makeAdyenPayload,
  makeAnalyticsData,
  makePageExtract,
  makeRequest,
  makeScanPayload,
} from '../../fixtures/makeScanPayload';

describe('buildImplementationAttributes', () => {
  it('omits region for test environment', () => {
    const payload = makeAdyenPayload({}, { environment: 'test' });

    const attrs = buildImplementationAttributes(payload);

    expect(attrs.environment).toBe('test');
    expect(attrs.region).toBeNull();
  });

  it('uses config environment and region when available', () => {
    const payload = makeAdyenPayload({}, { environment: 'live-us' });

    const attrs = buildImplementationAttributes(payload);

    expect(attrs.environment).toBe('live');
    expect(attrs.region).toBe('US');
  });

  it('uses live-in environment for India live', () => {
    const payload = makeAdyenPayload({}, { environment: 'live-in' });

    const attrs = buildImplementationAttributes(payload);

    expect(attrs.environment).toBe('live-in');
    expect(attrs.region).toBe('IN');
  });

  it('falls back to client key when environment config is missing', () => {
    const payload = makeAdyenPayload({}, { environment: undefined, clientKey: 'live_XXXX' });

    const attrs = buildImplementationAttributes(payload);

    expect(attrs.environment).toBe('live');
  });

  it('does not infer advanced flow from a /payments request alone', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
      analyticsData: null,
      capturedRequests: [makeRequest('https://checkout-test.adyen.com/v71/payments')],
    });

    expect(buildImplementationAttributes(payload).flow).toBe('unknown');
  });

  it('derives flow from sessions request signals', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
      analyticsData: null,
      capturedRequests: [makeRequest('https://checkout-test.adyen.com/v71/sessions')],
    });

    const attrs = buildImplementationAttributes(payload);

    expect(attrs.flow).toBe('sessions');
  });

  it('does not infer advanced flow from analytics alone', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
      analyticsData: makeAnalyticsData(),
      capturedRequests: [],
    });

    const attrs = buildImplementationAttributes(payload);

    expect(attrs.flow).toBe('unknown');
  });

  it('derives flavor from analytics payload', () => {
    const payload = makeScanPayload({
      analyticsData: makeAnalyticsData({ flavor: 'custom' }),
    });

    const attrs = buildImplementationAttributes(payload);

    expect(attrs.flavor).toBe('Custom');
  });

  it('derives import method from Adyen CDN script host', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          {
            src: 'https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk/6.0.0/adyen.js',
          },
        ],
      }),
    });

    const attrs = buildImplementationAttributes(payload);

    expect(attrs.importMethod).toBe('CDN');
  });
});

describe('environment detection helpers', () => {
  it('does not infer live from CDN-only traffic', () => {
    const payload = makeScanPayload({
      capturedRequests: [
        makeRequest('https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk.js'),
      ],
    });

    expect(detectEnvironmentFromRequests(payload)).toBeNull();
  });

  it('detects live from analytics requests to checkoutanalytics-live.adyen.com', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
      analyticsData: null,
      capturedRequests: [
        makeRequest('https://checkoutanalytics-live.adyen.com/checkoutanalytics/v3/setup'),
      ],
    });

    expect(detectEnvironmentFromRequests(payload)).toBe('live');
  });

  it('detects test from analytics requests to checkoutanalytics-test.adyen.com', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
      analyticsData: null,
      capturedRequests: [
        makeRequest('https://checkoutanalytics-test.adyen.com/checkoutanalytics/v3/setup'),
      ],
    });

    expect(detectEnvironmentFromRequests(payload)).toBe('test');
  });

  it('resolves live environment from analytics traffic when no config or API calls present', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
      analyticsData: null,
      capturedRequests: [
        makeRequest('https://checkoutanalytics-live.adyen.com/checkoutanalytics/v3/setup'),
      ],
    });

    expect(resolveEnvironment(payload)).toEqual({ env: 'live', source: 'network' });
  });

  it('detects live from checkout API requests on adyenpayments.com', () => {
    const payload = makeScanPayload({
      capturedRequests: [makeRequest('https://checkout-live.adyenpayments.com/v71/sessions')],
    });

    expect(detectEnvironmentFromRequests(payload)).toBe('live');
  });

  it('detects live from unknown live checkout regions', () => {
    const payload = makeScanPayload({
      capturedRequests: [makeRequest('https://checkout-live-nea.adyenpayments.com/v71/sessions')],
    });

    expect(detectEnvironmentFromRequests(payload)).toBe('live');
  });

  it('falls back to unknown when no signal is available', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
      capturedRequests: [],
    });

    expect(resolveEnvironment(payload)).toEqual({
      env: null,
      source: 'unknown',
    });
  });
});

describe('flavor resolution helpers', () => {
  it('uses analytics as primary flavor signal', () => {
    const payload = makeScanPayload({
      analyticsData: makeAnalyticsData({ flavor: 'components' }),
      page: makePageExtract({ checkoutConfig: null }),
    });

    expect(resolveIntegrationFlavor(payload)).toEqual({
      flavor: 'Components',
      source: 'analytics',
    });
  });

  it('marks SDK-loaded pages with no checkout activity as unknown flavor', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: null,
        scripts: [
          {
            src: 'https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/6.0.0/adyen.js',
          },
        ],
      }),
      analyticsData: null,
      capturedRequests: [],
    });

    expect(hasCheckoutActivity(payload)).toBe(false);
    expect(resolveIntegrationFlavor(payload)).toEqual({
      flavor: 'Unknown',
      source: 'sdk-loaded-no-checkout',
    });
  });
});
