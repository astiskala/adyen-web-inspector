import { h, render } from 'preact';
import '../shared/base.css';
import { chromeReportBrowser } from '../popup/components/chrome-report-browser.js';
import { exportJson, takeReport } from '../shared/report-export.js';
import { Report } from './Report.js';

function showError(message: string): void {
  document.title = 'Adyen Web Inspector - Report unavailable';
  document.body.replaceChildren();
  render(
    h(
      'main',
      { class: 'reportMessage' },
      h('h1', null, 'Unable to open the report'),
      h('p', { role: 'alert' }, message)
    ),
    document.body
  );
}

function triggerPrint(): void {
  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(() => {
      globalThis.focus();
      globalThis.print();
    });
  });
}

try {
  const report = await takeReport(globalThis.location.href, chromeReportBrowser);
  if ('error' in report) {
    showError(report.error);
  } else {
    const { result, metadata, printOnOpen } = report;
    document.body.replaceChildren();
    render(
      h(Report, {
        result,
        metadata,
        onExportJson: () => {
          exportJson(result, chromeReportBrowser);
        },
        onExportPdf: triggerPrint,
      }),
      document.body
    );
    document.title = `Adyen Web Inspector — ${result.pageUrl}`;
    if (printOnOpen) triggerPrint();
  }
} catch {
  showError('An unexpected error occurred while building the report.');
}
