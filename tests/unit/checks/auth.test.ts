import { describe, it, expect } from 'vitest';
import { AUTH_CHECKS } from '../../../src/background/checks/auth';
import {
  makeScanPayload,
  makeAdyenPayload,
  makeCheckoutPage,
  makeCheckoutConfig,
  makeRequest,
  makeCapturedConfig,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const authClientKey = requireCheck(AUTH_CHECKS, 'auth-client-key');
const authCountryCode = requireCheck(AUTH_CHECKS, 'auth-country-code');
const authLocale = requireCheck(AUTH_CHECKS, 'auth-locale');

describe('auth-client-key', () => {
  it('passes when a valid test_ client key is present', () => {
    const payload = makeAdyenPayload({}, { clientKey: 'test_LONGVALID123' });
    expect(authClientKey.run(payload).severity).toBe('pass');
  });

  it('passes when a valid live_ client key is present', () => {
    const payload = makeAdyenPayload({}, { clientKey: 'live_LONGVALID123' });
    expect(authClientKey.run(payload).severity).toBe('pass');
  });

  it('warns when an origin key (pub.v2.) is used', () => {
    const payload = makeAdyenPayload({}, { clientKey: 'pub.v2.ABCDE' });
    expect(authClientKey.run(payload).severity).toBe('warn');
  });

  it('skips (no client key) when no client key is configured', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig(makeCheckoutConfig({ clientKey: undefined })),
      }),
    });
    expect(authClientKey.run(payload).severity).toBe('skip');
  });

  it('skips when no checkout config present', () => {
    const payload = makeScanPayload();
    expect(authClientKey.run(payload).severity).toBe('skip');
  });
});

describe('auth-country-code', () => {
  it('passes when country code is set', () => {
    const payload = makeAdyenPayload({}, { countryCode: 'NL' });
    const result = authCountryCode.run(payload);
    expect(result.severity).toBe('pass');
    expect(result.title).toBe('countryCode is set correctly.');
  });

  it('fails when country code is missing from verified config', () => {
    const payload = makeAdyenPayload({}, { countryCode: undefined });
    expect(authCountryCode.run(payload).severity).toBe('fail');
  });

  it('does not fail when country code is missing from partial config', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({ capturedConfig: makeCapturedConfig({ clientKey: 'test_X' }) }),
    });
    expect(authCountryCode.run(payload).severity).toBe('notice');
  });

  it('skips when no checkout config present', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({ capturedConfig: null }),
    });
    expect(authCountryCode.run(payload).severity).toBe('skip');
  });

  it('skips when country code is missing and only inferred config is present', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: null,
        inferredConfig: makeCheckoutConfig({ countryCode: undefined }),
      }),
    });
    expect(authCountryCode.run(payload).severity).toBe('skip');
  });

  it('does not claim that an inferred country code was verified in checkout config', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({ inferredConfig: { countryCode: 'IN' } }),
    });
    expect(authCountryCode.run(payload).severity).toBe('notice');
  });

  it('returns notice when country code is found only in inferred config', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: null,
        inferredConfig: makeCheckoutConfig({ countryCode: 'IN' }),
      }),
    });
    expect(authCountryCode.run(payload).severity).toBe('notice');
  });
});

