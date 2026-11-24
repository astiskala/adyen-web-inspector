/**
Report export — how a scan result leaves the extension. The report handoff
stores the result under a one-time token, opens the report page, and lets
that page take the result back exactly once; the JSON export downloads the
report data. Views and the report page reach the browser only through a
`ReportBrowser`: Chrome in production, in memory in tests.
*/

import { describeBrowser, type ReportMetadata } from './export-metadata.js';
import { buildJsonExport } from './export-json.js';
import type { ScanResult } from './types.js';
import { isScanResult } from './utilities.js';

const REPORT_STORAGE_PREFIX = 'pdf-report:';
/**
Extension page that renders and prints the report.
*/
const REPORT_PAGE_PATH = 'report/report.html';
const REPORT_TOKEN_PARAM = 'token';
const MESSAGES = {
  missingToken: 'The request was missing its report token. Open the report from a scan result.',
  unavailable: 'The export data was unavailable. Please rerun the scan and try again.',
} as const;

/**
Everything report export needs from the browser.
*/
export interface ReportBrowser {
  /**
  Writes session-scoped values that another extension page can read.
  */
  readonly write: (items: Readonly<Record<string, unknown>>) => Promise<void>;
  /**
  Reads a session-scoped value; resolves undefined when it is missing.
  */
  readonly read: (key: string) => Promise<unknown>;
  readonly remove: (key: string) => Promise<void>;
  /**
  Opens an extension page, with query parameters, in a new tab.
  */
  readonly openExtensionPage: (
    path: string,
    parameters: Readonly<Record<string, string>>
  ) => Promise<void>;
  /**
  Saves text as a downloaded file.
  */
  readonly download: (filename: string, text: string, type: string) => void;
  readonly newToken: () => string;
  /**
  Current time in Unix milliseconds.
  */
  readonly now: () => number;
  /**
  The extension's version, or Unknown when it cannot be read.
  */
  readonly extensionVersion: () => string;
}

/**
What the report page shows: the scan result with who exported it, or why it cannot.
*/
type OpenedReport =
  | {
      readonly result: ScanResult;
      readonly metadata: ReportMetadata;
      readonly printOnOpen: boolean;
    }
  | { readonly error: string };

function storageKey(token: string): string {
  return `${REPORT_STORAGE_PREFIX}${token}`;
}

function reportMetadata(browser: ReportBrowser): ReportMetadata {
  return { extensionVersion: browser.extensionVersion(), browser: describeBrowser() };
}

/**
Hands the result to a new report tab, which renders it and optionally prints it
independently of the popup or DevTools lifecycle. The handoff is removed
again when the tab cannot be opened.
*/
export async function openReport(
  result: ScanResult,
  browser: ReportBrowser,
  mode: 'view' | 'print' = 'view'
): Promise<void> {
  const token = browser.newToken();
  const key = storageKey(token);
  await browser.write({ [key]: result });
  try {
    await browser.openExtensionPage(REPORT_PAGE_PATH, {
      [REPORT_TOKEN_PARAM]: token,
      ...(mode === 'print' && { print: '1' }),
    });
  } catch (error: unknown) {
    await Promise.allSettled([browser.remove(key)]);
    throw error;
  }
}

/**
Takes the result handed to the report page at this URL, once, with the
metadata the report prints. Storage failures read as unavailable data.
*/
export async function takeReport(url: string, browser: ReportBrowser): Promise<OpenedReport> {
  const parameters = new URL(url).searchParams;
  const token = parameters.get(REPORT_TOKEN_PARAM);
  if (token === null || token === '') return { error: MESSAGES.missingToken };
  const key = storageKey(token);
  const [stored] = await Promise.allSettled([browser.read(key)]);
  await Promise.allSettled([browser.remove(key)]);
  return stored.status === 'fulfilled' && isScanResult(stored.value)
    ? {
        result: stored.value,
        metadata: reportMetadata(browser),
        printOnOpen: parameters.get('print') === '1',
      }
    : { error: MESSAGES.unavailable };
}

/**
Downloads the JSON report built from the same sections as the PDF report.
*/
export function exportJson(result: ScanResult, browser: ReportBrowser): void {
  const now = browser.now();
  const data = buildJsonExport(result, reportMetadata(browser), new Date(now).toISOString());
  browser.download(
    `adyen-inspector-${now}.json`,
    JSON.stringify(data, null, 2),
    'application/json'
  );
}
