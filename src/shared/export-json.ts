import type { PrintableReportMetadata } from './export-pdf.js';
import { buildReportExportData, type ReportExportData } from './export-report.js';
import type { ScanResult } from './types.js';

interface JsonExportData extends ReportExportData {
  readonly exportedAt: string;
  readonly reportMetadata: {
    readonly inspectedUrl: string;
    readonly scannedAt: string;
    readonly extensionVersion: string;
    readonly browser: string;
  };
  readonly summary: {
    readonly pageUrl: string;
    readonly scannedAt: string;
    readonly health: ScanResult['health'];
  };
  readonly scanResult: ScanResult;
}

/** Builds the JSON export payload from the same report sections used by the PDF export. */
export function buildJsonExport(
  result: ScanResult,
  metadata: PrintableReportMetadata,
  exportedAt: string = new Date().toISOString()
): JsonExportData {
  const reportData = buildReportExportData(result);

  return {
    exportedAt,
    reportMetadata: {
      inspectedUrl: result.pageUrl,
      scannedAt: result.scannedAt,
      extensionVersion: metadata.extensionVersion,
      browser: metadata.browser,
    },
    summary: {
      pageUrl: result.pageUrl,
      scannedAt: result.scannedAt,
      health: result.health,
    },
    ...reportData,
    scanResult: result,
  };
}
