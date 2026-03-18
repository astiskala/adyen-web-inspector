import type { ScanResult } from './types';
import type { ExportIssueRow } from './utils';
import { buildReportExportData, type ExportCategorySection } from './export-report';

const PDF_REPORT_STORAGE_PREFIX = 'pdf-report:' as const;
const PDF_REPORT_PAGE_PATH = 'report/report.html' as const;
export const PDF_REPORT_TOKEN_PARAM = 'token' as const;

export interface PrintableReportMetadata {
  readonly extensionVersion: string;
  readonly browser: string;
}

function getChromeApi(): typeof chrome | null {
  if (typeof chrome === 'undefined') {
    return null;
  }
  return chrome;
}

/** Returns the session-storage key used for a pending PDF export handoff. */
export function getPdfReportStorageKey(token: string): string {
  return `${PDF_REPORT_STORAGE_PREFIX}${token}`;
}

/** Builds the extension report page URL for the given export token. */
export function buildPdfReportUrl(token: string): string {
  const chromeApi = getChromeApi();
  if (chromeApi === null) {
    throw new Error('PDF export requires the extension runtime');
  }

  const url = new URL(chromeApi.runtime.getURL(PDF_REPORT_PAGE_PATH));
  url.searchParams.set(PDF_REPORT_TOKEN_PARAM, token);
  return url.toString();
}

async function openPdfReportTab(url: string): Promise<void> {
  const chromeApi = getChromeApi();
  if (chromeApi !== null) {
    await chromeApi.tabs.create({ url });
    return;
  }

  const popup = globalThis.open(url, '_blank');
  if (popup === null) {
    throw new Error('Unable to open PDF report tab');
  }
}

/**
 * Stores the current scan result and opens a dedicated report page that can
 * render and print independently of the popup or DevTools lifecycle.
 */
export async function exportPdf(result: ScanResult): Promise<void> {
  const chromeApi = getChromeApi();
  if (chromeApi === null) {
    throw new Error('PDF export requires chrome.storage.session');
  }

  const token = globalThis.crypto.randomUUID();
  const storageKey = getPdfReportStorageKey(token);
  await chromeApi.storage.session.set({ [storageKey]: result });

  try {
    await openPdfReportTab(buildPdfReportUrl(token));
  } catch (error) {
    await chromeApi.storage.session.remove(storageKey).catch(() => {});
    throw error;
  }
}

function severityColor(severity: string): string {
  if (severity === 'fail') return '#e53935';
  if (severity === 'warn') return '#f59e0b';
  if (severity === 'notice') return '#2563eb';
  if (severity === 'pass') return '#16a34a';
  if (severity === 'info') return '#2563eb';
  return '#6b7280';
}

function scoreColor(tier: string): string {
  if (tier === 'excellent') return severityColor('pass');
  if (tier === 'issues') return severityColor('warn');
  return severityColor('fail');
}

type IssueImpactGroup = ExportIssueRow['impactLevel'];

const ISSUE_IMPACT_GROUP_ORDER: readonly IssueImpactGroup[] = ['high', 'medium', 'low', 'manual'];
const ISSUE_IMPACT_GROUP_LABEL: Record<IssueImpactGroup, string> = {
  high: 'High Impact',
  medium: 'Medium Impact',
  low: 'Low Impact',
  manual: 'Manual Verification',
};

function escapeHtml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

interface ImplementationAttribute {
  label: string;
  value: string;
}

function buildAttributes(
  implementationAttributes: ReturnType<typeof buildReportExportData>['implementationAttributes']
): ImplementationAttribute[] {
  let flowLabel = 'Unknown';
  if (implementationAttributes.flow === 'sessions') {
    flowLabel = 'Sessions';
  } else if (implementationAttributes.flow === 'advanced') {
    flowLabel = 'Advanced';
  }

  return [
    { label: 'SDK Version', value: implementationAttributes.sdkVersion },
    {
      label: 'Environment',
      value:
        implementationAttributes.environment === 'unknown'
          ? 'Unknown'
          : implementationAttributes.environment,
    },
    ...(implementationAttributes.region === null
      ? []
      : [{ label: 'Region', value: implementationAttributes.region }]),
    { label: 'Integration Flavor', value: implementationAttributes.flavor },
    { label: 'Import Method', value: implementationAttributes.importMethod },
    { label: 'Integration Flow', value: flowLabel },
  ];
}

function buildAttributesHtml(
  implementationAttributes: ReturnType<typeof buildReportExportData>['implementationAttributes']
): string {
  const attrs = buildAttributes(implementationAttributes);
  const rows = attrs
    .map(
      (a) =>
        `<tr><td class="attr-label">${escapeHtml(a.label)}</td><td>${escapeHtml(a.value)}</td></tr>`
    )
    .join('');
  return `<table class="attr-table"><tbody>${rows}</tbody></table>`;
}

