import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeReportBrowser } from '../../../src/popup/components/chrome-report-browser';
import { exportPdf } from '../../../src/shared/report-export';
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
Hands a result over from a view, as the Export PDF button does, and returns the report page URL.
*/
async function handOver(result: ScanResult | object): Promise<string> {
  await exportPdf(result as ScanResult, chromeReportBrowser);
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
  it('renders the handed-over scan result and prints it', async () => {
    await openReport(
      await handOver(makeScanResult({ pageUrl: 'https://merchant.example/checkout' }))
    );

    expect(harness.storage.size).toBe(0);
    expect(document.documentElement.lang).toBe('en');
    expect(document.body.textContent).toContain('https://merchant.example/checkout');
    expect(harness.print).toHaveBeenCalledTimes(1);
  });

  it('explains a report page opened without a handoff', async () => {
    await openReport('chrome-extension://inspector/report/report.html');

    expect(document.title).toBe('Adyen Web Inspector - PDF Export Failed');
    expect(document.body.textContent).toContain('missing its report token');
    expect(harness.print).not.toHaveBeenCalled();
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
