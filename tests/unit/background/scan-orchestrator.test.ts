import { describe, expect, it } from 'vitest';
import type { ObservedResponse } from '../../../src/background/scan-browser';
import { runScan } from '../../../src/background/scan-orchestrator';
import {
  makeAdyenMetadata,
  makeCheckoutConfig,
  makeHeader,
  makePageExtract,
  makeCapturedConfig,
} from '../../fixtures/makeScanPayload';
import { createFakeScanBrowser, framesOf } from '../../fixtures/fakeScanBrowser';

const TAB_ID = 1;

describe('runScan sequencing', () => {
  it('captures network first, waits for the tab and settles before extracting', async () => {
    const browser = createFakeScanBrowser({
      extractions: [
        framesOf(makePageExtract({ capturedConfig: makeCapturedConfig(makeCheckoutConfig()) })),
      ],
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
      capturedConfig: makeCapturedConfig(makeCheckoutConfig()),
    });
    const browser = createFakeScanBrowser({
      extractions: [framesOf(loading), framesOf(loading), framesOf(ready)],
    });

    const result = await runScan(TAB_ID, browser);

    expect(browser.calls.filter((call) => call === 'extractFrames')).toHaveLength(3);
    expect(browser.sleeps).toEqual([2000, 500, 500]);
    expect(result.payload.page.capturedConfig).not.toBeNull();
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
          makePageExtract({
            capturedConfig: makeCapturedConfig(makeCheckoutConfig()),
            scripts: [{ src: bundle }],
          })
        ),
      ],
      scriptTexts: { [bundle]: '/* @adyen/adyen-web 6.20.0 */' },
    });

    const result = await runScan(TAB_ID, browser);

    expect(browser.calls).toContain(`fetchScriptText:${bundle}`);
    expect(result.payload.versionInfo).toMatchObject({ detected: '6.20.0', source: 'bundle' });
  });
});

function response(
  url: string,
  type = 'xmlhttprequest',
  overrides: Partial<ObservedResponse> = {}
): ObservedResponse {
  return { url, type, statusCode: 200, headers: [], ...overrides };
}

describe('runScan document headers', () => {
  const captured = [makeHeader('content-security-policy', "default-src 'self'")];
  const probed = [makeHeader('x-content-type-options', 'nosniff')];
  const topDocument = response('https://merchant.example/', 'main_frame', { headers: captured });
  const embedded = framesOf(
    makePageExtract({ pageUrl: 'https://merchant.example/' }),
    makePageExtract({
      capturedConfig: makeCapturedConfig(makeCheckoutConfig()),
      pageUrl: 'https://merchant.example/embedded',
    })
  );

  it('uses the headers of the tab response when checkout runs in the top document', async () => {
    const browser = createFakeScanBrowser({
      extractions: [
        framesOf(makePageExtract({ capturedConfig: makeCapturedConfig(makeCheckoutConfig()) })),
      ],
      network: { responses: [topDocument] },
      documentHeaders: probed,
    });

    const result = await runScan(TAB_ID, browser);

    expect(result.payload.documentHeaders).toEqual({
      status: 'observed',
      url: 'https://merchant.example/',
      source: 'captured',
      headers: captured,
    });
    expect(browser.calls.some((call) => call.startsWith('fetchDocumentHeaders'))).toBe(false);
  });

  it('fetches the checkout document when checkout is embedded in an iframe', async () => {
    const browser = createFakeScanBrowser({
      extractions: [embedded],
      network: { responses: [topDocument] },
      documentHeaders: probed,
    });

    const result = await runScan(TAB_ID, browser);

    expect(browser.calls).toContain('fetchDocumentHeaders:https://merchant.example/embedded');
    expect(result.payload.documentHeaders).toEqual({
      status: 'observed',
      url: 'https://merchant.example/embedded',
      source: 'fetched',
      headers: probed,
    });
  });

  it('reports embedded checkout headers as unavailable when the fetch fails, even if the top document loaded', async () => {
    const browser = createFakeScanBrowser({
      extractions: [embedded],
      network: { responses: [topDocument] },
    });

    const result = await runScan(TAB_ID, browser);

    expect(result.payload.documentHeaders).toEqual({ status: 'unavailable' });
    const csp = result.checks.find((check) => check.id === 'security-csp-present');
    expect(csp?.severity).toBe('skip');
  });

  it('fetches the document when no main-frame headers were captured', async () => {
    const browser = createFakeScanBrowser({
      extractions: [framesOf(makePageExtract())],
      network: { responses: [response('https://example.com/checkout', 'main_frame')] },
      documentHeaders: probed,
    });

    const result = await runScan(TAB_ID, browser);

    expect(result.payload.documentHeaders).toMatchObject({ source: 'fetched', headers: probed });
  });
});

