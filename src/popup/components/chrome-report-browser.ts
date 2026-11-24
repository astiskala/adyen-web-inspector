/**
Chrome adapter for report export: session storage for the PDF handoff, a
new tab for the report page, and an anchor download for JSON.
*/

import type { ReportBrowser } from '../../shared/report-export.js';

const DOWNLOAD_URL_LIFETIME_MS = 10_000;

export const chromeReportBrowser: ReportBrowser = {
  write: (items) => chrome.storage.session.set({ ...items }),
  read: async (key) => {
    const stored = await chrome.storage.session.get(key);
    return stored[key];
  },
  remove: (key) => chrome.storage.session.remove(key),
  async openExtensionPage(path, parameters) {
    const url = new URL(chrome.runtime.getURL(path));
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    await chrome.tabs.create({ url: url.href });
  },
  download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    globalThis.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, DOWNLOAD_URL_LIFETIME_MS);
  },
  newToken: () => globalThis.crypto.randomUUID(),
  now: () => Date.now(),
  extensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return 'Unknown';
    }
  },
};
