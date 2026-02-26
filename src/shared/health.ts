/**
 * Health score calculation logic.
 *
 * Uses traffic-light (RAG) tiering:
 *   Red   (critical)  — any failing check
 *   Amber (issues)    — any warning (no failures)
 *   Green (excellent)  — no failures or warnings
 */

import type { CheckResult, HealthScore } from './types.js';

/**
 * Computes aggregate health metrics and RAG tier from check outcomes.
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

  let tier: HealthScore['tier'];
  if (failing > 0) {
    tier = 'critical';
  } else if (warnings > 0) {
    tier = 'issues';
  } else {
    tier = 'excellent';
  }

  return { score, passing, failing, warnings, total, tier };
}