function buildSkippedRows(
  skippedChecks: ReturnType<typeof buildReportExportData>['skippedChecks']
): string {
  if (skippedChecks.length === 0) {
    return '<tr><td colspan="2">No checks were skipped.</td></tr>';
  }

  return skippedChecks
    .map(
      (check) => `<tr>
      <td>${escapeHtml(check.title)}</td>
      <td style="color:#6b7280">${escapeHtml(check.reason)}</td>
    </tr>`
    )
    .join('');
}

function buildIssueTableForSection(section: ExportCategorySection, emptyMessage: string): string {
  const issues = section.issues;
  if (issues.length === 0) {
    return `<p style="color:#6b7280">${escapeHtml(emptyMessage)}</p>`;
  }

  const rows: string[] = [];

  for (const impactGroup of ISSUE_IMPACT_GROUP_ORDER) {
    const groupIssues = issues.filter((issue) => issue.impactLevel === impactGroup);
    if (groupIssues.length === 0) {
      continue;
    }

    rows.push(`
      <tr class="impact-row">
        <td colspan="3">${escapeHtml(ISSUE_IMPACT_GROUP_LABEL[impactGroup])} (${groupIssues.length})</td>
      </tr>`);

    for (const issue of groupIssues) {
      const color = severityColor(issue.severity);
      const detail = issue.detail === null ? '' : `<br><small>${escapeHtml(issue.detail)}</small>`;
      const docsLink =
        issue.docsUrl === null
          ? ''
          : `<br><a class="docs-link" href="${escapeHtml(issue.docsUrl)}" target="_blank" rel="noopener noreferrer">Read documentation</a>`;
      rows.push(`
      <tr>
        <td style="color:${color};font-weight:600;text-transform:uppercase;white-space:nowrap">${escapeHtml(issue.severity)}</td>
        <td>${escapeHtml(issue.title)}${detail}</td>
        <td>${escapeHtml(issue.remediation)}${docsLink}</td>
      </tr>`);
    }
  }

  return `<table>
    <thead>
      <tr>
        <th style="width:80px">Severity</th>
        <th>Finding</th>
        <th>Remediation</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join('')}
    </tbody>
  </table>`;
}

