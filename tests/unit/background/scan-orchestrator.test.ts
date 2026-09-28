import { describe, expect, it } from 'vitest';
import { runScan } from '../../../src/background/scan-orchestrator';
import type { PageExtractResult } from '../../../src/shared/types';
import {
  makeAdyenMetadata,
  makeCheckoutConfig,
  makeHeader,
  makePageExtract,
} from '../../fixtures/makeScanPayload';
import { createFakeScanBrowser, framesOf } from '../../fixtures/fakeScanBrowser';

const TAB_ID = 1;

describe('runScan sequencing', () => {
  it('captures network first, waits for the tab and settles before extracting', async () => {
    const browser = createFakeScanBrowser({
      extractions: [framesOf(makePageExtract({ checkoutConfig: makeCheckoutConfig() }))],
      release: { latest: '6.40.0', releaseDates: {} },
    });

    const result = await runScan(TAB_ID, browser);

    expect(browser.calls.slice(0, 4)).toEqual([
      'captureNetwork',
      'getReleaseInfo',
      `waitForTabComplete:${TAB_ID}`,
      'extractFrames',
    ]);
    expect(browser.sleeps[0]).toBe(2_000);
    expect(browser.calls.at(-1)).toBe('storeResult');
    expect(browser.stored).toEqual([result]);
    expect(result.payload.versionInfo.latest).toBe('6.40.0');
    expect(result.scannedAt).toBe('2026-09-28T00:00:02.000Z');
    expect(browser.networkStops).toBeGreaterThan(0);
  });

  it('retries extraction while the SDK is loading until configuration appears', async () => {
    const loading = makePageExtract({ adyenMetadata: makeAdyenMetadata() });
    const ready = makePageExtract({
      adyenMetadata: makeAdyenMetadata(),
      checkoutConfig: makeCheckoutConfig(),
    });
    const browser = createFakeScanBrowser({
      extractions: [framesOf(loading), framesOf(loading), framesOf(ready)],
    });

    const result = await runScan(TAB_ID, browser);

    expect(browser.calls.filter((call) => call === 'extractFrames')).toHaveLength(3);
    expect(browser.sleeps).toEqual([2_000, 500, 500]);
    expect(result.payload.page.checkoutConfig).not.toBeNull();
  });

  it('gives up retrying after the extraction deadline', async () => {
    const browser = createFakeScanBrowser({
      extractions: [
        framesOf(makePageExtract({ scripts: [{ src: 'https://merchant.example/adyen.js' }] })),
      ],
    });

    await runScan(TAB_ID, browser);

    expect(browser.calls.filter((call) => call === 'extractFrames')).toHaveLength(9);
    expect(browser.sleeps.slice(1)).toEqual(Array.from({ length: 8 }, () => 500));
  });

  it('does not retry when there is no sign of the SDK', async () => {
    const browser = createFakeScanBrowser({ extractions: [framesOf(makePageExtract())] });

    await runScan(TAB_ID, browser);

    expect(browser.calls.filter((call) => call === 'extractFrames')).toHaveLength(1);
    expect(browser.sleeps).toEqual([2_000]);
  });

  it('stops network capture and stores nothing when the tab never loads', async () => {
    const browser = createFakeScanBrowser({ tabLoadError: new Error('Tab 1 did not load') });

    await expect(runScan(TAB_ID, browser)).rejects.toThrow('Tab 1 did not load');
    expect(browser.networkStops).toBe(1);
    expect(browser.stored).toEqual([]);
  });

  it('probes bundles for a version only when no stronger signal exists', async () => {
    const browser = createFakeScanBrowser({
      extractions: [framesOf(makePageExtract({ checkoutConfig: makeCheckoutConfig() }))],
      bundleVersion: '6.20.0',
    });

    const result = await runScan(TAB_ID, browser);

    expect(browser.calls).toContain('probeBundleVersion');
    expect(result.payload.versionInfo.detected).toBe('6.20.0');
  });
});

describe('runScan document headers', () => {
  const captured = [makeHeader('content-security-policy', "default-src 'self'")];
  const probed = [makeHeader('x-content-type-options', 'nosniff')];

  it('uses headers captured for the top-frame document', async () => {
    const browser = createFakeScanBrowser({
      extractions: [framesOf(makePageExtract({ checkoutConfig: makeCheckoutConfig() }))],
      network: { mainDocumentHeaders: captured },
      documentHeaders: probed,
    });

    const result = await runScan(TAB_ID, browser);

    expect(result.payload.mainDocumentHeaders).toEqual(captured);
    expect(browser.calls.some((call) => call.startsWith('fetchDocumentHeaders'))).toBe(false);
  });

  it('probes the checkout document when checkout is embedded in an iframe', async () => {
    const browser = createFakeScanBrowser({
      extractions: [
        framesOf(
          makePageExtract({ pageUrl: 'https://merchant.example/' }),
          makePageExtract({
            checkoutConfig: makeCheckoutConfig(),
            pageUrl: 'https://merchant.example/embedded',
          })
        ),
      ],
      network: { mainDocumentHeaders: captured },
      documentHeaders: probed,
    });

    const result = await runScan(TAB_ID, browser);

    expect(browser.calls).toContain('fetchDocumentHeaders:https://merchant.example/embedded');
    expect(result.payload.mainDocumentHeaders).toEqual(probed);
  });

  it('probes the document when no main-frame headers were captured', async () => {
    const browser = createFakeScanBrowser({
      extractions: [framesOf(makePageExtract())],
      documentHeaders: probed,
    });

    const result = await runScan(TAB_ID, browser);

    expect(result.payload.mainDocumentHeaders).toEqual(probed);
  });
});

