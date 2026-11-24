import { h, render } from 'preact';
import { chromeReportBrowser } from '../popup/components/chrome-report-browser.js';
import { takePdfReport } from '../shared/report-export.js';
import { Report } from './Report.js';

function showError(message: string): void {
  document.title = 'Adyen Web Inspector - PDF Export Failed';
  document.body.replaceChildren();

  const container = document.createElement('main');
  container.style.cssText =
    'font-family:system-ui,sans-serif;padding:24px;color:#111827;max-width:720px;';

  const heading = document.createElement('h1');
  heading.textContent = 'Unable to prepare PDF export';
  heading.style.cssText = 'font-size:20px;margin:0 0 8px;';

  const detail = document.createElement('p');
  detail.textContent = message;
  detail.style.cssText = 'font-size:14px;line-height:1.5;margin:0;';

  container.append(heading, detail);
  document.body.append(container);
}

function renderReport(report: Parameters<typeof Report>[0]): void {
  document.body.replaceChildren();
  render(h(Report, report), document.body);
  document.title = `Adyen Web Inspector — ${report.result.pageUrl}`;
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
  const report = await takePdfReport(globalThis.location.href, chromeReportBrowser);
  if ('error' in report) {
    showError(report.error);
  } else {
    renderReport(report);
    triggerPrint();
  }
} catch {
  showError('An unexpected error occurred while building the export report.');
}
