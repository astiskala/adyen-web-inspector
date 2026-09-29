/**
 * Issue impact — which check results are issues, the impact each carries, and
 * the labels every view shows for impact groups.
 */

import type { CheckImpact, CheckResult, Severity } from './types.js';

/** Impact buckets in priority order, used to group and sort issues. */
export const ISSUE_IMPACT_ORDER: readonly CheckImpact[] = ['high', 'medium', 'low', 'manual'];

/** Display labels for impact groups, shared by the popup, DevTools panel, and reports. */
export const IMPACT_LABELS: Readonly<Record<CheckImpact, string>> = {
  high: 'High impact',
  medium: 'Medium impact',
  low: 'Low impact',
  manual: 'Manual verification',
};

const ISSUE_SEVERITIES: ReadonlySet<Severity> = new Set(['fail', 'warn', 'notice']);

/** Returns true when a check result is an issue (fail, warn, or notice). */
export function isIssue(check: CheckResult): boolean {
  return ISSUE_SEVERITIES.has(check.severity);
}

/**
 * Returns the impact an issue severity carries unless its check overrides it,
 * or undefined for severities that are not issues.
 */
export function getDefaultImpact(severity: Severity): CheckImpact | undefined {
  if (severity === 'fail') return 'high';
  if (severity === 'warn') return 'medium';
  if (severity === 'notice') return 'manual';
  return undefined;
}

/**
 * Maps a check result to the normalised impact bucket used for prioritisation.
 */
export function getImpactLevel(check: CheckResult): CheckImpact | 'none' {
  const defaultImpact = getDefaultImpact(check.severity);
  if (defaultImpact === undefined) return 'none';
  return check.impact ?? defaultImpact;
}
