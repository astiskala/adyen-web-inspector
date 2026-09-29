import { describe, expect, it } from 'vitest';
import { runScan } from '../../../src/background/scan-orchestrator';
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
    expect(browser.sleeps[0]).toBe(2000);
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
    expect(browser.sleeps).toEqual([2000, 500, 500]);
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
    expect(browser.sleeps).toEqual([2000]);
  });

  it('stops network capture when the tab never loads', async () => {
    const browser = createFakeScanBrowser({ tabLoadError: new Error('Tab 1 did not load') });

    await expect(runScan(TAB_ID, browser)).rejects.toThrow('Tab 1 did not load');
    expect(browser.networkStops).toBe(1);
  });

  it('reads the version from same-origin bundle text through the port', async () => {
    const bundle = 'https://example.com/main.js';
    const browser = createFakeScanBrowser({
      extractions: [
        framesOf(
          makePageExtract({ checkoutConfig: makeCheckoutConfig(), scripts: [{ src: bundle }] })
        ),
      ],
      scriptTexts: { [bundle]: '/* @adyen/adyen-web 6.20.0 */' },
    });

    const result = await runScan(TAB_ID, browser);

    expect(browser.calls).toContain(`fetchScriptText:${bundle}`);
    expect(result.payload.versionInfo).toMatchObject({ detected: '6.20.0', source: 'bundle' });
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

describe('runScan frames', () => {
  it('scans the Checkout page merged from every frame', async () => {
    const browser = createFakeScanBrowser({
      extractions: [
        framesOf(
          makePageExtract({
            adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }),
            pageUrl: 'https://merchant.example/',
          }),
          makePageExtract({
            checkoutConfig: makeCheckoutConfig(),
            pageUrl: 'https://merchant.example/embedded-checkout',
            isInsideIframe: true,
          })
        ),
      ],
    });

    const { payload } = await runScan(TAB_ID, browser);

    expect(payload.page.pageUrl).toBe('https://merchant.example/embedded-checkout');
    expect(payload.page.checkoutInIframe).toBe(true);
    expect(payload.versionInfo.detected).toBe('6.30.0');
  });

  it('fails when no frame returned an extraction result', async () => {
    const browser = createFakeScanBrowser({ extractions: [framesOf(null)] });

    await expect(runScan(9, browser)).rejects.toThrow(
      'Page extraction returned no frame results for tab 9'
    );
    expect(browser.networkStops).toBeGreaterThan(0);
  });
});
