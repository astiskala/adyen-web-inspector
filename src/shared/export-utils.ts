/**
 * Logic for building issue export rows (e.g. for PDF export).
 */

import type { CheckCategory, CheckId, CheckResult, Severity } from './types.js';
import {
  getImpactLabel,
  getImpactLevel,
  getRecommendedDocsUrl,
  getRemediationText,
  type IssueImpactLevel,
} from './results.js';

export interface ExportIssueRow {
  id: CheckId;
  category: CheckCategory;
  severity: Severity;
  title: string;
  impact: string;
  impactLevel: IssueImpactLevel;
  detail: string | null;
  remediation: string;
  docsUrl: string | null;
}

const ISSUE_IMPACT_ORDER: readonly IssueImpactLevel[] = ['high', 'medium', 'low', 'manual'];

function getImpactRank(impactLevel: IssueImpactLevel): number {
  return ISSUE_IMPACT_ORDER.indexOf(impactLevel);
}

function getIssueSeverityRank(severity: Severity): number {
  if (severity === 'fail') return 0;
  if (severity === 'warn') return 1;
  if (severity === 'notice') return 2;
  return 3;
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

interface BuildIssueExportRowsOptions {
  readonly sortByImpact?: boolean;
  readonly friendlyRemediation?: boolean;
  readonly preferAdyenDocs?: boolean;
}

/**
 * Converts issue-level checks into export rows used by reports.
 * Options control ordering and whether remediation/docs are normalised for readers.
 */
export function buildIssueExportRows(
  checks: readonly CheckResult[],
  options: BuildIssueExportRowsOptions = {}
): ExportIssueRow[] {
  const rows = checks
    .filter(
      (check) =>
        check.severity === 'fail' || check.severity === 'warn' || check.severity === 'notice'
    )
    .map((check) => {
      const impactLevel = getImpactLevel(check);
      const normalizedImpact = impactLevel === 'none' ? 'low' : impactLevel;

      return {
        id: check.id,
        category: check.category,
        severity: check.severity,
        title: check.title,
        impact: getImpactLabel(check),
        impactLevel: normalizedImpact,
        detail: check.detail ?? null,
        remediation: getRemediationText(check, {
          ...(options.friendlyRemediation === undefined
            ? {}
            : { friendly: options.friendlyRemediation }),
        }),
        docsUrl: getRecommendedDocsUrl(check, options.preferAdyenDocs === true),
      };
    });

  if (options.sortByImpact !== true) {
    return rows;
  }

  return rows.sort(sortIssueRowsByImpact);
}
