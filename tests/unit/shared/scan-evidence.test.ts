import { describe, expect, it } from 'vitest';
import {
  hasCapturedCheckoutConfig,
  hasVerifiedCheckoutConfig,
  observeCheckoutField,
  resolveCapturedCheckoutConfig,
} from '../../../src/shared/scan-evidence';
import { makePageExtract, makeScanPayload } from '../../fixtures/makeScanPayload';

describe('checkout configuration evidence', () => {
  it('prefers a captured value to a component and inferred value', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: { locale: 'nl-NL' },
        componentConfig: { locale: 'fr-FR' },
        inferredConfig: { locale: 'en-US' },
      }),
    });

    expect(observeCheckoutField(payload, 'locale')).toEqual({ value: 'nl-NL', source: 'captured' });
    expect(resolveCapturedCheckoutConfig(payload)).toEqual({ locale: 'nl-NL' });
  });

  it('uses a component value when the captured config is partial or empty', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: { locale: '' },
        componentConfig: { locale: 'fr-FR', riskEnabled: false },
      }),
    });

    expect(observeCheckoutField(payload, 'locale')).toEqual({
      value: 'fr-FR',
      source: 'component',
    });
    expect(observeCheckoutField(payload, 'riskEnabled')).toEqual({
      value: false,
      source: 'component',
    });
    expect(resolveCapturedCheckoutConfig(payload)).toEqual({ locale: 'fr-FR', riskEnabled: false });
    expect(hasCapturedCheckoutConfig(payload)).toBe(true);
    expect(hasVerifiedCheckoutConfig(payload)).toBe(false);
  });

  it('verifies absence only when actual checkout options were captured', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: {}, checkoutConfigComplete: true }),
    });
    expect(hasVerifiedCheckoutConfig(payload)).toBe(true);
  });

  it('reports inferred values without presenting inferred-only config as captured', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ inferredConfig: { countryCode: 'NL' } }),
    });

    expect(observeCheckoutField(payload, 'countryCode')).toEqual({
      value: 'NL',
      source: 'inferred',
    });
    expect(hasCapturedCheckoutConfig(payload)).toBe(false);
    expect(hasVerifiedCheckoutConfig(payload)).toBe(false);
    expect(resolveCapturedCheckoutConfig(payload)).toBeNull();
    expect(observeCheckoutField(payload, 'riskEnabled')).toEqual({
      value: undefined,
      source: 'unknown',
    });
  });
});
