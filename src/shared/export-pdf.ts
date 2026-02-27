import type { ScanResult, CapturedRequest, CheckCategory } from './types';
import type { ExportIssueRow } from './utils';
import { buildIssueExportRows, extractHostname, isAdyenHost } from './utils';
import { buildImplementationAttributes } from './implementation-attributes';

/**
 * Generates a self-contained printable HTML report and opens the browser
 * print dialog via a hidden iframe.  No server required.
 */
export function exportPdf(result: ScanResult): void {
  const html = buildPrintableHtml(result);
  if (openPrintableWindow(html)) {
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
  document.body.appendChild(iframe);

  // Use srcdoc instead of doc.write to avoid the deprecated API.
  iframe.addEventListener(
    'load',
    () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      globalThis.setTimeout(() => {
        iframe.remove();
      }, 2000);
    },
    { once: true }
  );
  iframe.srcdoc = html;
}

function openPrintableWindow(html: string): boolean {
  try {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const popup = globalThis.open(url, '_blank');
    if (!popup) {
      URL.revokeObjectURL(url);
      return false;
    }

    let printed = false;
    const doPrint = (): void => {
      if (printed) return;
      printed = true;
      try {
        popup.focus();
        popup.print();
      } catch {
        // Window may have been closed or become inaccessible.
      }
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 15_000);
    };

    // Primary: listen for the load event.
    try {
      popup.addEventListener('load', doPrint, { once: true });
    } catch {
      // Cross-origin blob URL — event listener may fail.
    }

    // Fallback: fire after a delay if the load event does not reach us
    // (e.g. MV3 extension popup losing context after window.open).
    globalThis.setTimeout(doPrint, 1500);

    return true;
  } catch {
    return false;
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

function buildCategorySectionHtml(
  result: ScanResult,
  categoryFilter: ReadonlySet<CheckCategory>,
  issueEmptyMessage: string,
  successEmptyMessage: string
): string {
  return `
    <h3 style="font-size:12px;margin:8px 0 6px">Issues</h3>
    ${buildIssueTableForCategory(result, categoryFilter, issueEmptyMessage)}
    <h3 style="font-size:12px;margin:12px 0 6px">Successful Checks</h3>
    ${buildSuccessfulChecksTableForCategory(result, categoryFilter, successEmptyMessage)}
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
  const metadata = result.payload.page.adyenMetadata;
  const configText = config ? JSON.stringify(config, null, 2) : 'No config captured.';
  const metaText = JSON.stringify(metadata ?? null, null, 2);

  return `
    <h3 style="font-size:12px;margin:12px 0 6px">Raw Checkout Config</h3>
    <pre style="font-family:monospace;font-size:11px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:10px;white-space:pre-wrap;word-break:break-all;overflow:auto;max-height:400px">${escapeHtml(configText)}</pre>
    <h3 style="font-size:12px;margin:12px 0 6px">SDK Metadata</h3>
    <pre style="font-family:monospace;font-size:11px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:10px;white-space:pre-wrap;word-break:break-all;overflow:auto;max-height:400px">${escapeHtml(metaText)}</pre>
  `;
}

function buildPrintableHtml(result: ScanResult): string {
  const domain = ((): string => {
    try {
      return new URL(result.pageUrl).hostname;
    } catch {
      return result.pageUrl;
    }
  })();
  const date = new Date(result.scannedAt).toLocaleString();
  const { score, passing, total, tier } = result.health;
  const tierColor = scoreColor(tier);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Adyen Web Inspector — ${escapeHtml(domain)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; padding: 24px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .subtitle { color: #6b7280; font-size: 11px; margin-bottom: 20px; }
    .score-block { display: flex; gap: 24px; align-items: center; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; }
    .score-num { font-size: 36px; font-weight: 700; color: ${tierColor}; }
    .score-meta { font-size: 12px; color: #374151; }
    .score-meta strong { font-size: 14px; text-transform: capitalize; }
    h2 { font-size: 13px; margin: 16px 0 8px; text-transform: uppercase; letter-spacing: 0.4px; color: #374151; }
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
  <p class="subtitle">${escapeHtml(domain)} &mdash; ${escapeHtml(date)}</p>

  <h2>Implementation Attributes</h2>
  ${buildAttributesHtml(result)}

  <div class="score-block">
    <div class="score-num">${score}</div>
    <div class="score-meta">
      <strong>${tier}</strong><br>
      ${passing} of ${total} checks passing
    </div>
  </div>

  <h2>Best Practices</h2>
  ${buildCategorySectionHtml(
    result,
    BEST_PRACTICE_CATEGORIES,
    'No best-practice issues identified.',
    'No successful best-practice checks recorded.'
  )}

  <h2>Security</h2>
  ${buildCategorySectionHtml(
    result,
    SECURITY_CATEGORIES,
    'No security issues identified.',
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

  <div class="footer">Generated by Adyen Web Inspector &mdash; ${escapeHtml(date)}</div>
</body>
</html>`;
}
