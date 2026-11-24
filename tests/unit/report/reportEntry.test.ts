import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeReportBrowser } from '../../../src/popup/components/chrome-report-browser';
import { openReport as sendReport } from '../../../src/shared/report-export';
import type { ScanResult } from '../../../src/shared/types';
import { makeScanResult } from '../../fixtures/makeScanPayload';

const harness = {} as {
  storage: Map<string, unknown>;
  create: ReturnType<typeof vi.fn<(options: { url: string }) => Promise<unknown>>>;
  print: ReturnType<typeof vi.fn>;
};

/**
Opens the report page at a URL and waits for it to finish loading.
*/
async function openReport(url: string): Promise<void> {
  history.replaceState(null, '', new URL(url).pathname + new URL(url).search);
  vi.resetModules();
  await import('../../../src/report/reportEntry');
}

/**
Hands a result over from a view, as the popup and panel do, and returns the report page URL.
*/
async function handOver(
  result: ScanResult | object,
  mode: 'view' | 'print' = 'view'
): Promise<string> {
  await sendReport(result as ScanResult, chromeReportBrowser, mode);
  return harness.create.mock.lastCall?.[0].url ?? '';
}

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  harness.storage = new Map();
  harness.create = vi.fn(async () => ({ id: 2 }));
  harness.print = vi.fn();
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) harness.storage.set(key, value);
        },
        get: async (key: string) => ({ [key]: harness.storage.get(key) }),
        remove: async (key: string) => harness.storage.delete(key),
      },
    },
    tabs: { create: harness.create },
    runtime: {
      getURL: (path: string) => `chrome-extension://inspector/${path}`,
      getManifest: () => ({ version: '1.4.0' }),
    },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('print', harness.print);
  vi.stubGlobal('focus', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('report page', () => {
  it.each(['view', 'print'] as const)(
    'renders the handed-over scan in %s mode and can print it',
    async (mode) => {
      await openReport(
        await handOver(makeScanResult({ pageUrl: 'https://merchant.example/checkout' }), mode)
      );

      expect(harness.storage.size).toBe(0);
      expect(document.title).toBe('Adyen Web Inspector — https://merchant.example/checkout');
      expect(document.body.textContent).toContain('https://merchant.example/checkout');
      expect(harness.print).toHaveBeenCalledTimes(mode === 'print' ? 1 : 0);
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'Export PDF')
        ?.click();
      expect(harness.print).toHaveBeenCalledTimes(mode === 'print' ? 2 : 1);
    }
  );

  it('explains a report page opened without a handoff', async () => {
    await openReport('chrome-extension://inspector/report/report.html');

    expect(document.title).toBe('Adyen Web Inspector - Report unavailable');
    expect(document.body.textContent).toContain('missing its report token');
    expect(harness.print).not.toHaveBeenCalled();
  });

  it('downloads a JSON report from the opened report tab', async () => {
    const url = await handOver(makeScanResult());
    const createObjectURL = vi.fn(() => 'blob:report');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override readonly createObjectURL = createObjectURL;
        static override readonly revokeObjectURL = vi.fn();
      }
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await openReport(url);

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'Export JSON')
        ?.click();
      vi.runAllTimers();

      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalledOnce();
    } finally {
      click.mockRestore();
      vi.useRealTimers();
    }
  });

  it('explains a handed-over result the report cannot be built from', async () => {
    const url = await handOver({
      pageUrl: 'https://merchant.example/',
      scannedAt: '2026-09-29T00:00:00.000Z',
      sdkPresence: {},
      attributes: {},
      checks: [],
      health: {},
      payload: {},
    });

    await openReport(url);

    expect(document.body.textContent).toContain('An unexpected error occurred');
    expect(harness.print).not.toHaveBeenCalled();
  });
});
