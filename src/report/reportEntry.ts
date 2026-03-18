import {
  buildPrintableHtml,
  getPdfReportStorageKey,
  PDF_REPORT_TOKEN_PARAM,
} from '~shared/export-pdf';
import { buildPrintableReportMetadata } from '~shared/export-metadata';
import type { ScanResult } from '~shared/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isScanResult(value: unknown): value is ScanResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['pageUrl'] === 'string' &&
    typeof value['scannedAt'] === 'string' &&
    Array.isArray(value['checks']) &&
    isRecord(value['health']) &&
    isRecord(value['payload'])
  );
}

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

async function loadStoredResult(token: string): Promise<ScanResult | null> {
  const storageKey = getPdfReportStorageKey(token);

  try {
    const stored = await chrome.storage.session.get(storageKey);
    const value = stored[storageKey];
    await chrome.storage.session.remove(storageKey).catch(() => {});
    return isScanResult(value) ? value : null;
  } catch {
    return null;
  }
}

function renderReportHtml(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.title = parsed.title;
  document.documentElement.lang = parsed.documentElement.lang || 'en';
  document.head.replaceChildren(...Array.from(parsed.head.childNodes));
  document.body.replaceChildren(...Array.from(parsed.body.childNodes));
}

function triggerPrint(): void {
  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(() => {
      globalThis.focus();
      globalThis.print();
    });
  });
}

const url = new URL(globalThis.location.href);
const token = url.searchParams.get(PDF_REPORT_TOKEN_PARAM);

if (token === null || token === '') {
  showError('The PDF export request was missing its report token. Please try again.');
} else {
  try {
    const result = await loadStoredResult(token);
    if (result === null) {
      showError('The export data was unavailable. Please rerun the scan and try again.');
    } else {
      renderReportHtml(buildPrintableHtml(result, buildPrintableReportMetadata()));
      triggerPrint();
    }
  } catch {
    showError('An unexpected error occurred while building the export report.');
  }
}
