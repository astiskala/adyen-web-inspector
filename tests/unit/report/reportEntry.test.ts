import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPdfReportStorageKey, PDF_REPORT_TOKEN_PARAM } from '../../../src/shared/export-pdf';
import { makeScanResult } from '../../fixtures/makeScanPayload';

const TOKEN = 'report-token';

let session: { get: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
let print: ReturnType<typeof vi.fn>;

/** Opens the report page for a token (or none) and waits for it to finish loading. */
async function openReport(token: string | null): Promise<void> {
  const query = token === null ? '' : `?${PDF_REPORT_TOKEN_PARAM}=${token}`;
  history.replaceState(null, '', `/report/report.html${query}`);
  vi.resetModules();
  await import('../../../src/report/reportEntry');
}

function storeResult(value: unknown): void {
  session.get.mockResolvedValue({ [getPdfReportStorageKey(TOKEN)]: value });
}

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  session = { get: vi.fn().mockResolvedValue({}), remove: vi.fn().mockResolvedValue(undefined) };
  print = vi.fn();
  vi.stubGlobal('chrome', {
    storage: { session },
    runtime: { getManifest: () => ({ version: '1.4.0' }) },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('print', print);
  vi.stubGlobal('focus', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('report page', () => {
  it('renders the stored scan result, removes it from storage, and prints', async () => {
    storeResult(makeScanResult({ pageUrl: 'https://merchant.example/checkout' }));

    await openReport(TOKEN);

    expect(session.remove).toHaveBeenCalledWith(getPdfReportStorageKey(TOKEN));
    expect(document.documentElement.lang).toBe('en');
    expect(document.body.textContent).toContain('https://merchant.example/checkout');
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('still renders when the stored result cannot be removed', async () => {
    storeResult(makeScanResult());
    session.remove.mockRejectedValue(new Error('storage gone'));

    await openReport(TOKEN);

    expect(print).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no token', null],
    ['an empty token', ''],
  ])('explains a request with %s', async (_label, token) => {
    await openReport(token);

    expect(document.title).toBe('Adyen Web Inspector - PDF Export Failed');
    expect(document.body.textContent).toContain('missing its report token');
    expect(print).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['not a scan result', { pageUrl: 42 }],
  ])('explains export data that is %s', async (_label, value) => {
    storeResult(value);

    await openReport(TOKEN);

    expect(document.body.textContent).toContain('The export data was unavailable.');
  });

  it('explains export data that storage could not read', async () => {
    session.get.mockRejectedValue(new Error('storage gone'));

    await openReport(TOKEN);

    expect(document.body.textContent).toContain('The export data was unavailable.');
  });

  it('explains a stored result the report cannot be built from', async () => {
    storeResult({
      pageUrl: 'https://merchant.example/',
      scannedAt: '2026-09-29T00:00:00.000Z',
      sdkPresence: {},
      attributes: {},
      checks: [],
      health: {},
      payload: {},
    });

    await openReport(TOKEN);

    expect(document.body.textContent).toContain('An unexpected error occurred');
    expect(print).not.toHaveBeenCalled();
  });
});
