import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPdf } from '../../../src/popup/components/pdf-export';
import { getPdfReportStorageKey, PDF_REPORT_TOKEN_PARAM } from '../../../src/shared/export-pdf';
import { makeScanResult } from '../../fixtures/makeScanPayload';

interface MockChrome {
  runtime: { getURL: ReturnType<typeof vi.fn> };
  storage: { session: { set: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } };
  tabs: { create: ReturnType<typeof vi.fn> };
}

const TOKEN = '00000000-0000-0000-0000-000000000000';

function stubChrome(): MockChrome {
  const mockChrome: MockChrome = {
    runtime: { getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`) },
    storage: {
      session: {
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabs: { create: vi.fn().mockResolvedValue({ id: 99 }) },
  };
  vi.stubGlobal('chrome', mockChrome);
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(TOKEN);
  return mockChrome;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PDF export handoff', () => {
  it('stores the result and opens the report page in a new tab', async () => {
    const chromeMock = stubChrome();
    const result = makeScanResult();

    await exportPdf(result);

    expect(chromeMock.storage.session.set).toHaveBeenCalledWith({
      [getPdfReportStorageKey(TOKEN)]: result,
    });
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({
      url: `chrome-extension://test-id/report/report.html?${PDF_REPORT_TOKEN_PARAM}=${TOKEN}`,
    });
  });

  it('cleans up stored state when the report tab cannot be opened', async () => {
    const chromeMock = stubChrome();
    chromeMock.tabs.create.mockRejectedValue(new Error('tab creation failed'));

    await expect(exportPdf(makeScanResult())).rejects.toThrow('tab creation failed');
    expect(chromeMock.storage.session.remove).toHaveBeenCalledWith(getPdfReportStorageKey(TOKEN));
  });
});

describe('PDF export cleanup failures', () => {
  it('reports the tab failure even when cleaning up the stored result fails', async () => {
    const chromeMock = stubChrome();
    chromeMock.tabs.create.mockRejectedValue(new Error('tab creation failed'));
    chromeMock.storage.session.remove.mockRejectedValue(new Error('storage gone'));

    await expect(exportPdf(makeScanResult())).rejects.toThrow('tab creation failed');
  });
});
