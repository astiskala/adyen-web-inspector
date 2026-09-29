import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkoutStrength,
  hasCheckoutActivity,
  isMerchantDocument,
  readCheckoutDom,
  rendersCheckout,
  showsMountedCheckout,
} from '../../../src/shared/checkout-signals';
import {
  makeAdyenMetadata,
  makeAnalyticsData,
  makeCapturedConfig,
  makeCheckoutPage,
  makePageExtract,
  makeRequest,
  makeScanPayload,
} from '../../fixtures/makeScanPayload';

beforeEach(() => {
  document.body.replaceChildren();
});

describe('readCheckoutDom', () => {
  it('reads a mounted Drop-in with a new-card form and cardholder name field', () => {
    document.body.innerHTML = `
      <div class="adyen-checkout__dropin">
        <div class="adyen-checkout__card-input">
          <form class="adyen-checkout__card__form">
            <div class="adyen-checkout__card__holderName"></div>
          </form>
        </div>
      </div>`;

    expect(readCheckoutDom(document)).toEqual({
      dropin: true,
      card: true,
      newCardForm: true,
      cardHolderName: true,
      anyElement: true,
      adyenIframe: false,
    });
  });

  it('does not count a stored-card form, and finds Adyen iframes by name or host', () => {
    document.body.innerHTML = `
      <div class="adyen-checkout__card-input">
        <form class="adyen-checkout__card__form adyen-checkout__card__form--oneClick"></form>
      </div>
      <iframe src="https://checkoutshopper-test.adyen.com/securedfields.html"></iframe>`;

    expect(readCheckoutDom(document)).toMatchObject({ newCardForm: false, adyenIframe: true });
  });

  it('shows mounted checkout for adyen-checkout elements or Adyen iframes only', () => {
    document.body.innerHTML =
      '<script src="https://checkoutshopper-test.adyen.com/sdk.js"></script>';
    expect(showsMountedCheckout(readCheckoutDom(document))).toBe(false);

    document.body.innerHTML = '<div class="adyen-checkout__button"></div>';
    expect(showsMountedCheckout(readCheckoutDom(document))).toBe(true);

    document.body.innerHTML = '<iframe name="adyen-card"></iframe>';
    expect(showsMountedCheckout(readCheckoutDom(document))).toBe(true);
  });
});

function iframeStrength(iframes: { name?: string; src?: string }[]): number {
  return checkoutStrength(makePageExtract({ iframes }));
}

describe('frame signals', () => {
  it('identifies Adyen iframes and merchant documents', () => {
    expect(iframeStrength([{ name: 'adyen-3ds' }])).toBe(10);
    expect(iframeStrength([{ src: 'https://checkoutshopper-live.adyen.com/x.html' }])).toBe(10);
    expect(iframeStrength([{ name: 'threeDSIframe', src: 'https://issuer.example/acs' }])).toBe(0);
    expect(iframeStrength([{}])).toBe(0);
    expect(isMerchantDocument('https://merchant.example/checkout')).toBe(true);
    expect(isMerchantDocument('https://checkoutshopper-test.adyen.com/card.html')).toBe(false);
  });

  it('weighs checkout signals, strongest first', () => {
    expect(checkoutStrength(makePageExtract())).toBe(0);
    expect(
      checkoutStrength(
        makePageExtract({
          capturedConfig: makeCapturedConfig({}),
          componentConfig: {},
          hasDropinDOM: true,
          adyenMetadata: makeAdyenMetadata(),
          scripts: [{ src: 'https://merchant.example/adyen.js' }],
          iframes: [{ name: 'adyen-card' }],
        })
      )
    ).toBe(320);
    expect(checkoutStrength(makePageExtract({ capturedConfig: makeCapturedConfig({}) }))).toBe(
      checkoutStrength(makePageExtract({ componentConfig: {}, iframes: [{ name: 'adyen-x' }] }))
    );
  });

  it('decides whether a frame renders checkout itself', () => {
    expect(rendersCheckout(makePageExtract({ capturedConfig: makeCapturedConfig({}, true) }))).toBe(
      true
    );
    expect(rendersCheckout(makePageExtract({ capturedConfig: makeCapturedConfig({}) }))).toBe(
      false
    );
    expect(rendersCheckout(makePageExtract({ hasCardDOM: true }))).toBe(true);
    expect(rendersCheckout(makePageExtract({ componentMountCount: 1 }))).toBe(true);
    expect(rendersCheckout(makePageExtract({ adyenMetadata: makeAdyenMetadata() }))).toBe(false);
  });
});

describe('hasCheckoutActivity', () => {
  it.each([
    [
      'captured configuration',
      makeScanPayload({ page: makeCheckoutPage({ componentConfig: {} }) }),
    ],
    ['a mounted Drop-in', makeScanPayload({ page: makeCheckoutPage({ hasDropinDOM: true }) })],
    ['a mounted tree', makeScanPayload({ page: makeCheckoutPage({ componentMountCount: 2 }) })],
    [
      'an Adyen-hosted iframe',
      makeScanPayload({
        page: makeCheckoutPage({ iframes: [{ src: 'https://checkoutshopper-test.adyen.com/x' }] }),
      }),
    ],
    ['checkout analytics', makeScanPayload({ analyticsData: makeAnalyticsData() })],
    [
      'Checkout API traffic',
      makeScanPayload({
        capturedRequests: [makeRequest('https://merchant.example/api/v71/paymentMethods')],
      }),
    ],
  ])('sees activity in %s', (_label, payload) => {
    expect(hasCheckoutActivity(payload)).toBe(true);
  });

  it('does not see activity in SDK presence or option-shaped page JSON alone', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        adyenMetadata: makeAdyenMetadata(),
        pageJsonConfig: { locale: 'en-GB' },
        iframes: [{ src: 'https://ads.example/adyen-banner.html' }],
      }),
    });

    expect(hasCheckoutActivity(payload)).toBe(false);
  });
});
