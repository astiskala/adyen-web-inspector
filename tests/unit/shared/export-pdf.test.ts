import { describe, expect, it } from 'vitest';
import { buildPrintableHtml } from '../../../src/shared/export-pdf';
import type { PrintableReportMetadata } from '../../../src/shared/export-pdf';
import type { CheckResult, ScanResult } from '../../../src/shared/types';
import {
  makeCheckoutPage,
  makeScanPayload,
  makeScanResult,
  makeCapturedConfig,
} from '../../fixtures/makeScanPayload';

function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return makeScanResult({
    scannedAt: '2026-03-18T00:00:00.000Z',
    health: {
      score: 100,
      passing: 1,
      failing: 0,
      warnings: 0,
      total: 1,
      tier: 'excellent',
    },
    standardCompliance: { compliant: true, reasons: [] },
    ...overrides,
  });
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

describe('buildPrintableHtml', () => {
  const metadata: PrintableReportMetadata = {
    extensionVersion: '1.2.3',
    browser: 'Google Chrome 135.0.0.0 on macOS',
  };

  it('renders issues and successful checks in separate sections', () => {
    const result = makeResult({
      pageUrl: 'https://example.com/checkout?cart=123',
      checks: [
        makeCheck({
          id: 'auth-client-key',
          category: 'auth',
          severity: 'warn',
          title: 'Client key format could not be verified.',
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
          severity: 'fail',
          title: 'Checkout page is not served over HTTPS.',
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
    });

    const html = buildPrintableHtml(result, metadata);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const headings = [...doc.querySelectorAll('h2')].map((heading) => heading.textContent.trim());
    expect(headings).toEqual([
      'Implementation Attributes',
      'Best Practices',
      'Security',
      'Successful Checks',
      'Skipped Checks',
      'Network',
      'Extracted Config',
    ]);

    const successfulChecksHeading = doc.querySelector('h2:nth-of-type(4)');
    expect(successfulChecksHeading?.textContent).toBe('Successful Checks');
    expect(doc.body.textContent).toContain('onSubmit callback detected.');
    expect(doc.body.textContent).toContain('Adyen script tags use SRI.');
    expect(doc.body.textContent).toContain('Client key format could not be verified.');
    expect(doc.body.textContent).toContain('Checkout page is not served over HTTPS.');
  });

  it('renders unmet criteria, captured traffic, extracted config and empty sections', () => {
    const result = makeResult({
      health: { score: 0, passing: 0, failing: 1, warnings: 0, total: 1, tier: 'critical' },
      standardCompliance: { compliant: false, reasons: ['Not using Drop-in.'] },
      checks: [
        makeCheck({
          id: 'security-https',
          category: 'security',
          severity: 'fail',
          title: 'Checkout page is not served over HTTPS.',
          detail: 'Page protocol is "http:".',
        }),
      ],
      payload: makeScanPayload({
        capturedRequests: [
          {
            url: 'https://checkoutshopper-live.adyen.com/checkoutshopper/v1/sessions',
            type: 'other',
            responseHeaders: [],
            statusCode: 0,
          },
        ],
        page: makeCheckoutPage({
          capturedConfig: makeCapturedConfig({ clientKey: 'live_CLIENTKEY', environment: 'live' }),
          componentConfig: { countryCode: 'NL' },
        }),
      }),
    });

    const doc = new DOMParser().parseFromString(buildPrintableHtml(result, metadata), 'text/html');
    const text = doc.body.textContent;

    expect(text).toContain('Standard Drop-in criteria not met');
    expect(text).toContain('Not using Drop-in.');
    expect(text).toContain('Page protocol is "http:".');
    expect(text).toContain('Region');
    expect(text).toContain('No best-practice issues identified.');
    expect(text).toContain('No successful security checks recorded.');
    expect(text).toContain('No checks were skipped.');
    expect(text).toContain('checkoutshopper-live.adyen.com/checkoutshopper/v1/sessions');
    expect(text).toContain('live_CLIENTKEY');
    expect(text).toContain('No inferred config captured.');
    expect(
      [...doc.querySelectorAll('.docs-link')].map((link) => link.getAttribute('href'))
    ).toEqual([
      'https://docs.adyen.com/standard',
      'https://docs.adyen.com/online-payments/web-best-practices/',
    ]);
  });

  it('includes inspected URL, extension version, and browser details', () => {
    const result = makeResult();
    const html = buildPrintableHtml(result, metadata);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bodyText = doc.body.textContent;
    const bodyChildren = [...doc.body.children];

    expect(bodyText).toContain('Inspected URL');
    expect(bodyText).toContain('https://example.com/checkout');
    expect(bodyText).toContain('Extension Version');
    expect(bodyText).toContain('1.2.3');
    expect(bodyText).toContain('Browser');
    expect(bodyText).toContain('Google Chrome 135.0.0.0 on macOS');
    expect(bodyText).toContain('Generated by Adyen Web Inspector v1.2.3');
    expect(bodyChildren[1]?.className).toBe('meta-table');
    expect(bodyChildren[2]?.className).toBe('score-block');
  });
});
