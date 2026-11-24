import type { ReportBrowser } from '../../src/shared/report-export';

interface Download {
  readonly filename: string;
  readonly text: string;
  readonly type: string;
}

export interface FakeReportBrowser extends ReportBrowser {
  /**
  Session storage contents.
  */
  readonly storage: Map<string, unknown>;
  /**
  URLs of the extension pages opened, in order.
  */
  readonly opened: string[];
  readonly downloads: Download[];
  /**
  Makes the matching operations reject, to exercise browser failures.
  */
  readonly failing: Set<'read' | 'remove' | 'open'>;
}

/**
In-memory adapter for report export, with a fixed token, clock, and extension version.
*/
export function createFakeReportBrowser(): FakeReportBrowser {
  const browser: FakeReportBrowser = {
    storage: new Map(),
    opened: [],
    downloads: [],
    failing: new Set(),
    async write(items) {
      for (const [key, value] of Object.entries(items)) browser.storage.set(key, value);
    },
    async read(key) {
      if (browser.failing.has('read')) throw new Error('storage gone');
      return browser.storage.get(key);
    },
    async remove(key) {
      if (browser.failing.has('remove')) throw new Error('storage gone');
      browser.storage.delete(key);
    },
    async openExtensionPage(path, parameters) {
      if (browser.failing.has('open')) throw new Error('tab creation failed');
      browser.opened.push(
        `chrome-extension://inspector/${path}?${new URLSearchParams(parameters)}`
      );
    },
    download(filename, text, type) {
      browser.downloads.push({ filename, text, type });
    },
    newToken: () => 'token-1',
    now: () => Date.UTC(2026, 2, 18, 1, 23, 45),
    extensionVersion: () => '1.4.0',
  };
  return browser;
}
