import {
  getPdfReportStorageKey,
  PDF_REPORT_PAGE_PATH,
  PDF_REPORT_TOKEN_PARAM,
} from '../../shared/export-pdf.js';
import type { ScanResult } from '../../shared/types.js';

function buildPdfReportUrl(token: string): string {
  const url = new URL(chrome.runtime.getURL(PDF_REPORT_PAGE_PATH));
  url.searchParams.set(PDF_REPORT_TOKEN_PARAM, token);
  return url.toString();
}

/**
 * Stores the current scan result and opens a dedicated report page that can
 * render and print independently of the popup or DevTools lifecycle.
 */
export async function exportPdf(result: ScanResult): Promise<void> {
  const token = globalThis.crypto.randomUUID();
  const storageKey = getPdfReportStorageKey(token);
  await chrome.storage.session.set({ [storageKey]: result });

  try {
    await chrome.tabs.create({ url: buildPdfReportUrl(token) });
  } catch (error) {
    await chrome.storage.session.remove(storageKey).catch(() => {});
    throw error;
  }
}
