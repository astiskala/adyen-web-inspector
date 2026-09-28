import { describe, expect, it, vi } from 'vitest';
import { assessScan } from '../../../src/background/scan-assessment';
import { ALL_CHECKS } from '../../../src/background/checks/index';
import {
  makeAdyenMetadata,
  makeCheckoutConfig,
  makePageExtract,
  makeRequest,
} from '../../fixtures/makeScanPayload';

function makeEvidence(
  overrides: Partial<Parameters<typeof assessScan>[0]> = {}
): Parameters<typeof assessScan>[0] {
  return {
    tabId: 7,
    page: makePageExtract(),
    collected: { mainDocumentHeaders: [], capturedRequests: [], analyticsData: null },
    mainDocumentHeaders: [],
    latestVersion: '6.32.0',
    scannedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('assessScan', () => {
  it('uses metadata before analytics, URLs and the bundle probe', async () => {
    const probe = vi.fn().mockResolvedValue('6.31.0');
    const evidence = makeEvidence({
      page: makePageExtract({
        adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }),
        scripts: [{ src: 'https://merchant.example/main.js' }],
      }),
      collected: {
        mainDocumentHeaders: [],
        capturedRequests: [
          makeRequest('https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.29.0/adyen.js'),
        ],
        analyticsData: { version: '6.28.0' },
      },
    });

    const result = await assessScan(evidence, probe);

    expect(result.payload.versionInfo).toEqual({ detected: '6.30.0', latest: '6.32.0' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('attaches the npm release date of the detected version when known', async () => {
    const page = makePageExtract({ adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }) });
    const releaseDates = { '6.30.0': '2026-01-10T00:00:00.000Z' };

    const known = await assessScan(makeEvidence({ page, releaseDates }), vi.fn());
    const unknown = await assessScan(
      makeEvidence({ page, releaseDates: { '6.31.0': '2026-02-01T00:00:00.000Z' } }),
      vi.fn()
    );

    expect(known.payload.versionInfo).toEqual({
      detected: '6.30.0',
      latest: '6.32.0',
      detectedReleasedAt: '2026-01-10T00:00:00.000Z',
    });
    expect(unknown.payload.versionInfo).not.toHaveProperty('detectedReleasedAt');
  });

  it('uses analytics, script URLs then request URLs without probing bundles', async () => {
    const probe = vi.fn().mockResolvedValue(null);
    const script = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.22.0/adyen.js';
    const request = makeRequest(
      'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.21.0/adyen.css'
    );
    const evidence = makeEvidence({
      page: makePageExtract({ scripts: [{ src: script }] }),
      collected: {
        mainDocumentHeaders: [],
        capturedRequests: [request],
        analyticsData: { version: '6.23.0' },
      },
    });

    const withoutAnalytics = { ...evidence.collected, analyticsData: null };
    const fromScript = await assessScan({ ...evidence, collected: withoutAnalytics }, probe);
    const fromRequest = await assessScan(
      { ...evidence, page: makePageExtract(), collected: withoutAnalytics },
      probe
    );

    expect((await assessScan(evidence, probe)).payload.versionInfo.detected).toBe('6.23.0');
    expect(fromScript.payload.versionInfo.detected).toBe('6.22.0');
    expect(fromRequest.payload.versionInfo.detected).toBe('6.21.0');
    expect(probe).not.toHaveBeenCalled();
  });

  it('only probes bundles when stronger version signals are absent', async () => {
    const probe = vi.fn().mockResolvedValue('6.20.0');
    const result = await assessScan(makeEvidence(), probe);

    expect(probe).toHaveBeenCalledWith('https://example.com/checkout', []);
    expect(result.payload.versionInfo.detected).toBe('6.20.0');
    expect(result.payload.mainDocumentHeadersAvailable).toBe(false);
    const noVersion = await assessScan(makeEvidence(), vi.fn().mockResolvedValue(null));
    expect(noVersion.payload.versionInfo.detected).toBeNull();
  });

  it('keeps Resource Timing status codes for requests made before header capture started', async () => {
    const sessionsUrl =
      'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sessions/CS123/setup?clientKey=test_X';
    const page = makePageExtract({
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
        page: makePageExtract({ links: [{ href: 'https://example.com/icon.png', rel: 'icon' }] }),
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
      page: makePageExtract({
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
