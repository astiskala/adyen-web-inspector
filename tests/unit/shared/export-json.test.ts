import { describe, expect, it } from 'vitest';
import { buildJsonExport } from '../../../src/shared/export-json';
import type { PrintableReportMetadata } from '../../../src/shared/export-pdf';
import type { CheckResult, ScanResult } from '../../../src/shared/types';
import { makeScanPayload } from '../../fixtures/makeScanPayload';

function makeResult(): ScanResult {
  return {
    tabId: 1,
    pageUrl: 'https://example.com/checkout',
    scannedAt: '2026-03-18T00:00:00.000Z',
    checks: [],
    health: {
      score: 92,
      passing: 11,
      failing: 1,
      warnings: 2,
      total: 14,
      tier: 'issues',
    },
    payload: makeScanPayload(),
  };
}

function makeCheck(overrides: Partial<CheckResult>): CheckResult {
  return {
    id: 'auth-client-key',
    category: 'auth',
    severity: 'warn',
    title: 'Client key could not be confirmed.',
    remediation: 'Verify the configured client key.',
    ...overrides,
  };
}

describe('buildJsonExport', () => {
  const metadata: PrintableReportMetadata = {
    extensionVersion: '1.2.3',
    browser: 'Google Chrome 135.0.0.0 on macOS',
  };

  it('includes the PDF report metadata in the JSON export', () => {
    const result = makeResult();

    const exported = buildJsonExport(result, metadata, '2026-03-18T01:23:45.000Z');

    expect(exported.exportedAt).toBe('2026-03-18T01:23:45.000Z');
    expect(exported.reportMetadata).toEqual({
      inspectedUrl: 'https://example.com/checkout',
      scannedAt: '2026-03-18T00:00:00.000Z',
      extensionVersion: '1.2.3',
      browser: 'Google Chrome 135.0.0.0 on macOS',
    });
    expect(exported.summary).toEqual({
      pageUrl: 'https://example.com/checkout',
      scannedAt: '2026-03-18T00:00:00.000Z',
      health: result.health,
    });
    expect(exported.scanResult).toBe(result);
  });

  it('mirrors the PDF report sections and filtering', () => {
    const result: ScanResult = {
      ...makeResult(),
      checks: [
        makeCheck({
          id: 'auth-country-code',
          category: 'auth',
          severity: 'fail',
          title: 'Country code missing.',
          remediation: 'Set countryCode in the checkout configuration.',
        }),
        makeCheck({
          id: 'callback-on-submit',
          category: 'callbacks',
          severity: 'pass',
          title: 'onSubmit callback detected.',
        }),
        makeCheck({
          id: 'security-https',
          category: 'security',
          severity: 'warn',
          title: 'HTTPS could not be confirmed.',
          remediation: 'Serve the checkout page over HTTPS.',
        }),
        makeCheck({
          id: 'security-sri-script',
          category: 'security',
          severity: 'pass',
          title: 'Adyen script tags use SRI.',
        }),
        makeCheck({
          id: '3p-no-sri',
          category: 'third-party',
          severity: 'skip',
          title: 'Third-party SRI review — No third-party scripts detected.',
          detail: 'No third-party scripts detected.',
        }),
      ],
      payload: {
        ...makeScanPayload(),
        capturedRequests: [
          {
            url: 'https://checkoutshopper-live-us.adyen.com/checkoutshopper/v71/paymentMethods',
            type: 'script',
            responseHeaders: [],
            statusCode: 200,
          },
          {
            url: 'https://example.com/collect',
            type: 'other',
            responseHeaders: [],
            statusCode: 204,
          },
          {
            url: 'https://checkoutshopper-live-us.adyen.com/checkoutshopper/v71/sessions',
            type: 'other',
            responseHeaders: [],
            statusCode: 200,
          },
        ],
      },
    };

    const exported = buildJsonExport(result, metadata);

    expect(exported.issues.map((issue) => issue.title)).toEqual([
      'Country code missing.',
      'HTTPS could not be confirmed.',
    ]);
    expect(exported.bestPractices.issues.map((issue) => issue.title)).toEqual([
      'Country code missing.',
    ]);
    expect(exported.bestPractices.successfulChecks.map((check) => check.title)).toEqual([
      'onSubmit callback detected.',
    ]);
    expect(exported.security.issues.map((issue) => issue.title)).toEqual([
      'HTTPS could not be confirmed.',
    ]);
    expect(exported.security.successfulChecks.map((check) => check.title)).toEqual([
      'Adyen script tags use SRI.',
    ]);
    expect(exported.skippedChecks).toEqual([
      {
        id: '3p-no-sri',
        category: 'third-party',
        title: 'Third-party SRI review',
        detail: 'No third-party scripts detected.',
        reason: 'No third-party scripts detected.',
      },
    ]);
    expect(exported.network.capturedRequests.map((request) => request.url)).toEqual([
      'https://checkoutshopper-live-us.adyen.com/checkoutshopper/v71/paymentMethods',
      'https://checkoutshopper-live-us.adyen.com/checkoutshopper/v71/sessions',
    ]);
    expect(exported.rawConfig).toEqual({
      checkoutConfig: result.payload.page.checkoutConfig,
      componentConfig: result.payload.page.componentConfig,
      inferredCheckoutConfig: result.payload.page.inferredConfig,
      sdkMetadata: result.payload.page.adyenMetadata,
    });
    expect(exported.implementationAttributes.sdkVersion).toBe(
      result.payload.versionInfo.detected ?? 'Unknown'
    );
  });
});
