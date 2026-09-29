import { describe, expect, it } from 'vitest';
import {
  checkoutConfigSources,
  hasCapturedCheckoutConfig,
  hasCompleteCheckoutConfig,
  listCheckoutFieldObservations,
  readCheckoutField,
  withRequestDerivedLocale,
} from '../../../src/shared/scan-evidence';
import type { CheckoutPage } from '../../../src/shared/types';
import {
  makeCheckoutPage,
  makeRequest,
  makeScanPayload,
  makeCapturedConfig,
} from '../../fixtures/makeScanPayload';

function payloadWith(page: Partial<CheckoutPage>): ReturnType<typeof makeScanPayload> {
  return makeScanPayload({ page: makeCheckoutPage(page) });
}

describe('readCheckoutField', () => {
  it('prefers captured over component over request-inferred over page JSON values', () => {
    const payload = payloadWith({
      capturedConfig: makeCapturedConfig({ locale: 'nl-NL' }),
      componentConfig: { locale: 'fr-FR' },
      inferredConfig: { locale: 'en-US' },
      pageJsonConfig: { locale: 'de-DE' },
    });

    expect(readCheckoutField(payload, 'locale')).toEqual({
      state: 'present',
      value: 'nl-NL',
      source: 'captured',
    });
    expect(listCheckoutFieldObservations(payload, 'locale')).toEqual([
      { value: 'nl-NL', source: 'captured' },
      { value: 'fr-FR', source: 'component' },
      { value: 'en-US', source: 'inferred', signal: 'adyen-request' },
      { value: 'de-DE', source: 'inferred', signal: 'page-json' },
    ]);
  });

  it('reports the signal of an inferred value', () => {
    expect(
      readCheckoutField(payloadWith({ pageJsonConfig: { locale: 'de-DE' } }), 'locale')
    ).toEqual({
      state: 'present',
      value: 'de-DE',
      source: 'inferred',
      signal: 'page-json',
    });
  });

  it('skips empty captured values in favour of the next source', () => {
    const payload = payloadWith({
      capturedConfig: makeCapturedConfig({ locale: '' }),
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
      name: 'absent when AdyenCheckout options were captured whole',
      page: { capturedConfig: makeCapturedConfig({}, true) },
      expected: { state: 'absent' },
    },
    {
      name: 'unobserved with partial config when capture was not whole',
      page: { capturedConfig: makeCapturedConfig({ locale: 'en-US' }) },
      expected: { state: 'unobserved', reason: 'partial-config' },
    },
    {
      name: 'unobserved with partial config when only a mounted tree was read',
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
      capturedConfig: makeCapturedConfig({}, true),
      inferredConfig: { countryCode: 'NL' },
      pageJsonConfig: { onSubmit: 'checkout' },
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

  it('does not treat option-shaped page JSON alone as configuration', () => {
    const pageJsonOnly = payloadWith({ pageJsonConfig: { locale: 'en-GB', hasSession: true } });

    expect(checkoutConfigSources(pageJsonOnly.page).size).toBe(0);
    expect(hasCapturedCheckoutConfig(pageJsonOnly.page)).toBe(false);
  });

  it('knows whether AdyenCheckout options were captured whole', () => {
    expect(hasCompleteCheckoutConfig(makeCheckoutPage())).toBe(false);
    expect(
      hasCompleteCheckoutConfig(makeCheckoutPage({ capturedConfig: makeCapturedConfig({}) }))
    ).toBe(false);
    expect(
      hasCompleteCheckoutConfig(makeCheckoutPage({ capturedConfig: makeCapturedConfig({}, true) }))
    ).toBe(true);
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

  it('prefers a translation request over a locale that only page JSON shows', () => {
    const page = withRequestDerivedLocale(
      makeCheckoutPage({ pageJsonConfig: { locale: 'en-GB' } }),
      [translation]
    );
    expect(page.inferredConfig).toEqual({ locale: 'fr-FR' });
  });
});
