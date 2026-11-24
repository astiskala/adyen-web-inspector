import { describe, expect, it } from 'vitest';
import {
  checkoutConfigSources,
  hasCapturedCheckoutConfig,
  hasCompleteCheckoutConfig,
  listCheckoutFieldObservations,
  readCheckoutField,
  withRequestDerivedLocale,
} from '../../../src/shared/scan-evidence';
import {
  makeCheckoutPage,
  makeRequest,
  makeScanPayload,
  makeCapturedConfig,
} from '../../fixtures/makeScanPayload';

function payloadWith(
  page: Parameters<typeof makeCheckoutPage>[0]
): ReturnType<typeof makeScanPayload> {
  return makeScanPayload({ page: makeCheckoutPage(page) });
}

describe('readCheckoutField', () => {
  it('prefers captured over component over request-inferred over page JSON values', () => {
    const payload = payloadWith({
      observedConfig: {
        captured: makeCapturedConfig({ locale: 'nl-NL' }),
        component: { locale: 'fr-FR' },
        inferred: { 'adyen-request': { locale: 'en-US' }, 'page-json': { locale: 'de-DE' } },
      },
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
      readCheckoutField(
        payloadWith({
          observedConfig: { inferred: { 'page-json': { locale: 'de-DE' } } },
        }),
        'locale'
      )
    ).toEqual({
      state: 'present',
      value: 'de-DE',
      source: 'inferred',
      signal: 'page-json',
    });
  });

  it('skips empty captured values in favour of the next source', () => {
    const payload = payloadWith({
      observedConfig: {
        captured: makeCapturedConfig({ locale: '' }),
        component: { locale: 'fr-FR', riskEnabled: false },
      },
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
      page: { observedConfig: { captured: makeCapturedConfig({}, true) } },
      expected: { state: 'absent' },
    },
    {
      name: 'unobserved with partial config when capture was not whole',
      page: {
        observedConfig: { captured: makeCapturedConfig({ locale: 'en-US' }) },
      },
      expected: { state: 'unobserved', reason: 'partial-config' },
    },
    {
      name: 'unobserved with partial config when only a mounted tree was read',
      page: { observedConfig: { component: { locale: 'en-US' } } },
      expected: { state: 'unobserved', reason: 'partial-config' },
    },
    {
      name: 'unobserved without config when only inferred values exist',
      page: {
        observedConfig: { inferred: { 'adyen-request': { locale: 'en-US' } } },
      },
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
      observedConfig: {
        captured: makeCapturedConfig({}, true),
        inferred: { 'adyen-request': { countryCode: 'NL' }, 'page-json': { onSubmit: 'checkout' } },
      },
    });

    expect(readCheckoutField(payload, 'onSubmit', { includeInferred: false })).toEqual({
      state: 'absent',
    });
    expect(readCheckoutField(payload, 'countryCode')).toMatchObject({ source: 'inferred' });
  });
});

describe('checkout config sources', () => {
  it('distinguishes captured configuration from inferred-only configuration', () => {
    const inferredOnly = payloadWith({
      observedConfig: { inferred: { 'adyen-request': { countryCode: 'NL' } } },
    });
    const componentOnly = payloadWith({ observedConfig: { component: {} } });

    expect([...checkoutConfigSources(inferredOnly.page)]).toEqual(['inferred']);
    expect(hasCapturedCheckoutConfig(inferredOnly.page)).toBe(false);
    expect(hasCapturedCheckoutConfig(componentOnly.page)).toBe(true);
  });

  it('does not treat option-shaped page JSON alone as configuration', () => {
    const pageJsonOnly = payloadWith({
      observedConfig: {
        inferred: { 'page-json': { locale: 'en-GB', hasSession: true } },
      },
    });

    expect(checkoutConfigSources(pageJsonOnly.page).size).toBe(0);
    expect(hasCapturedCheckoutConfig(pageJsonOnly.page)).toBe(false);
  });

  it('knows whether AdyenCheckout options were captured whole', () => {
    expect(hasCompleteCheckoutConfig(makeCheckoutPage())).toBe(false);
    const partial = makeCheckoutPage({
      observedConfig: { captured: makeCapturedConfig({}) },
    });
    const whole = makeCheckoutPage({
      observedConfig: { captured: makeCapturedConfig({}, true) },
    });
    expect(hasCompleteCheckoutConfig(partial)).toBe(false);
    expect(hasCompleteCheckoutConfig(whole)).toBe(true);
  });
});

describe('withRequestDerivedLocale', () => {
  const translation = makeRequest(
    'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.30.0/translations/fr-FR.json'
  );

  it('infers a locale from translation requests when no configuration shows one', () => {
    const page = withRequestDerivedLocale(
      makeCheckoutPage({
        observedConfig: {
          inferred: { 'adyen-request': { countryCode: 'FR' } },
        },
      }),
      [makeRequest('https://example.com/app.js'), translation]
    );
    expect(page.observedConfig.inferred['adyen-request']).toEqual({
      countryCode: 'FR',
      locale: 'fr-FR',
    });
  });

  it('keeps observed locales and pages without translation requests unchanged', () => {
    const configured = makeCheckoutPage({
      observedConfig: { component: { locale: 'nl-NL' } },
    });
    const untranslated = makeCheckoutPage();

    expect(withRequestDerivedLocale(configured, [translation])).toBe(configured);
    expect(withRequestDerivedLocale(untranslated, [])).toBe(untranslated);
  });

  it('prefers a translation request over a locale that only page JSON shows', () => {
    const page = withRequestDerivedLocale(
      makeCheckoutPage({
        observedConfig: { inferred: { 'page-json': { locale: 'en-GB' } } },
      }),
      [translation]
    );
    expect(page.observedConfig.inferred['adyen-request']).toEqual({ locale: 'fr-FR' });
  });
});
