import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPrintableHtml,
  buildPdfReportUrl,
  exportPdf,
  getPdfReportStorageKey,
  PDF_REPORT_TOKEN_PARAM,
} from '../../../src/shared/export-pdf';
import type { PrintableReportMetadata } from '../../../src/shared/export-pdf';
import type { CheckResult, ScanResult } from '../../../src/shared/types';
import { makeScanPayload } from '../../fixtures/makeScanPayload';

interface MockChrome {
  runtime: {
    getURL: ReturnType<typeof vi.fn>;
  };
  storage: {
    session: {
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
  };
  tabs: {
    create: ReturnType<typeof vi.fn>;
  };
}

function makeResult(): ScanResult {
  return {
    tabId: 1,
    pageUrl: 'https://example.com/checkout',
    scannedAt: '2026-03-18T00:00:00.000Z',
    checks: [],
    health: {
      score: 100,
      passing: 1,
      failing: 0,
      warnings: 0,
      total: 1,
      tier: 'excellent',
    },
    standardCompliance: { compliant: true, reasons: [] },
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

function stubChrome(mockChrome: MockChrome): void {
  vi.stubGlobal('chrome', mockChrome);
}

function makeChromeMock(): MockChrome {
  return {
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    },
    storage: {
      session: {
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabs: {
      create: vi.fn().mockResolvedValue({ id: 99 }),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PDF export handoff', () => {
  const token = '00000000-0000-0000-0000-000000000000';

  it('builds the report URL with the expected token parameter', () => {
    const chromeMock = makeChromeMock();
    stubChrome(chromeMock);

    const url = new URL(buildPdfReportUrl(token));

    expect(url.protocol).toBe('chrome-extension:');
    expect(url.host).toBe('test-id');
    expect(url.pathname).toBe('/report/report.html');
    expect(url.searchParams.get(PDF_REPORT_TOKEN_PARAM)).toBe(token);
  });

  it('stores the result and opens the report page in a new tab', async () => {
    const chromeMock = makeChromeMock();
    stubChrome(chromeMock);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(token);

    const result = makeResult();
    await exportPdf(result);

    expect(chromeMock.storage.session.set).toHaveBeenCalledWith({
      [getPdfReportStorageKey(token)]: result,
    });
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({
      url: `chrome-extension://test-id/report/report.html?token=${token}`,
    });
  });

  it('cleans up stored state when the report tab cannot be opened', async () => {
    const chromeMock = makeChromeMock();
    chromeMock.tabs.create.mockRejectedValue(new Error('tab creation failed'));
    stubChrome(chromeMock);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(token);

    await expect(exportPdf(makeResult())).rejects.toThrow('tab creation failed');
    expect(chromeMock.storage.session.remove).toHaveBeenCalledWith(getPdfReportStorageKey(token));
  });
});

describe('buildPrintableHtml', () => {
  const metadata: PrintableReportMetadata = {
    extensionVersion: '1.2.3',
    browser: 'Google Chrome 135.0.0.0 on macOS',
  };

  it('renders issues and successful checks in separate sections', () => {
    const result: ScanResult = {
      ...makeResult(),
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
    };

    const html = buildPrintableHtml(result, metadata);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const headings = Array.from(doc.querySelectorAll('h2')).map((heading) =>
      heading.textContent.trim()
    );
    expect(headings).toEqual([
      'Implementation Attributes',
      'Best Practices',
      'Security',
      'Successful Checks',
      'Skipped Checks',
      'Network',
      'Raw Config',
    ]);

    const successfulChecksHeading = doc.querySelector('h2:nth-of-type(4)');
    expect(successfulChecksHeading?.textContent).toBe('Successful Checks');
    expect(doc.body.textContent).toContain('onSubmit callback detected.');
    expect(doc.body.textContent).toContain('Adyen script tags use SRI.');
    expect(doc.body.textContent).toContain('Client key format could not be verified.');
    expect(doc.body.textContent).toContain('Checkout page is not served over HTTPS.');
  });

  it('includes inspected URL, extension version, and browser details', () => {
    const result = makeResult();
    const html = buildPrintableHtml(result, metadata);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bodyText = doc.body.textContent;
    const bodyChildren = Array.from(doc.body.children);

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
