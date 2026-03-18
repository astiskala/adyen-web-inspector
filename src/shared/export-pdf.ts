import type { ScanResult, CapturedRequest, CheckCategory } from './types';
import type { ExportIssueRow } from './utils';
import { buildIssueExportRows, extractHostname, isAdyenHost } from './utils';
import { buildImplementationAttributes } from './implementation-attributes';

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

function buildAttributes(result: ScanResult): ImplementationAttribute[] {
  const attrs: ImplementationAttribute[] = [];
  const implementationAttributes = buildImplementationAttributes(result.payload);

  attrs.push(
    { label: 'SDK Version', value: implementationAttributes.sdkVersion },
    {
      label: 'Environment',
      value:
        implementationAttributes.environment === 'unknown'
          ? 'Unknown'
          : implementationAttributes.environment,
    }
  );

  if (implementationAttributes.region !== null) {
    attrs.push({ label: 'Region', value: implementationAttributes.region });
  }

  attrs.push(
    { label: 'Integration Flavor', value: implementationAttributes.flavor },
    { label: 'Import Method', value: implementationAttributes.importMethod }
  );

  const integrationFlow = implementationAttributes.flow;
  let flowLabel = 'Unknown';
  if (integrationFlow === 'sessions') {
    flowLabel = 'Sessions';
  } else if (integrationFlow === 'advanced') {
    flowLabel = 'Advanced';
  }
  attrs.push({ label: 'Integration Flow', value: flowLabel });

  return attrs;
}

function buildAttributesHtml(result: ScanResult): string {
  const attrs = buildAttributes(result);
  const rows = attrs
    .map(
      (a) =>
        `<tr><td class="attr-label">${escapeHtml(a.label)}</td><td>${escapeHtml(a.value)}</td></tr>`
    )
    .join('');
  return `<table class="attr-table"><tbody>${rows}</tbody></table>`;
}

function buildSkippedRows(result: ScanResult): string {
  const skipped = result.checks.filter((c) => c.severity === 'skip');
  if (skipped.length === 0) {
    return '<tr><td colspan="2">No checks were skipped.</td></tr>';
  }

  const rows = skipped.map((check) => {
    const dashIndex = check.title.indexOf(' — ');
    const hasSeparator = dashIndex !== -1;
    const checkName = hasSeparator ? check.title.slice(0, dashIndex).trim() : check.title;
    const parsedReason = hasSeparator ? check.title.slice(dashIndex + 3).trim() : '';
    const skipReason = (check.detail ?? parsedReason).trim();
    const skipReasonCell = skipReason === '' ? '—' : skipReason;
    return `<tr>
      <td>${escapeHtml(checkName)}</td>
      <td style="color:#6b7280">${escapeHtml(skipReasonCell)}</td>
    </tr>`;
  });
  return rows.join('');
}

const BEST_PRACTICE_CATEGORIES: ReadonlySet<CheckCategory> = new Set([
  'sdk-identity',
  'version-lifecycle',
  'environment',
  'auth',
  'callbacks',
  'risk',
]);
const SECURITY_CATEGORIES: ReadonlySet<CheckCategory> = new Set(['security', 'third-party']);

function buildIssueTableForCategory(
  result: ScanResult,
  categoryFilter: ReadonlySet<CheckCategory>,
  emptyMessage: string
): string {
  const issues = buildIssueExportRows(result.checks, {
    sortByImpact: true,
    friendlyRemediation: true,
    preferAdyenDocs: true,
  }).filter((issue) => categoryFilter.has(issue.category));

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
  result: ScanResult,
  categoryFilter: ReadonlySet<CheckCategory>,
  emptyMessage: string
): string {
  const checks = result.checks
    .filter((check) => categoryFilter.has(check.category) && check.severity === 'pass')
    .sort((a, b) => a.title.localeCompare(b.title));

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

function buildNetworkHtml(result: ScanResult): string {
  const reqs: readonly CapturedRequest[] = result.payload.capturedRequests.filter((req) => {
    if (req.type !== 'other') {
      return true;
    }

    const host = extractHostname(req.url);
    return host !== null && isAdyenHost(host);
  });
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

function buildRawConfigHtml(result: ScanResult): string {
  const config = result.payload.page.checkoutConfig;
  const component = result.payload.page.componentConfig;
  const inferred = result.payload.page.inferredConfig;
  const metadata = result.payload.page.adyenMetadata;

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
  ${buildAttributesHtml(result)}

  <h2>Best Practices</h2>
  ${buildIssueTableForCategory(
    result,
    BEST_PRACTICE_CATEGORIES,
    'No best-practice issues identified.'
  )}

  <h2>Security</h2>
  ${buildIssueTableForCategory(result, SECURITY_CATEGORIES, 'No security issues identified.')}

  <h2>Successful Checks</h2>
  <h3 style="font-size:12px;margin:8px 0 6px">Best Practices</h3>
  ${buildSuccessfulChecksTableForCategory(
    result,
    BEST_PRACTICE_CATEGORIES,
    'No successful best-practice checks recorded.'
  )}
  <h3 style="font-size:12px;margin:8px 0 6px">Security</h3>
  ${buildSuccessfulChecksTableForCategory(
    result,
    SECURITY_CATEGORIES,
    'No successful security checks recorded.'
  )}

  <h2>Skipped Checks</h2>
  <table>
    <thead>
      <tr>
        <th>Check</th>
        <th>Skip Reason</th>
      </tr>
    </thead>
    <tbody>
      ${buildSkippedRows(result)}
    </tbody>
  </table>

  <h2>Network</h2>
  ${buildNetworkHtml(result)}

  <h2>Raw Config</h2>
  ${buildRawConfigHtml(result)}

  <div class="footer">
    Generated by Adyen Web Inspector v${escapeHtml(metadata.extensionVersion)} &mdash; ${escapeHtml(
      date
    )}
  </div>
</body>
</html>`;
}
