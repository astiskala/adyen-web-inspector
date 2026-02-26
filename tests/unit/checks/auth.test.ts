import { describe, it, expect } from 'vitest';
import { AUTH_CHECKS } from '../../../src/background/checks/auth';
import {
  makeScanPayload,
  makeAdyenPayload,
  makePageExtract,
  makeCheckoutConfig,
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
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig({ clientKey: undefined }),
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

  it('fails when country code is missing', () => {
    const payload = makeAdyenPayload({}, { countryCode: undefined });
    expect(authCountryCode.run(payload).severity).toBe('fail');
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

  it('warns when locale is missing', () => {
    const payload = makeAdyenPayload({}, { locale: undefined });
    expect(authLocale.run(payload).severity).toBe('warn');
  });
});
