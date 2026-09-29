import { describe, expect, it } from 'vitest';
import { detectSdkPresence, hasAdyenScriptHint } from '../../../src/shared/sdk-presence';
import { makeAdyenMetadata, makeCheckoutPage } from '../../fixtures/makeScanPayload';

const CDN_SCRIPT = 'https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk/6.31.0/adyen.js';

describe('detectSdkPresence', () => {
  it('prefers Adyen Web metadata, then an Adyen-hosted checkout script', () => {
    expect(
      detectSdkPresence(
        makeCheckoutPage({ adyenMetadata: makeAdyenMetadata(), scripts: [{ src: CDN_SCRIPT }] })
      )
    ).toEqual({ detected: true, source: 'metadata' });
    expect(detectSdkPresence(makeCheckoutPage({ scripts: [{ src: CDN_SCRIPT }] }))).toEqual({
      detected: true,
      source: 'adyen-script',
    });
  });

  it('does not treat merchant-hosted bundles as presence', () => {
    const page = makeCheckoutPage({
      scripts: [{ src: 'https://merchant.example/adyen-checkout.js' }],
    });

    expect(detectSdkPresence(page)).toEqual({ detected: false, source: 'none' });
    expect(hasAdyenScriptHint(page)).toBe(true);
  });

  it('reports no hint when no script mentions Adyen', () => {
    expect(
      hasAdyenScriptHint(makeCheckoutPage({ scripts: [{ src: 'https://cdn.example/app.js' }] }))
    ).toBe(false);
  });
});
