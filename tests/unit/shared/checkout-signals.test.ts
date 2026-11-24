import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkoutStrength,
  hasCheckoutActivity,
  isMerchantDocument,
  readCheckoutDom,
  isRenderingCheckout,
  hasMountedCheckout,
  collectShadowRoots,
} from '../../../src/shared/checkout-signals';
import {
  makeAdyenMetadata,
  makeAnalytics,
  makeCapturedConfig,
  makeCheckoutPage,
  makePageExtract,
  makeRequest,
  makeScanPayload,
} from '../../fixtures/makeScanPayload';

beforeEach(() => {
  document.body.replaceChildren();
});

/**
Nests a shadow host `depth` elements below body and returns its open shadow root.
*/
function deepShadowRoot(depth: number): ShadowRoot {
  let parent: HTMLElement = document.body;
  for (let level = 0; level < depth; level += 1) {
    const child = document.createElement('div');
    parent.append(child);
    parent = child;
  }
  return parent.attachShadow({ mode: 'open' });
}

describe('readCheckoutDom', () => {
  it('finds checkout mounted deep inside nested open shadow roots', () => {
    const outer = deepShadowRoot(12);
    const host = document.createElement('checkout-widget');
    outer.append(host);
    const inner = host.attachShadow({ mode: 'open' });
    inner.innerHTML =
      '<div class="adyen-checkout__dropin"><div class="adyen-checkout__card-input"></div></div>';

    expect(readCheckoutDom(document)).toMatchObject({ dropin: true, card: true, anyElement: true });
    expect(collectShadowRoots(document)).toEqual([outer, inner]);
  });

  it('stops looking for shadow roots on very large pages', () => {
    const filler = document.createElement('div');
    filler.innerHTML = '<span></span>'.repeat(20_001);
    document.body.append(filler);
    deepShadowRoot(1).innerHTML = '<div class="adyen-checkout__dropin"></div>';

    expect(collectShadowRoots(document)).toEqual([]);
    expect(readCheckoutDom(document).dropin).toBe(false);
  });

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
    expect(hasMountedCheckout(readCheckoutDom(document))).toBe(false);

    document.body.innerHTML = '<div class="adyen-checkout__button"></div>';
    expect(hasMountedCheckout(readCheckoutDom(document))).toBe(true);

    document.body.innerHTML = '<iframe name="adyen-card"></iframe>';
    expect(hasMountedCheckout(readCheckoutDom(document))).toBe(true);
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
    const capturedConfig = makeCapturedConfig({});
    const adyenMetadata = makeAdyenMetadata();
    const everySignal = makePageExtract({
      observedConfig: { captured: capturedConfig, component: {} },
      hasDropinDOM: true,
      adyenMetadata,
      scripts: [{ src: 'https://merchant.example/adyen.js' }],
      iframes: [{ name: 'adyen-card' }],
    });
    expect(checkoutStrength(everySignal)).toBe(320);
    expect(
      checkoutStrength(makePageExtract({ observedConfig: { captured: capturedConfig } }))
    ).toBe(
      checkoutStrength(
        makePageExtract({
          observedConfig: { component: {} },
          iframes: [{ name: 'adyen-x' }],
        })
      )
    );
  });

  it('decides whether a frame renders checkout itself', () => {
    const wholeConfig = makeCapturedConfig({}, true);
    const partialConfig = makeCapturedConfig({});
    const adyenMetadata = makeAdyenMetadata();
    expect(
      isRenderingCheckout(makePageExtract({ observedConfig: { captured: wholeConfig } }))
    ).toBe(true);
    expect(
      isRenderingCheckout(makePageExtract({ observedConfig: { captured: partialConfig } }))
    ).toBe(false);
    expect(isRenderingCheckout(makePageExtract({ hasCardDOM: true }))).toBe(true);
    expect(isRenderingCheckout(makePageExtract({ componentMountCount: 1 }))).toBe(true);
    expect(isRenderingCheckout(makePageExtract({ adyenMetadata }))).toBe(false);
  });
});

describe('hasCheckoutActivity', () => {
  it.each([
    [
      'captured configuration',
      makeScanPayload({
        page: makeCheckoutPage({ observedConfig: { component: {} } }),
      }),
    ],
    ['a mounted Drop-in', makeScanPayload({ page: makeCheckoutPage({ hasDropinDOM: true }) })],
    ['a mounted tree', makeScanPayload({ page: makeCheckoutPage({ componentMountCount: 2 }) })],
    [
      'an Adyen-hosted iframe',
      makeScanPayload({
        page: makeCheckoutPage({ iframes: [{ src: 'https://checkoutshopper-test.adyen.com/x' }] }),
      }),
    ],
    ['checkout analytics', makeScanPayload({ analytics: makeAnalytics() })],
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
        observedConfig: { inferred: { 'page-json': { locale: 'en-GB' } } },
        iframes: [{ src: 'https://ads.example/adyen-banner.html' }],
      }),
    });

    expect(hasCheckoutActivity(payload)).toBe(false);
  });
});
