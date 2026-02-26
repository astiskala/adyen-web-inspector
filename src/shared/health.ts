/**
 * Health score calculation logic.
 */

import type { CheckResult, HealthScore } from './types.js';
import { HEALTH_THRESHOLDS } from './constants.js';
import { getImpactLevel } from './results.js';

/**
 * Computes aggregate health metrics and tier from check outcomes.
 * High-impact issues force the `critical` tier even with a strong pass ratio.
 */
export function calculateHealthScore(checks: CheckResult[]): HealthScore {
  const scoreable = checks.filter(
    (c) => c.severity !== 'skip' && c.severity !== 'info' && c.severity !== 'notice'
  );
  const passing = scoreable.filter((c) => c.severity === 'pass').length;
  const failing = scoreable.filter((c) => c.severity === 'fail').length;
  const warnings = scoreable.filter((c) => c.severity === 'warn').length;
  const total = scoreable.length;

  const score = total === 0 ? 100 : Math.round((passing / total) * 100);

  const issueChecks = checks.filter(
    (check) => check.severity === 'fail' || check.severity === 'warn' || check.severity === 'notice'
  );
  const hasHighImpactIssue = issueChecks.some((check) => getImpactLevel(check) === 'high');

  let tier: HealthScore['tier'];
  if (hasHighImpactIssue) {
    tier = 'critical';
  } else if (issueChecks.length === 0) {
    tier = 'excellent';
  } else if (score >= HEALTH_THRESHOLDS.good) {
    tier = 'good';
  } else {
    tier = 'issues';
  }

  return { score, passing, failing, warnings, total, tier };
}