describe('auth-locale', () => {
  it('passes when locale is set to a supported translation locale', () => {
    const payload = makeAdyenPayload({}, { locale: 'en-US' });
    const result = authLocale.run(payload);
    expect(result.severity).toBe('pass');
    expect(result.title).toBe('locale is set correctly.');
  });

  it('passes when locale is set to a language-only supported locale', () => {
    const payload = makeAdyenPayload({}, { locale: 'ar' });
    expect(authLocale.run(payload).severity).toBe('pass');
  });

  it('warns when locale is unsupported by Adyen Web translations', () => {
    const payload = makeAdyenPayload({}, { locale: 'en-GB' });
    const result = authLocale.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.title).toContain('not in the supported Adyen Web translations list');
  });

  it('warns when locale is missing from verified config', () => {
    const payload = makeAdyenPayload({}, { locale: undefined });
    expect(authLocale.run(payload).severity).toBe('warn');
  });

  it('does not warn when locale is missing from partial config', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({ capturedConfig: makeCapturedConfig({ clientKey: 'test_X' }) }),
    });
    expect(authLocale.run(payload).severity).toBe('notice');
  });

  it('skips when no checkout config present', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({ capturedConfig: null }),
    });
    expect(authLocale.run(payload).severity).toBe('skip');
  });

  it('skips when locale is missing and only inferred config is present', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: null,
        inferredConfig: makeCheckoutConfig({ locale: undefined }),
      }),
    });
    expect(authLocale.run(payload).severity).toBe('skip');
  });

  it('returns notice when locale is set only in inferred config', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: null,
        inferredConfig: makeCheckoutConfig({ locale: 'en-US' }),
      }),
    });
    expect(authLocale.run(payload).severity).toBe('notice');
  });

  it('falls back to a component locale when captured locale is empty', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig({ locale: '' }),
        componentConfig: { locale: 'nl-NL' },
      }),
    });
    expect(authLocale.run(payload).severity).toBe('pass');
  });
});

describe('componentConfig fallback', () => {
  it('auth-client-key resolves from componentConfig', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        componentConfig: makeCheckoutConfig({ clientKey: 'test_COMPONENT' }),
      }),
    });
    expect(authClientKey.run(payload).severity).toBe('pass');
  });

  it('auth-country-code resolves from componentConfig', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        componentConfig: makeCheckoutConfig({ countryCode: 'NL' }),
      }),
    });
    expect(authCountryCode.run(payload).severity).toBe('pass');
  });

  it('auth-locale resolves from componentConfig', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        componentConfig: makeCheckoutConfig({ locale: 'nl-NL' }),
      }),
    });
    expect(authLocale.run(payload).severity).toBe('pass');
  });
});

describe('auth-client-key-rejected', () => {
  const authKeyRejected = requireCheck(AUTH_CHECKS, 'auth-client-key-rejected');
  const sessionsUrl =
    'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sessions/CS123/setup?clientKey=test_SECRETVALUE';

  it('skips when no Adyen client-side responses were captured', () => {
    const payload = makeScanPayload({
      capturedRequests: [
        makeRequest(
          'https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/sdk/6.0.0/adyen.js'
        ),
        makeRequest(sessionsUrl, { statusCode: 0 }),
      ],
    });
    expect(authKeyRejected.run(payload).severity).toBe('skip');
  });

  it('passes when Adyen accepted the client-side requests', () => {
    const payload = makeScanPayload({
      capturedRequests: [
        makeRequest(sessionsUrl, { type: 'other' }),
        makeRequest('https://checkoutanalytics-live-us.adyen.com/checkoutanalytics/v3/analytics', {
          statusCode: 204,
        }),
      ],
    });
    expect(authKeyRejected.run(payload).severity).toBe('pass');
  });

  it('fails on 401 or 403 responses and reports only the rejecting origins', () => {
    const payload = makeScanPayload({
      capturedRequests: [
        makeRequest(sessionsUrl, { statusCode: 401 }),
        makeRequest(sessionsUrl, { statusCode: 401 }),
        makeRequest(
          'https://checkoutanalytics-test.adyen.com/checkoutanalytics/v3/analytics?clientKey=test_SECRETVALUE',
          {
            statusCode: 403,
          }
        ),
        makeRequest('https://merchant.example/api/payments', { statusCode: 401 }),
      ],
    });
    const result = authKeyRejected.run(payload);
    expect(result.severity).toBe('fail');
    expect(result.detail).toContain(
      'HTTP 401 from https://checkoutshopper-test.adyen.com, HTTP 403 from https://checkoutanalytics-test.adyen.com.'
    );
    expect(result.detail).not.toContain('SECRETVALUE');
    expect(result.detail).not.toContain('merchant.example');
  });
});
