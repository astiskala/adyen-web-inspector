/**
 * Printable report — the self-contained HTML the report page prints, and the
 * storage key and URL parameter of the scan result handed to that page.
 */

import {
  HEALTH_TIER_COLORS,
  INTEGRATION_FLOW_LABELS,
  SEVERITY_COLORS,
  STATUS_COLORS,
} from './constants.js';
import type { ScanResult, StandardCompliance } from './types.js';
import {
  buildFindingProjection,
  buildRawConfigSections,
  summarizeImplementation,
  type IssueGroup,
} from './export-report.js';
import { STANDARD_COMPLIANCE_COPY } from './standard-compliance.js';

type FindingProjection = ReturnType<typeof buildFindingProjection>;
type FindingSection = FindingProjection['bestPractices'];

const PDF_REPORT_STORAGE_PREFIX = 'pdf-report:' as const;
/** Extension page that renders and prints the report. */
export const PDF_REPORT_PAGE_PATH = 'report/report.html' as const;
export const PDF_REPORT_TOKEN_PARAM = 'token' as const;

export interface PrintableReportMetadata {
  readonly extensionVersion: string;
  readonly browser: string;
}

/** Returns the session-storage key used for a pending PDF export handoff. */
export function getPdfReportStorageKey(token: string): string {
  return `${PDF_REPORT_STORAGE_PREFIX}${token}`;
}

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
  implementationAttributes: ReturnType<typeof summarizeImplementation>
): ImplementationAttribute[] {
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
    { label: 'Integration Flow', value: INTEGRATION_FLOW_LABELS[implementationAttributes.flow] },
  ];
}

function buildAttributesHtml(
  implementationAttributes: ReturnType<typeof summarizeImplementation>
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

function buildSkippedRows(skippedChecks: FindingProjection['skippedChecks']): string {
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

function buildIssueTableForSection(
  issueGroups: readonly IssueGroup[],
  emptyMessage: string
): string {
  if (issueGroups.length === 0) {
    return `<p style="color:#6b7280">${escapeHtml(emptyMessage)}</p>`;
  }

  const rows: string[] = [];

  for (const group of issueGroups) {
    rows.push(`
      <tr class="impact-row">
        <td colspan="3">${escapeHtml(group.label)} (${group.issues.length})</td>
      </tr>`);

    for (const issue of group.issues) {
      const color = SEVERITY_COLORS[issue.severity];
      const detail = issue.detail === null ? '' : `<br><small>${escapeHtml(issue.detail)}</small>`;
      const docsLink = `<br><a class="docs-link" href="${escapeHtml(issue.docsUrl)}" target="_blank" rel="noopener noreferrer">Read documentation</a>`;
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
  section: FindingSection,
  emptyMessage: string
): string {
  const checks = section.successfulChecks;
  if (checks.length === 0) {
    return `<p style="color:#6b7280">${escapeHtml(emptyMessage)}</p>`;
  }

  const rows = checks
    .map(
      (check) =>
        `<tr><td style="color:${STATUS_COLORS.pass};font-weight:600;text-transform:uppercase;white-space:nowrap;width:80px">PASS</td><td>${escapeHtml(check.title)}</td></tr>`
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

function buildNetworkHtml(network: FindingProjection['network']): string {
  const reqs = network.capturedRequests;
  const parts: string[] = ['<h3 style="font-size:12px;margin:12px 0 6px">Captured Requests</h3>'];

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

function buildRawConfigHtml(rawConfig: FindingProjection['rawConfig']): string {
  const preStyle =
    'font-family:monospace;font-size:11px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:10px;white-space:pre-wrap;word-break:break-all;overflow:auto;max-height:400px';
  const h3Style = 'font-size:12px;margin:12px 0 6px';

  return buildRawConfigSections(rawConfig)
    .map(
      ({ title, text }) =>
        `<h3 style="${h3Style}">${escapeHtml(title)}</h3><pre style="${preStyle}">${escapeHtml(text)}</pre>`
    )
    .join('');
}

function buildComplianceHtml(compliance: StandardCompliance): string {
  const icon = compliance.compliant ? '\u2713' : '\u2717';
  const iconColor = compliance.compliant ? STATUS_COLORS.pass : STATUS_COLORS.fail;
  const label = compliance.compliant
    ? STANDARD_COMPLIANCE_COPY.metLabel
    : STANDARD_COMPLIANCE_COPY.unmetLabel;

  const reasonsList =
    !compliance.compliant && compliance.reasons.length > 0
      ? `<ul style="margin:4px 0 0 20px;padding:0;font-size:11px;color:#6b7280">${compliance.reasons
          .map((r) => `<li>${escapeHtml(r)}</li>`)
          .join('')}</ul>`
      : '';

  const caveat =
    '<div style="margin-top:6px;font-size:11px;color:#6b7280;line-height:1.4">' +
    `${escapeHtml(STANDARD_COMPLIANCE_COPY.caveat)} ` +
    `See the <a class="docs-link" href="${STANDARD_COMPLIANCE_COPY.checklistUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(STANDARD_COMPLIANCE_COPY.checklistLabel)}</a>.` +
    '</div>';

  return `<div style="border:1px solid #e5e7eb;border-radius:6px;padding:10px 16px;margin-bottom:20px">
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:16px;font-weight:700;color:${iconColor}">${icon}</span>
      <span style="font-size:12px;font-weight:600">${escapeHtml(label)}</span>
    </div>
    ${reasonsList}
    ${caveat}
  </div>`;
}

/** Builds the self-contained HTML document used by the printable export tab. */
export function buildPrintableHtml(result: ScanResult, metadata: PrintableReportMetadata): string {
  const date = new Date(result.scannedAt).toLocaleString();
  const { score, passing, total, tier } = result.health;
  const tierColor = HEALTH_TIER_COLORS[tier];
  const projection = buildFindingProjection(result);

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

  ${buildComplianceHtml(result.standardCompliance)}

  <h2>Implementation Attributes</h2>
  ${buildAttributesHtml(summarizeImplementation(result))}

  <h2>Best Practices</h2>
  ${buildIssueTableForSection(projection.bestPractices.issueGroups, 'No best-practice issues identified.')}

  <h2>Security</h2>
  ${buildIssueTableForSection(projection.security.issueGroups, 'No security issues identified.')}

  <h2>Successful Checks</h2>
  <h3 style="font-size:12px;margin:8px 0 6px">Best Practices</h3>
  ${buildSuccessfulChecksTableForCategory(
    projection.bestPractices,
    'No successful best-practice checks recorded.'
  )}
  <h3 style="font-size:12px;margin:8px 0 6px">Security</h3>
  ${buildSuccessfulChecksTableForCategory(projection.security, 'No successful security checks recorded.')}

  <h2>Skipped Checks</h2>
  <table>
    <thead>
      <tr>
        <th>Check</th>
        <th>Skip Reason</th>
      </tr>
    </thead>
    <tbody>
      ${buildSkippedRows(projection.skippedChecks)}
    </tbody>
  </table>

  <h2>Network</h2>
  ${buildNetworkHtml(projection.network)}

  <h2>Extracted Config</h2>
  ${buildRawConfigHtml(projection.rawConfig)}

  <div class="footer">
    Generated by Adyen Web Inspector v${escapeHtml(metadata.extensionVersion)} &mdash; ${escapeHtml(
      date
    )}
  </div>
</body>
</html>`;
}
