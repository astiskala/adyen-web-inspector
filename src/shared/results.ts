/**
Severity policy — which check results are issues, which count toward the
health score, the impact each issue carries, and the labels every view
shows for impact groups.
*/

import type { CheckImpact, CheckResult, Severity } from './types.js';

/**
Impact buckets in priority order, used to group and sort issues.
*/
export const ISSUE_IMPACT_ORDER: readonly CheckImpact[] = ['high', 'medium', 'low', 'manual'];

/**
Display labels for impact groups, shared by the popup, DevTools panel, and reports.
*/
export const IMPACT_LABELS: Readonly<Record<CheckImpact, string>> = {
  high: 'High impact',
  medium: 'Medium impact',
  low: 'Low impact',
  manual: 'Manual verification',
};

/**
Issue severities in priority order, used to sort issues within an impact group.
*/
export const ISSUE_SEVERITIES = ['fail', 'warn', 'notice'] as const satisfies readonly Severity[];

export type IssueCheck = CheckResult & { readonly severity: (typeof ISSUE_SEVERITIES)[number] };

/**
Severities that state a verified outcome; info, notice, and skip do not score.
*/
const SCORED_SEVERITIES: ReadonlySet<Severity> = new Set(['pass', 'warn', 'fail']);

/**
Returns true when a check result is an issue (fail, warn, or notice).
*/
export function isIssue(check: CheckResult): check is IssueCheck {
  return ISSUE_SEVERITIES.some((severity) => severity === check.severity);
}

/**
Returns true when a check result counts toward the health score.
*/
export function isScored(check: CheckResult): boolean {
  return SCORED_SEVERITIES.has(check.severity);
}

/**
Returns the impact an issue severity carries unless its check overrides it,
or undefined for severities that are not issues.
*/
export function getDefaultImpact(severity: Severity): CheckImpact | undefined {
  if (severity === 'fail') return 'high';
  if (severity === 'warn') return 'medium';
  return severity === 'notice' ? 'manual' : undefined;
}

/**
Maps a check result to the normalised impact bucket used for prioritisation.
*/
export function getImpactLevel(check: CheckResult): CheckImpact | 'none' {
  const defaultImpact = getDefaultImpact(check.severity);
  return defaultImpact === undefined ? 'none' : (check.impact ?? defaultImpact);
}
