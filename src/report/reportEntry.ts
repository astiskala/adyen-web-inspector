import { chromeReportBrowser } from '../popup/components/chrome-report-browser.js';
import { takePdfReport } from '../shared/report-export.js';

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

function renderReportHtml(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.title = parsed.title;
  document.documentElement.lang = parsed.documentElement.lang;
  document.head.replaceChildren(...parsed.head.childNodes);
  document.body.replaceChildren(...parsed.body.childNodes);
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
    renderReportHtml(report.html);
    triggerPrint();
  }
} catch {
  showError('An unexpected error occurred while building the export report.');
}
