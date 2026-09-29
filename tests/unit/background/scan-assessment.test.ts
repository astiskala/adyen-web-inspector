import { describe, expect, it, vi } from 'vitest';
import { assessScan } from '../../../src/background/scan-assessment';
import { ALL_CHECKS } from '../../../src/background/checks/index';
import {
  makeAdyenMetadata,
  makeCheckoutConfig,
  makeCheckoutPage,
  makeRequest,
} from '../../fixtures/makeScanPayload';

function makeEvidence(
  overrides: Partial<Parameters<typeof assessScan>[0]> = {}
): Parameters<typeof assessScan>[0] {
  return {
    tabId: 7,
    page: makeCheckoutPage(),
    collected: { mainDocumentHeaders: [], capturedRequests: [], analyticsData: null },
    mainDocumentHeaders: [],
    latestVersion: '6.32.0',
    scannedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('assessScan', () => {
  it('resolves the SDK version with its source and npm release date', async () => {
    const fetchScriptText = vi.fn();
    const page = makeCheckoutPage({ adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }) });
    const releaseDates = { '6.30.0': '2026-01-10T00:00:00.000Z' };

    const result = await assessScan(makeEvidence({ page, releaseDates }), fetchScriptText);

    expect(result.payload.versionInfo).toEqual({
      detected: '6.30.0',
      source: 'metadata',
      latest: '6.32.0',
      detectedReleasedAt: '2026-01-10T00:00:00.000Z',
    });
    expect(fetchScriptText).not.toHaveBeenCalled();
  });

  it('reads request URLs merged from Resource Timing before fetching bundles', async () => {
    const fetchScriptText = vi.fn().mockResolvedValue('adyen-web 6.19.0');
    const page = makeCheckoutPage({
      scripts: [{ src: 'https://example.com/main.js' }],
      observedRequests: [
        { url: 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.21.0/adyen.css' },
      ],
    });

    const result = await assessScan(makeEvidence({ page }), fetchScriptText);

    expect(result.payload.versionInfo).toMatchObject({ detected: '6.21.0', source: 'request-url' });
    expect(fetchScriptText).not.toHaveBeenCalled();
  });

  it('fetches same-origin bundles only when stronger version signals are absent', async () => {
    const fetchScriptText = vi.fn().mockResolvedValue('/* @adyen/adyen-web 6.20.0 */');
    const page = makeCheckoutPage({ scripts: [{ src: 'https://example.com/main.js' }] });

    const result = await assessScan(makeEvidence({ page }), fetchScriptText);

    expect(fetchScriptText).toHaveBeenCalledWith('https://example.com/main.js');
    expect(result.payload.versionInfo).toMatchObject({ detected: '6.20.0', source: 'bundle' });
    expect(result.payload.mainDocumentHeadersAvailable).toBe(false);
    const noVersion = await assessScan(makeEvidence(), vi.fn().mockResolvedValue(null));
    expect(noVersion.payload.versionInfo).toEqual({ detected: null, latest: '6.32.0' });
  });

  it('keeps Resource Timing status codes for requests made before header capture started', async () => {
    const sessionsUrl =
      'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sessions/CS123/setup?clientKey=test_X';
    const page = makeCheckoutPage({
      observedRequests: [{ url: sessionsUrl, initiatorType: 'fetch', responseStatus: 401 }],
    });

    const result = await assessScan(makeEvidence({ page }), vi.fn().mockResolvedValue(null));

    expect(result.payload.capturedRequests).toContainEqual(
      expect.objectContaining({ url: sessionsUrl, type: 'other', statusCode: 401 })
    );
    expect(result.checks.find((check) => check.id === 'auth-client-key-rejected')).toMatchObject({
      severity: 'fail',
    });
  });

  it('drops URL-less requests, types non-stylesheet links and trusts main-frame status codes', async () => {
    const url = 'https://example.com/checkout';
    const result = await assessScan(
      makeEvidence({
        page: makeCheckoutPage({ links: [{ href: 'https://example.com/icon.png', rel: 'icon' }] }),
        collected: {
          mainDocumentHeaders: [],
          capturedRequests: [makeRequest(''), makeRequest(url, { type: 'main_frame' })],
          analyticsData: null,
        },
      }),
      vi.fn().mockResolvedValue(null)
    );

    expect(result.payload.capturedRequests.map((request) => request.url)).not.toContain('');
    expect(result.payload.capturedRequests).toContainEqual(
      expect.objectContaining({ url: 'https://example.com/icon.png', type: 'other' })
    );
    expect(result.payload.mainDocumentHeadersAvailable).toBe(true);
  });

  it('preserves captured requests, fills missing signals and evaluates the assembled payload', async () => {
    const url = 'https://example.com/checkout';
    const script = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.30.0/adyen.js';
    const primary = makeRequest(script, { statusCode: 200 });
    const locale = makeRequest('https://checkoutshopper-test.adyen.com/translations/fr-FR.json');
    const evidence = makeEvidence({
      page: makeCheckoutPage({
        adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }),
        checkoutConfig: makeCheckoutConfig({ locale: undefined, hasSession: true }),
        hasDropinDOM: true,
        scripts: [{ src: script }],
        links: [{ href: 'https://example.com/styles.css', rel: 'stylesheet' }],
        observedRequests: [{ url: 'https://example.com/other.js', initiatorType: 'script' }],
      }),
      mainDocumentHeaders: [{ name: 'content-security-policy', value: "default-src 'self'" }],
      collected: {
        mainDocumentHeaders: [],
        capturedRequests: [primary, locale, makeRequest(url, { type: 'main_frame' })],
        analyticsData: null,
      },
    });

    const result = await assessScan(evidence, vi.fn());

    expect(result).toMatchObject({ tabId: 7, pageUrl: url, scannedAt: evidence.scannedAt });
    expect(result.payload.capturedRequests.filter((r) => r.url === script)).toEqual([primary]);
    expect(result.payload.capturedRequests).toContainEqual(
      expect.objectContaining({
        url: 'https://example.com/styles.css',
        type: 'stylesheet',
        statusCode: 0,
      })
    );
    expect(result.payload.capturedRequests).toContainEqual(
      expect.objectContaining({
        url: 'https://example.com/other.js',
        type: 'script',
        statusCode: 0,
      })
    );
    expect(result.payload.page.inferredConfig?.locale).toBe('fr-FR');
    expect(result.payload.mainDocumentHeaders).toBe(evidence.mainDocumentHeaders);
    expect(result.payload.mainDocumentHeadersAvailable).toBe(true);
    expect(result.checks).toHaveLength(ALL_CHECKS.length);
    expect(result.checks.find((check) => check.id === 'sdk-detected')?.severity).toBe('info');
    expect(result.sdkPresence).toEqual({ detected: true, source: 'metadata' });
    expect(result.health.total).toBeGreaterThan(0);
    expect(result.standardCompliance).toEqual({ compliant: true, reasons: [] });
  });
});
