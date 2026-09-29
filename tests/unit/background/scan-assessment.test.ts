import { describe, expect, it, vi } from 'vitest';
import { assessScan } from '../../../src/background/scan-assessment';
import { ALL_CHECKS } from '../../../src/background/checks/index';
import {
  makeAdyenMetadata,
  makeCapturedConfig,
  makeCheckoutConfig,
  makeCheckoutPage,
  makeDocumentHeaders,
  makeHeader,
  makeRequest,
  UNAVAILABLE_DOCUMENT_HEADERS,
} from '../../fixtures/makeScanPayload';

type Evidence = Parameters<typeof assessScan>[0];

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    tabId: 7,
    page: makeCheckoutPage(),
    traffic: {
      documentHeaders: UNAVAILABLE_DOCUMENT_HEADERS,
      capturedRequests: [],
      analyticsData: null,
    },
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

  it('reads captured request URLs before fetching bundles', async () => {
    const fetchScriptText = vi.fn().mockResolvedValue('adyen-web 6.19.0');
    const page = makeCheckoutPage({ scripts: [{ src: 'https://example.com/main.js' }] });
    const cdn = makeRequest(
      'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.21.0/adyen.css'
    );

    const result = await assessScan(
      makeEvidence({
        page,
        traffic: { ...makeEvidence().traffic, capturedRequests: [cdn] },
      }),
      fetchScriptText
    );

    expect(result.payload.versionInfo).toMatchObject({ detected: '6.21.0', source: 'request-url' });
    expect(fetchScriptText).not.toHaveBeenCalled();
  });

  it('fetches same-origin bundles only when stronger version signals are absent', async () => {
    const fetchScriptText = vi.fn().mockResolvedValue('/* @adyen/adyen-web 6.20.0 */');
    const page = makeCheckoutPage({ scripts: [{ src: 'https://example.com/main.js' }] });

    const result = await assessScan(makeEvidence({ page }), fetchScriptText);

    expect(fetchScriptText).toHaveBeenCalledWith('https://example.com/main.js');
    expect(result.payload.versionInfo).toMatchObject({ detected: '6.20.0', source: 'bundle' });
    const noVersion = await assessScan(makeEvidence(), vi.fn().mockResolvedValue(null));
    expect(noVersion.payload.versionInfo).toEqual({ detected: null, latest: '6.32.0' });
  });

  it('evaluates the assembled payload', async () => {
    const url = 'https://example.com/checkout';
    const script = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.30.0/adyen.js';
    const locale = makeRequest('https://checkoutshopper-test.adyen.com/translations/fr-FR.json');
    const documentHeaders = makeDocumentHeaders([
      makeHeader('content-security-policy', "default-src 'self'"),
    ]);
    const evidence = makeEvidence({
      page: makeCheckoutPage({
        adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }),
        capturedConfig: makeCapturedConfig(
          makeCheckoutConfig({ locale: undefined, hasSession: true })
        ),
        hasDropinDOM: true,
        scripts: [{ src: script }],
      }),
      traffic: {
        documentHeaders,
        capturedRequests: [makeRequest(script), locale],
        analyticsData: null,
      },
    });

    const result = await assessScan(evidence, vi.fn());

    expect(result).toMatchObject({ tabId: 7, pageUrl: url, scannedAt: evidence.scannedAt });
    expect(result.payload.capturedRequests).toBe(evidence.traffic.capturedRequests);
    expect(result.payload.documentHeaders).toBe(documentHeaders);
    expect(result.payload.page.inferredConfig?.locale).toBe('fr-FR');
    expect(result.checks).toHaveLength(ALL_CHECKS.length);
    expect(result.checks.find((check) => check.id === 'security-csp-present')?.severity).toBe(
      'pass'
    );
    expect(result.checks.find((check) => check.id === 'sdk-detected')?.severity).toBe('info');
    expect(result.sdkPresence).toEqual({ detected: true, source: 'metadata' });
    expect(result.health.total).toBeGreaterThan(0);
    expect(result.standardCompliance).toEqual({ compliant: true, reasons: [] });
  });
});
