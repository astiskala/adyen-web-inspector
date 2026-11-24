import { h, render } from 'preact';
import { describe, expect, it } from 'vitest';
import { Report } from '../../../src/report/Report';
import type { ReportMetadata } from '../../../src/shared/export-metadata';
import type { CheckResult, ScanResult } from '../../../src/shared/types';
import {
  makeCheckoutPage,
  makeScanPayload,
  makeScanResult,
  makeCapturedConfig,
  makeAdyenPayload,
  makeVersionInfo,
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

const METADATA: ReportMetadata = {
  extensionVersion: '1.2.3',
  browser: 'Google Chrome 135.0.0.0 on macOS',
};

function renderReport(result: ScanResult): HTMLElement {
  const host = document.createElement('div');
  render(h(Report, { result, metadata: METADATA }), host);
  return host;
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

describe('Report', () => {
  it('escapes page-controlled values, including a forged request status', () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const page = makeCheckoutPage({
      observedConfig: { captured: makeCapturedConfig({ locale: hostile }) },
    });
    const result = makeResult({
      pageUrl: `https://example.com/${hostile}`,
      checks: [makeCheck({ title: hostile, detail: hostile, remediation: hostile })],
      payload: makeScanPayload({
        capturedRequests: [
          {
            url: `https://checkoutshopper-test.adyen.com/${hostile}`,
            type: 'script',
            responseHeaders: [],
            // A tampered page extraction can carry any JSON value here.
            statusCode: hostile as unknown as number,
          },
        ],
        page,
      }),
    });

    const host = renderReport(result);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain(hostile);
  });

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
          title: 'Third-party SRI review',
          detail: 'No third-party scripts detected.',
        }),
      ],
    });

    const host = renderReport(result);

    const headings = [...host.querySelectorAll('h2')].map((heading) => heading.textContent.trim());
    expect(headings).toEqual([
      'Implementation Attributes',
      'Best Practices',
      'Security',
      'Successful Checks',
      'Skipped Checks',
      'Network',
      'Extracted Config',
    ]);

    expect(host.textContent).toContain('onSubmit callback detected.');
    expect(host.textContent).toContain('Adyen script tags use SRI.');
    expect(host.textContent).toContain('Client key format could not be verified.');
    expect(host.textContent).toContain('Checkout page is not served over HTTPS.');
  });

  it('renders unmet criteria, captured traffic, extracted config and empty sections', () => {
    const capturedConfig = makeCapturedConfig({ clientKey: 'live_CLIENTKEY', environment: 'live' });
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
          observedConfig: {
            captured: capturedConfig,
            component: { countryCode: 'NL' },
          },
        }),
      }),
    });

    const host = renderReport(result);
    const text = host.textContent;

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
    expect([...host.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      'https://docs.adyen.com/standard',
      'https://docs.adyen.com/online-payments/web-best-practices/',
    ]);
  });

  it('includes inspected URL, extension version, and browser details', () => {
    const host = renderReport(makeResult());
    const bodyText = host.textContent;
    const [metadataTable] = host.querySelectorAll('table');

    expect(bodyText).toContain('Inspected URL');
    expect(bodyText).toContain('https://example.com/checkout');
    expect(bodyText).toContain('Extension Version');
    expect(bodyText).toContain('1.2.3');
    expect(bodyText).toContain('Browser');
    expect(bodyText).toContain('Google Chrome 135.0.0.0 on macOS');
    expect(bodyText).toContain('Generated by Adyen Web Inspector v1.2.3');
    expect(metadataTable?.textContent).toContain('Inspected URL');
  });
});

describe('Report attributes', () => {
  it('colours the score by tier and leaves out what a test integration does not have', () => {
    const versionInfo = makeVersionInfo({ detected: null });
    const host = renderReport(
      makeResult({
        health: { score: 50, passing: 1, failing: 0, warnings: 1, total: 2, tier: 'issues' },
        payload: makeAdyenPayload({}, { environment: 'test' }, { versionInfo }),
      })
    );
    const labelled = new Map(
      [...host.querySelectorAll('tr')].map((row) => [
        row.cells[0]?.textContent,
        row.cells[1]?.textContent,
      ])
    );

    expect(host.querySelector('[style]')?.getAttribute('style')).toContain('rgb(176, 96, 0)');
    expect(labelled.get('SDK Version')).toBe('Unknown');
    expect(labelled.has('Region')).toBe(false);
  });
});

describe('Report skipped checks', () => {
  it('shows a dash for a skipped check without a recorded reason', () => {
    const cells = renderReport(
      makeResult({
        checks: [
          { id: '3p-no-sri', category: 'third-party', severity: 'skip', title: 'SRI skipped' },
        ],
      })
    ).querySelectorAll('td');

    expect([...cells].map((cell) => cell.textContent)).toEqual(
      expect.arrayContaining(['SRI skipped', '—'])
    );
  });
});
