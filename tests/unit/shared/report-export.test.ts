import { describe, expect, it } from 'vitest';
import { exportJson, exportPdf, takePdfReport } from '../../../src/shared/report-export';
import { createFakeReportBrowser } from '../../fixtures/fakeReportBrowser';
import { makeScanResult } from '../../fixtures/makeScanPayload';

const REPORT_PAGE = 'chrome-extension://inspector/report/report.html';

describe('PDF report handoff', () => {
  it('hands the result to the report page, which takes it exactly once', async () => {
    const browser = createFakeReportBrowser();
    const result = makeScanResult({ pageUrl: 'https://merchant.example/checkout' });

    await exportPdf(result, browser);
    const [url = ''] = browser.opened;
    const report = await takePdfReport(url, browser);

    expect(url.startsWith(`${REPORT_PAGE}?`)).toBe(true);
    expect(report).toMatchObject({
      result: { pageUrl: 'https://merchant.example/checkout' },
      metadata: { extensionVersion: '1.4.0' },
    });
    expect(browser.storage.size).toBe(0);
    await expect(takePdfReport(url, browser)).resolves.toEqual({
      error: 'The export data was unavailable. Please rerun the scan and try again.',
    });
  });

  it('removes the handoff again when the report tab cannot be opened', async () => {
    const browser = createFakeReportBrowser();
    browser.failing.add('open');

    await expect(exportPdf(makeScanResult(), browser)).rejects.toThrow('tab creation failed');
    expect(browser.storage.size).toBe(0);
  });

  it('reports the tab failure even when the handoff cannot be removed', async () => {
    const browser = createFakeReportBrowser();
    browser.failing.add('open').add('remove');

    await expect(exportPdf(makeScanResult(), browser)).rejects.toThrow('tab creation failed');
  });

  it('builds the report when the taken result cannot be removed', async () => {
    const browser = createFakeReportBrowser();
    await exportPdf(makeScanResult(), browser);
    browser.failing.add('remove');

    await expect(takePdfReport(browser.opened[0] ?? '', browser)).resolves.toHaveProperty('result');
  });

  it.each([REPORT_PAGE, `${REPORT_PAGE}?token=`])(
    'explains a report page opened without a token: %s',
    async (url) => {
      await expect(takePdfReport(url, createFakeReportBrowser())).resolves.toEqual({
        error: 'The PDF export request was missing its report token. Please try again.',
      });
    }
  );

  it.each([
    ['missing', undefined],
    ['not a scan result', { pageUrl: 42 }],
  ])('explains handed-over data that is %s', async (_label, value) => {
    const browser = createFakeReportBrowser();
    await exportPdf(makeScanResult(), browser);
    browser.storage.set(browser.storage.keys().toArray()[0] ?? '', value);

    await expect(takePdfReport(browser.opened[0] ?? '', browser)).resolves.toHaveProperty(
      'error',
      'The export data was unavailable. Please rerun the scan and try again.'
    );
  });

  it('explains handed-over data that storage could not read', async () => {
    const browser = createFakeReportBrowser();
    await exportPdf(makeScanResult(), browser);
    browser.failing.add('read');

    await expect(takePdfReport(browser.opened[0] ?? '', browser)).resolves.toHaveProperty('error');
  });
});

describe('exportJson', () => {
  it('downloads the JSON report, named and stamped with the export time', () => {
    const browser = createFakeReportBrowser();
    const result = makeScanResult();

    exportJson(result, browser);

    const [download] = browser.downloads;
    expect(download?.filename).toBe(`adyen-inspector-${browser.now()}.json`);
    expect(download?.type).toBe('application/json');
    expect(JSON.parse(download?.text ?? '')).toMatchObject({
      exportedAt: '2026-03-18T01:23:45.000Z',
      reportMetadata: { inspectedUrl: result.pageUrl, extensionVersion: '1.4.0' },
    });
  });
});
