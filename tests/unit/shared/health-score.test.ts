import { describe, expect, it } from 'vitest';
import { calculateHealthScore } from '../../../src/shared/utils';
import type { CheckId, CheckResult, Severity } from '../../../src/shared/types';

function makeCheck(id: CheckId, severity: Severity): CheckResult {
  return {
    id,
    category: 'sdk-identity',
    severity,
    title: `${id}-${severity}`,
  };
}

describe('calculateHealthScore', () => {
  it('returns excellent (green) when no fails or warnings', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('sdk-flavor', 'pass'),
      makeCheck('sdk-import-method', 'info'),
      makeCheck('sdk-bundle-type', 'skip'),
    ]);

    expect(health.tier).toBe('excellent');
    expect(health.score).toBe(100);
  });

  it('returns excellent (green) when only notice-level issues exist', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('security-referrer-policy', 'notice'),
    ]);

    expect(health.tier).toBe('excellent');
    expect(health.score).toBe(100);
  });

  it('returns issues (amber) when any warning exists', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('sdk-flavor', 'pass'),
      makeCheck('sdk-import-method', 'pass'),
      makeCheck('version-latest', 'warn'),
    ]);

    expect(health.tier).toBe('issues');
    expect(health.score).toBe(75);
  });

  it('returns issues (amber) when multiple warnings exist', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('version-latest', 'warn'),
      makeCheck('auth-locale', 'warn'),
    ]);

    expect(health.tier).toBe('issues');
    expect(health.score).toBe(33);
  });

  it('returns critical (red) when any failing check is present', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('auth-country-code', 'fail'),
    ]);

    expect(health.tier).toBe('critical');
  });

  it('returns score 100 when all checks are skipped or info (no scoreable checks)', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'skip'),
      makeCheck('sdk-flavor', 'info'),
    ]);

    expect(health.score).toBe(100);
    expect(health.total).toBe(0);
    expect(health.tier).toBe('excellent');
  });
});
