/**
 * Logic for building issue export rows for JSON and PDF reports.
 */

import type { CheckCategory, CheckId, CheckImpact, CheckResult, Severity } from './types.js';
import {
  getImpactLabel,
  getImpactLevel,
  getRemediationText,
  isIssue,
  ISSUE_IMPACT_ORDER,
} from './results.js';

const ADYEN_WEB_BEST_PRACTICES_DOC = 'https://docs.adyen.com/online-payments/web-best-practices/';

export interface ExportIssueRow {
  id: CheckId;
  category: CheckCategory;
  severity: Severity;
  title: string;
  impact: string;
  impactLevel: CheckImpact;
  detail: string | null;
  remediation: string;
  docsUrl: string;
}

const ISSUE_SEVERITY_ORDER: readonly Severity[] = ['fail', 'warn', 'notice'];

function getImpactRank(impactLevel: CheckImpact): number {
  return ISSUE_IMPACT_ORDER.indexOf(impactLevel);
}

/** Ranks issue severities for sorting: fail, then warn, then notice. */
export function getIssueSeverityRank(severity: Severity): number {
  return ISSUE_SEVERITY_ORDER.indexOf(severity);
}

function sortIssueRowsByImpact(a: ExportIssueRow, b: ExportIssueRow): number {
  const impactRankDiff = getImpactRank(a.impactLevel) - getImpactRank(b.impactLevel);
  if (impactRankDiff !== 0) {
    return impactRankDiff;
  }

  const severityRankDiff = getIssueSeverityRank(a.severity) - getIssueSeverityRank(b.severity);
  if (severityRankDiff !== 0) {
    return severityRankDiff;
  }

  return a.title.localeCompare(b.title);
}

/**
 * Converts issue-level checks into report rows sorted by impact, severity, then
 * title, with reader-friendly remediation and an Adyen docs fallback.
 */
export function buildIssueExportRows(checks: readonly CheckResult[]): ExportIssueRow[] {
  return checks
    .filter(isIssue)
    .map((check) => {
      const impactLevel = getImpactLevel(check);
      return {
        id: check.id,
        category: check.category,
        severity: check.severity,
        title: check.title,
        impact: getImpactLabel(check),
        impactLevel: impactLevel === 'none' ? 'low' : impactLevel,
        detail: check.detail ?? null,
        remediation: getRemediationText(check, { friendly: true }),
        docsUrl: check.docsUrl ?? ADYEN_WEB_BEST_PRACTICES_DOC,
      };
    })
    .toSorted(sortIssueRowsByImpact);
}