describe('runScan captured traffic', () => {
  it('keeps main-document and Adyen responses, filling in what the page reports itself', async () => {
    const sdk = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.30.0/adyen.js';
    const sessions =
      'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sessions/CS1/setup?clientKey=test_X';
    const browser = createFakeScanBrowser({
      extractions: [
        framesOf(
          makePageExtract({
            scripts: [{ src: sdk }, { src: '' }],
            links: [
              { href: 'https://example.com/styles.css', rel: 'stylesheet' },
              { href: 'https://example.com/icon.png', rel: 'icon' },
            ],
            observedRequests: [
              { url: sessions, initiatorType: 'fetch', responseStatus: 401 },
              { url: 'https://example.com/other.js', initiatorType: 'script' },
            ],
          })
        ),
      ],
      network: {
        responses: [
          response('https://example.com/checkout', 'main_frame'),
          response(sdk, 'script', { statusCode: 200 }),
          response('https://checkoutshopper-test.cdn.adyen.com/x.css', 'stylesheet'),
          response('https://checkoutshopper-test.cdn.adyen.com/logo.svg', 'image'),
          response('https://fonts.example/font.woff2', 'font'),
        ],
      },
    });

    const { payload, checks } = await runScan(TAB_ID, browser);
    const byUrl = (url: string): unknown =>
      payload.capturedRequests.filter((request) => request.url === url);

    expect(byUrl(sdk)).toEqual([
      { url: sdk, type: 'script', responseHeaders: [], statusCode: 200 },
    ]);
    expect(byUrl('https://checkoutshopper-test.cdn.adyen.com/x.css')).toMatchObject([
      { type: 'stylesheet' },
    ]);
    expect(byUrl('https://checkoutshopper-test.cdn.adyen.com/logo.svg')).toMatchObject([
      { type: 'other' },
    ]);
    expect(byUrl('https://example.com/checkout')).toMatchObject([
      { type: 'main_frame', statusCode: 200 },
    ]);
    expect(byUrl('https://fonts.example/font.woff2')).toEqual([]);
    expect(byUrl('')).toEqual([]);
    expect(byUrl('https://example.com/styles.css')).toMatchObject([{ type: 'stylesheet' }]);
    expect(byUrl('https://example.com/icon.png')).toMatchObject([{ type: 'other' }]);
    expect(byUrl('https://example.com/other.js')).toMatchObject([
      { type: 'script', statusCode: 0 },
    ]);
    expect(byUrl(sessions)).toMatchObject([{ type: 'other', statusCode: 401 }]);
    expect(checks.find((check) => check.id === 'auth-client-key-rejected')?.severity).toBe('fail');
  });

  it('reads SDK fields from Adyen analytics bodies, so an analytics session means Sessions flow', async () => {
    const analytics = 'https://checkoutanalytics-test.adyen.com/checkoutanalytics/v3/analytics';
    const browser = createFakeScanBrowser({
      extractions: [framesOf(makePageExtract())],
      network: {
        posts: [
          { url: analytics, body: JSON.stringify({ flavor: 'dropin', version: '6.30.0' }) },
          { url: analytics, body: JSON.stringify({ sessionId: 'S1', flavor: '', extra: 'x' }) },
          { url: analytics, body: '{not json' },
          { url: analytics, body: '"dropin"' },
          { url: 'https://merchant.example/log', body: JSON.stringify({ flavor: 'custom' }) },
        ],
      },
    });

    const { payload, attributes } = await runScan(TAB_ID, browser);

    expect(payload.analyticsData).toEqual({ flavor: 'dropin', version: '6.30.0', sessionId: 'S1' });
    expect(attributes.flow).toMatchObject({
      value: 'sessions',
      signals: { hasAnalyticsSessionId: true },
    });
    expect(attributes.flavor).toEqual({ value: 'Drop-in', source: 'analytics' });
  });

  it('reports no analytics data when no analytics body carried SDK fields', async () => {
    const browser = createFakeScanBrowser({ extractions: [framesOf(makePageExtract())] });

    const { payload } = await runScan(TAB_ID, browser);

    expect(payload.analyticsData).toBeNull();
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
            capturedConfig: makeCapturedConfig(makeCheckoutConfig()),
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
