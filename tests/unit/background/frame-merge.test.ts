import { describe, expect, it } from 'vitest';
import { mergeFrames } from '../../../src/background/frame-merge';
import type { FrameExtraction } from '../../../src/background/scan-browser';
import type { CheckoutPage, PageExtractResult } from '../../../src/shared/types';
import { readCheckoutField } from '../../../src/shared/scan-evidence';
import {
  makeAdyenMetadata,
  makePageExtract,
  makeScanPayload,
  makeCapturedCheckoutConfig,
  makeCapturedConfig,
} from '../../fixtures/makeScanPayload';
import { framesOf } from '../../fixtures/fakeScanBrowser';

function merge(...frames: (PageExtractResult | null)[]): CheckoutPage {
  return mergeFramesOrThrow(framesOf(...frames));
}

function mergeFramesOrThrow(frames: readonly FrameExtraction[]): CheckoutPage {
  const page = mergeFrames(frames);
  if (page === null) throw new Error('Expected a Checkout page');
  return page;
}

describe('mergeFrames frame selection', () => {
  it('selects a child frame containing checkout configuration', () => {
    const page = merge(
      makePageExtract({
        adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }),
        pageUrl: 'https://merchant.example/',
      }),
      makePageExtract({
        observedConfig: { captured: makeCapturedCheckoutConfig() },
        pageUrl: 'https://merchant.example/embedded-checkout',
        isInsideIframe: true,
      })
    );

    expect(page.pageUrl).toBe('https://merchant.example/embedded-checkout');
    expect(page.checkoutInIframe).toBe(true);
    expect(page.adyenMetadata?.version).toBe('6.30.0');
    expect(page).not.toHaveProperty('isInsideIframe');
  });

  it('prefers top-frame checkout configuration over weaker child-frame signals', () => {
    const page = mergeFramesOrThrow([
      {
        frameId: 4,
        result: makePageExtract({
          adyenMetadata: makeAdyenMetadata(),
          pageUrl: 'https://checkoutshopper-test.adyen.com/internal',
        }),
      },
      {
        frameId: 0,
        result: makePageExtract({
          observedConfig: { captured: makeCapturedCheckoutConfig() },
          pageUrl: 'https://merchant.example/checkout',
        }),
      },
    ]);

    expect(page.pageUrl).toBe('https://merchant.example/checkout');
    expect(page.checkoutInIframe).toBe(false);
  });

  it('ranks frames with Adyen script hints and Adyen iframes above plain frames', () => {
    const page = merge(
      makePageExtract({ pageUrl: 'https://merchant.example/' }),
      makePageExtract({
        scripts: [{ src: 'https://merchant.example/adyen-bundle.js' }],
        iframes: [{ name: 'adyen-card' }],
        pageUrl: 'https://merchant.example/pay',
      })
    );

    expect(page.pageUrl).toBe('https://merchant.example/pay');
  });

  it('uses the top frame when frames have equal signal strength', () => {
    const page = mergeFramesOrThrow([
      { frameId: 2, result: makePageExtract({ pageUrl: 'https://child.example/' }) },
      { frameId: 0, result: makePageExtract({ pageUrl: 'https://merchant.example/' }) },
    ]);

    expect(page.pageUrl).toBe('https://merchant.example/');
    expect(page.checkoutInIframe).toBe(false);
  });

  it('ignores frames that return null and returns null when none produced a result', () => {
    const configured = makePageExtract({
      observedConfig: { captured: makeCapturedCheckoutConfig() },
    });
    expect(merge(null, configured)).toMatchObject({
      checkoutInIframe: true,
    });
    expect(mergeFrames(framesOf(null))).toBeNull();
    expect(mergeFrames([])).toBeNull();
  });
});