function buildSuccessfulChecksTableForCategory(
  section: ExportCategorySection,
  emptyMessage: string
): string {
  const checks = section.successfulChecks;
  if (checks.length === 0) {
    return `<p style="color:#6b7280">${escapeHtml(emptyMessage)}</p>`;
  }

  const rows = checks
    .map(
      (check) =>
        `<tr><td style="color:#16a34a;font-weight:600;text-transform:uppercase;white-space:nowrap;width:80px">PASS</td><td>${escapeHtml(check.title)}</td></tr>`
    )
    .join('');

  return `<table>
    <thead>
      <tr>
        <th style="width:80px">Status</th>
        <th>Check</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

function buildReportMetadataHtml(
  result: ScanResult,
  metadata: PrintableReportMetadata,
  scannedAt: string
): string {
  return `
    <table class="meta-table">
      <tbody>
        <tr>
          <td class="meta-label">Inspected URL</td>
          <td class="meta-value">${escapeHtml(result.pageUrl)}</td>
        </tr>
        <tr>
          <td class="meta-label">Scanned At</td>
          <td class="meta-value">${escapeHtml(scannedAt)}</td>
        </tr>
        <tr>
          <td class="meta-label">Extension Version</td>
          <td class="meta-value">${escapeHtml(metadata.extensionVersion)}</td>
        </tr>
        <tr>
          <td class="meta-label">Browser</td>
          <td class="meta-value">${escapeHtml(metadata.browser)}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function buildNetworkHtml(network: ReturnType<typeof buildReportExportData>['network']): string {
  const reqs = network.capturedRequests;
  const parts: string[] = [];

  parts.push('<h3 style="font-size:12px;margin:12px 0 6px">Captured Requests</h3>');
  if (reqs.length === 0) {
    parts.push('<p style="color:#6b7280">No Adyen requests captured.</p>');
  } else {
    const rows = reqs
      .map(
        (req) =>
          `<tr><td>${escapeHtml(req.type)}</td><td style="font-family:monospace;font-size:11px">${escapeHtml(
            req.url
          )}</td><td>${req.statusCode === 0 ? '&mdash;' : req.statusCode}</td></tr>`
      )
      .join('');
    parts.push(
      `<table><thead><tr><th>Type</th><th>URL</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  }

  return parts.join('');
}

function buildRawConfigHtml(
  rawConfig: ReturnType<typeof buildReportExportData>['rawConfig']
): string {
  const config = rawConfig.checkoutConfig;
  const component = rawConfig.componentConfig;
  const inferred = rawConfig.inferredCheckoutConfig;
  const metadata = rawConfig.sdkMetadata;

  const configText = config ? JSON.stringify(config, null, 2) : 'No config captured.';
  const componentText = component
    ? JSON.stringify(component, null, 2)
    : 'No component config captured.';
  const inferredText = inferred
    ? JSON.stringify(inferred, null, 2)
    : 'No inferred config captured.';
  const metaText = JSON.stringify(metadata ?? null, null, 2);

  const preStyle =
    'font-family:monospace;font-size:11px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:10px;white-space:pre-wrap;word-break:break-all;overflow:auto;max-height:400px';
  const h3Style = 'font-size:12px;margin:12px 0 6px';

  return `
    <h3 style="${h3Style}">Raw Checkout Config</h3>
    <pre style="${preStyle}">${escapeHtml(configText)}</pre>
    <h3 style="${h3Style}">Component Config (NPM)</h3>
    <pre style="${preStyle}">${escapeHtml(componentText)}</pre>
    <h3 style="${h3Style}">Inferred Checkout Config</h3>
    <pre style="${preStyle}">${escapeHtml(inferredText)}</pre>
    <h3 style="${h3Style}">SDK Metadata</h3>
    <pre style="${preStyle}">${escapeHtml(metaText)}</pre>
  `;
}

/** Builds the self-contained HTML document used by the printable export tab. */
export function buildPrintableHtml(
  result: ScanResult,
  metadata: PrintableReportMetadata = {
    extensionVersion: 'Unknown',
    browser: 'Unknown',
  }
): string {
  const date = new Date(result.scannedAt).toLocaleString();
  const { score, passing, total, tier } = result.health;
  const tierColor = scoreColor(tier);
  const reportData = buildReportExportData(result);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Adyen Web Inspector — ${escapeHtml(result.pageUrl)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; padding: 24px; }
    h1 { font-size: 18px; margin-bottom: 20px; }
    .score-block { display: flex; gap: 24px; align-items: center; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; }
    .score-num { font-size: 36px; font-weight: 700; color: ${tierColor}; }
    .score-meta { font-size: 12px; color: #374151; }
    .score-meta strong { font-size: 14px; text-transform: capitalize; }
    h2 { font-size: 13px; margin: 16px 0 8px; text-transform: uppercase; letter-spacing: 0.4px; color: #374151; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .meta-table td { padding: 5px 8px; border: 1px solid #e5e7eb; font-size: 12px; vertical-align: top; }
    .meta-label { font-weight: 600; width: 160px; background: #f9fafb; }
    .meta-value { word-break: break-all; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .attr-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .attr-table td { padding: 5px 8px; border: 1px solid #e5e7eb; font-size: 12px; }
    .attr-label { font-weight: 600; width: 160px; background: #f9fafb; }
    th, td { padding: 6px 8px; border: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
    th { background: #f9fafb; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
    .cat-row td { background: #f3f4f6; font-weight: 700; font-size: 11px; letter-spacing: 0.6px; }
    .impact-row td { background: #f8fafc; color: #334155; font-weight: 700; font-size: 11px; letter-spacing: 0.4px; text-transform: uppercase; }
    small { color: #6b7280; display: block; margin-top: 2px; }
    .docs-link { color: #0f62fe; text-decoration: none; font-size: 11px; margin-top: 4px; display: inline-block; }
    .docs-link:hover { text-decoration: underline; }
    .footer { margin-top: 32px; text-align: center; color: #9ca3af; font-size: 10px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>Adyen Web Inspector</h1>

  ${buildReportMetadataHtml(result, metadata, date)}

  <div class="score-block">
    <div class="score-num">${score}</div>
    <div class="score-meta">
      <strong>${tier}</strong><br>
      ${passing} of ${total} checks passing
    </div>
  </div>

  <h2>Implementation Attributes</h2>
  ${buildAttributesHtml(reportData.implementationAttributes)}

  <h2>Best Practices</h2>
  ${buildIssueTableForSection(reportData.bestPractices, 'No best-practice issues identified.')}

  <h2>Security</h2>
  ${buildIssueTableForSection(reportData.security, 'No security issues identified.')}

  <h2>Successful Checks</h2>
  <h3 style="font-size:12px;margin:8px 0 6px">Best Practices</h3>
  ${buildSuccessfulChecksTableForCategory(
    reportData.bestPractices,
    'No successful best-practice checks recorded.'
  )}
  <h3 style="font-size:12px;margin:8px 0 6px">Security</h3>
  ${buildSuccessfulChecksTableForCategory(reportData.security, 'No successful security checks recorded.')}

  <h2>Skipped Checks</h2>
  <table>
    <thead>
      <tr>
        <th>Check</th>
        <th>Skip Reason</th>
      </tr>
    </thead>
    <tbody>
      ${buildSkippedRows(reportData.skippedChecks)}
    </tbody>
  </table>

  <h2>Network</h2>
  ${buildNetworkHtml(reportData.network)}

  <h2>Raw Config</h2>
  ${buildRawConfigHtml(reportData.rawConfig)}

  <div class="footer">
    Generated by Adyen Web Inspector v${escapeHtml(metadata.extensionVersion)} &mdash; ${escapeHtml(
      date
    )}
  </div>
</body>
</html>`;
}
