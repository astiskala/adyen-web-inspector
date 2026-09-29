import { describe, expect, it } from 'vitest';
import {
  checkoutConfigSources,
  hasCapturedCheckoutConfig,
  listCheckoutFieldObservations,
  readCheckoutField,
  withRequestDerivedLocale,
} from '../../../src/shared/scan-evidence';
import type { CheckoutPage } from '../../../src/shared/types';
import { makeCheckoutPage, makeRequest, makeScanPayload } from '../../fixtures/makeScanPayload';

function payloadWith(page: Partial<CheckoutPage>): ReturnType<typeof makeScanPayload> {
  return makeScanPayload({ page: makeCheckoutPage(page) });
}

describe('readCheckoutField', () => {
  it('prefers captured over component over inferred values', () => {
    const payload = payloadWith({
      checkoutConfig: { locale: 'nl-NL' },
      componentConfig: { locale: 'fr-FR' },
      inferredConfig: { locale: 'en-US' },
    });

    expect(readCheckoutField(payload, 'locale')).toEqual({
      state: 'present',
      value: 'nl-NL',
      source: 'captured',
    });
    expect(listCheckoutFieldObservations(payload, 'locale').map((o) => o.source)).toEqual([
      'captured',
      'component',
      'inferred',
    ]);
  });

  it('skips empty captured values in favour of the next source', () => {
    const payload = payloadWith({
      checkoutConfig: { locale: '' },
      componentConfig: { locale: 'fr-FR', riskEnabled: false },
    });

    expect(readCheckoutField(payload, 'locale')).toMatchObject({
      value: 'fr-FR',
      source: 'component',
    });
    expect(readCheckoutField(payload, 'riskEnabled')).toMatchObject({
      state: 'present',
      value: false,
    });
  });

  it.each([
    {
      name: 'absent when AdyenCheckout options were captured directly',
      page: { checkoutConfig: {}, checkoutConfigComplete: true },
      expected: { state: 'absent' },
    },
    {
      name: 'unobserved with partial config when capture was not direct',
      page: { componentConfig: { locale: 'en-US' } },
      expected: { state: 'unobserved', reason: 'partial-config' },
    },
    {
      name: 'unobserved without config when only inferred values exist',
      page: { inferredConfig: { locale: 'en-US' } },
      expected: { state: 'unobserved', reason: 'no-config' },
    },
    {
      name: 'unobserved without config when nothing was captured',
      page: {},
      expected: { state: 'unobserved', reason: 'no-config' },
    },
  ])('reports a missing field as $name', ({ page, expected }) => {
    expect(readCheckoutField(payloadWith(page), 'countryCode')).toEqual(expected);
  });

  it('can ignore inferred values while still proving absence', () => {
    const payload = payloadWith({
      checkoutConfig: {},
      checkoutConfigComplete: true,
      inferredConfig: { onSubmit: 'checkout', countryCode: 'NL' },
    });

    expect(readCheckoutField(payload, 'onSubmit', { includeInferred: false })).toEqual({
      state: 'absent',
    });
    expect(readCheckoutField(payload, 'countryCode')).toMatchObject({ source: 'inferred' });
  });
});

describe('checkout config sources', () => {
  it('distinguishes captured configuration from inferred-only configuration', () => {
    const inferredOnly = payloadWith({ inferredConfig: { countryCode: 'NL' } });
    const componentOnly = payloadWith({ componentConfig: {} });

    expect([...checkoutConfigSources(inferredOnly.page)]).toEqual(['inferred']);
    expect(hasCapturedCheckoutConfig(inferredOnly.page)).toBe(false);
    expect(hasCapturedCheckoutConfig(componentOnly.page)).toBe(true);
  });
});

describe('withRequestDerivedLocale', () => {
  const translation = makeRequest(
    'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.30.0/translations/fr-FR.json'
  );

  it('infers a locale from translation requests when no configuration shows one', () => {
    const page = withRequestDerivedLocale(
      makeCheckoutPage({ inferredConfig: { countryCode: 'FR' } }),
      [makeRequest('https://example.com/app.js'), translation]
    );
    expect(page.inferredConfig).toEqual({ countryCode: 'FR', locale: 'fr-FR' });
  });

  it('keeps observed locales and pages without translation requests unchanged', () => {
    const configured = makeCheckoutPage({ componentConfig: { locale: 'nl-NL' } });
    const untranslated = makeCheckoutPage();

    expect(withRequestDerivedLocale(configured, [translation])).toBe(configured);
    expect(withRequestDerivedLocale(untranslated, [])).toBe(untranslated);
  });
});