async function scanFrames(...frames: (PageExtractResult | null)[]): Promise<PageExtractResult> {
  const browser = createFakeScanBrowser({ extractions: [framesOf(...frames)] });
  return (await runScan(TAB_ID, browser)).payload.page;
}

describe('runScan frame selection', () => {
  it('selects a child frame containing checkout configuration', async () => {
    const page = await scanFrames(
      makePageExtract({
        adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }),
        pageUrl: 'https://merchant.example/',
      }),
      makePageExtract({
        checkoutConfig: makeCheckoutConfig(),
        pageUrl: 'https://merchant.example/embedded-checkout',
      })
    );

    expect(page.pageUrl).toBe('https://merchant.example/embedded-checkout');
    expect(page.isInsideIframe).toBe(true);
    expect(page.adyenMetadata?.version).toBe('6.30.0');
  });

  it('prefers top-frame checkout configuration over weaker child-frame signals', async () => {
    const browser = createFakeScanBrowser({
      extractions: [
        [
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
              checkoutConfig: makeCheckoutConfig(),
              pageUrl: 'https://merchant.example/checkout',
            }),
          },
        ],
      ],
    });

    const { page } = (await runScan(TAB_ID, browser)).payload;

    expect(page.pageUrl).toBe('https://merchant.example/checkout');
    expect(page.isInsideIframe).toBe(false);
  });

  it('ranks frames with Adyen script hints and Adyen iframes above plain frames', async () => {
    const page = await scanFrames(
      makePageExtract({ pageUrl: 'https://merchant.example/' }),
      makePageExtract({
        scripts: [{ src: 'https://merchant.example/adyen-bundle.js' }],
        iframes: [{ name: 'adyen-card' }],
        pageUrl: 'https://merchant.example/pay',
      })
    );

    expect(page.pageUrl).toBe('https://merchant.example/pay');
  });

  it('uses the top frame when frames have equal signal strength', async () => {
    const browser = createFakeScanBrowser({
      extractions: [
        [
          { frameId: 2, result: makePageExtract({ pageUrl: 'https://child.example/' }) },
          { frameId: 0, result: makePageExtract({ pageUrl: 'https://merchant.example/' }) },
        ],
      ],
    });

    const { page } = (await runScan(TAB_ID, browser)).payload;

    expect(page.pageUrl).toBe('https://merchant.example/');
    expect(page.isInsideIframe).toBe(false);
  });

  it('reports an embedded checkout even when the top frame scores higher', async () => {
    const page = await scanFrames(
      makePageExtract({ checkoutConfig: makeCheckoutConfig() }),
      makePageExtract({ hasDropinDOM: true, pageUrl: 'https://merchant.example/embedded' })
    );

    expect(page.pageUrl).toBe('https://example.com/checkout');
    expect(page.isInsideIframe).toBe(true);
  });

  it('does not confuse hosted card fields with a merchant checkout iframe', async () => {
    const page = await scanFrames(
      makePageExtract({ checkoutConfig: makeCheckoutConfig() }),
      makePageExtract({
        hasCardDOM: true,
        pageUrl: 'https://checkoutshopper-test.adyenpayments.com/card.html',
      })
    );

    expect(page.isInsideIframe).toBe(false);
    expect(page.hasCardDOM).toBeUndefined();
    expect(page.hasNewCardFormDOM).toBeUndefined();
  });

  it('merges card form DOM flags from merchant frames', async () => {
    const page = await scanFrames(
      makePageExtract({ checkoutConfig: makeCheckoutConfig() }),
      makePageExtract({
        hasCardDOM: true,
        hasNewCardFormDOM: true,
        hasCardHolderNameDOM: true,
        apiKeyDetected: true,
        pageUrl: 'https://merchant.example/embedded-card',
      })
    );

    expect(page).toMatchObject({
      hasCardDOM: true,
      hasNewCardFormDOM: true,
      hasCardHolderNameDOM: true,
      apiKeyDetected: true,
    });
  });

  it('keeps absence provable when a child frame captured AdyenCheckout options directly', async () => {
    const page = await scanFrames(
      makePageExtract({ componentConfig: { locale: 'nl-NL' } }),
      makePageExtract({
        checkoutConfig: { clientKey: 'test_K' },
        checkoutConfigComplete: true,
        pageUrl: 'https://merchant.example/embedded',
      })
    );

    expect(page.checkoutConfigComplete).toBe(true);
    expect(page.checkoutConfig).toEqual({ clientKey: 'test_K' });
  });

  it('fails when no frame returned an extraction result', async () => {
    const browser = createFakeScanBrowser({ extractions: [framesOf(null)] });

    await expect(runScan(9, browser)).rejects.toThrow(
      'Page extraction returned no frame results for tab 9'
    );
    expect(browser.networkStops).toBeGreaterThan(0);
  });

  it('ignores frames that return null', async () => {
    const page = await scanFrames(null, makePageExtract({ checkoutConfig: makeCheckoutConfig() }));

    expect(page.isInsideIframe).toBe(true);
  });
});