describe('mergeFrames field scope', () => {
  it('reports an embedded checkout even when the top frame scores higher', () => {
    const page = merge(
      makePageExtract({
        observedConfig: { captured: makeCapturedCheckoutConfig() },
      }),
      makePageExtract({ hasDropinDOM: true, pageUrl: 'https://merchant.example/embedded' })
    );

    expect(page.pageUrl).toBe('https://example.com/checkout');
    expect(page.checkoutInIframe).toBe(true);
    expect(page.hasDropinDOM).toBe(true);
  });

  it('does not confuse hosted card fields with a merchant checkout iframe', () => {
    const page = merge(
      makePageExtract({
        observedConfig: { captured: makeCapturedCheckoutConfig() },
      }),
      makePageExtract({
        hasCardDOM: true,
        hasNewCardFormDOM: true,
        apiKeyDetected: true,
        pageUrl: 'https://checkoutshopper-test.adyenpayments.com/card.html',
      })
    );

    expect(page.checkoutInIframe).toBe(false);
    expect(page.hasCardDOM).toBeUndefined();
    expect(page.hasNewCardFormDOM).toBeUndefined();
    expect(page.apiKeyDetected).toBe(true);
  });

  it('merges card form DOM flags from merchant frames', () => {
    const page = merge(
      makePageExtract({
        observedConfig: { captured: makeCapturedCheckoutConfig() },
      }),
      makePageExtract({
        hasCardDOM: true,
        hasNewCardFormDOM: true,
        hasCardHolderNameDOM: true,
        pageUrl: 'https://merchant.example/embedded-card',
      })
    );

    expect(page).toMatchObject({
      hasCardDOM: true,
      hasNewCardFormDOM: true,
      hasCardHolderNameDOM: true,
    });
  });

  it('keeps DOM flags and selected-frame fields of an Adyen-hosted selected frame', () => {
    const page = merge(
      makePageExtract({ pageUrl: 'https://merchant.example/' }),
      makePageExtract({
        hasDropinDOM: true,
        componentMountCount: 1,
        scripts: [{ src: 'https://checkoutshopper-test.adyen.com/sdk.js' }],
        pageUrl: 'https://checkoutshopper-test.adyen.com/dropin.html',
      })
    );

    expect(page).toMatchObject({
      pageUrl: 'https://checkoutshopper-test.adyen.com/dropin.html',
      hasDropinDOM: true,
      componentMountCount: 1,
      checkoutInIframe: false,
    });
  });

  it('merges each configuration slot across frames with earlier frames winning', () => {
    const page = merge(
      makePageExtract({
        observedConfig: { captured: makeCapturedConfig({ locale: 'nl-NL' }) },
      }),
      makePageExtract({
        observedConfig: {
          captured: makeCapturedConfig({ locale: 'fr-FR', countryCode: 'FR' }),
          component: { onSubmit: 'checkout' },
          inferred: { 'adyen-request': { environment: 'test' }, 'page-json': { locale: 'de-DE' } },
        },
        pageUrl: 'https://merchant.example/embedded',
      })
    );

    expect(page).toMatchObject({
      observedConfig: {
        captured: makeCapturedConfig({ locale: 'nl-NL', countryCode: 'FR' }),
        component: { onSubmit: 'checkout' },
        inferred: { 'adyen-request': { environment: 'test' }, 'page-json': { locale: 'de-DE' } },
      },
    });
  });

  it('proves absence when any frame captured AdyenCheckout options whole', () => {
    const page = merge(
      makePageExtract({
        observedConfig: { captured: makeCapturedConfig({ locale: 'nl-NL' }) },
      }),
      makePageExtract({
        observedConfig: {
          captured: makeCapturedConfig({ clientKey: 'test_K' }, true),
        },
        pageUrl: 'https://merchant.example/embedded',
      })
    );

    expect(page.observedConfig.captured).toEqual(
      makeCapturedConfig({ locale: 'nl-NL', clientKey: 'test_K' }, true)
    );
    expect(readCheckoutField(makeScanPayload({ page }), 'countryCode')).toEqual({
      state: 'absent',
    });
  });

  it('combines analytics across frames, earlier frames winning per SDK field and component', () => {
    const page = merge(
      makePageExtract(),
      makePageExtract({
        analytics: {
          sdk: { flavor: 'dropin' },
          rendered: [{ type: 'paypal', showPayButton: false }],
          paymentMethods: ['paypal', 'dropin'],
        },
        pageUrl: 'https://merchant.example/a',
      }),
      makePageExtract({
        analytics: {
          sdk: { flavor: 'components', version: '6.30.0' },
          rendered: [
            { type: 'paypal', showPayButton: true },
            { type: 'scheme', showPayButton: true },
          ],
          paymentMethods: ['scheme', 'paypal'],
        },
        pageUrl: 'https://merchant.example/b',
      })
    );

    expect(page.analytics).toEqual({
      sdk: { flavor: 'dropin', version: '6.30.0' },
      rendered: [
        { type: 'paypal', showPayButton: false },
        { type: 'scheme', showPayButton: true },
      ],
      paymentMethods: ['paypal', 'dropin', 'scheme'],
    });
    expect(merge(makePageExtract())).not.toHaveProperty('analytics');
  });

  it('leaves absence unproven when no frame captured options whole', () => {
    const partial = merge(
      makePageExtract({
        observedConfig: {
          captured: makeCapturedConfig({ clientKey: 'test_K' }),
        },
      }),
      makePageExtract({ observedConfig: { component: { locale: 'nl-NL' } } })
    );
    const uncaptured = merge(
      makePageExtract({ observedConfig: { component: { locale: 'nl-NL' } } })
    );

    expect(partial.observedConfig.captured?.complete).toBe(false);
    expect(uncaptured.observedConfig.captured).toBeNull();
  });
});
