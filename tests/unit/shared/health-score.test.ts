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
  it('returns excellent when there are no issue severities', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('sdk-flavor', 'pass'),
      makeCheck('sdk-import-method', 'info'),
      makeCheck('sdk-bundle-type', 'skip'),
    ]);

    expect(health.tier).toBe('excellent');
    expect(health.score).toBe(100);
  });

  it('returns good when only notice-level issues exist', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('security-referrer-policy', 'notice'),
    ]);

    expect(health.tier).toBe('good');
    expect(health.score).toBe(100);
  });

  it('returns good when warnings exist but score remains above threshold', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('sdk-flavor', 'pass'),
      makeCheck('sdk-import-method', 'pass'),
      makeCheck('version-latest', 'warn'),
    ]);

    expect(health.tier).toBe('good');
    expect(health.score).toBe(75);
  });

  it('returns issues when warnings lower score below the good threshold', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('version-latest', 'warn'),
      makeCheck('auth-locale', 'warn'),
    ]);

    expect(health.tier).toBe('issues');
    expect(health.score).toBe(33);
  });

  it('returns critical when a high-impact issue is present', () => {
    const health = calculateHealthScore([
      makeCheck('sdk-detected', 'pass'),
      makeCheck('risk-df-iframe', 'warn'),
    ]);

    expect(health.tier).toBe('critical');
  });
});
