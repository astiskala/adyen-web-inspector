import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPdfReportUrl,
  exportPdf,
  getPdfReportStorageKey,
  PDF_REPORT_TOKEN_PARAM,
} from '../../../src/shared/export-pdf';
import type { ScanResult } from '../../../src/shared/types';
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
    payload: makeScanPayload(),
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
