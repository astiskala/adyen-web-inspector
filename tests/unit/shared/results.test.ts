import { describe, it, expect } from 'vitest';
import { getImpactLevel, IMPACT_LABELS } from '../../../src/shared/results';
import type { CheckResult } from '../../../src/shared/types';

function makeCheck(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    id: 'security-referrer-policy',
    category: 'security',
    severity: 'notice',
    title: 'Referrer-Policy header is not set.',
    ...overrides,
  };
}

describe('notice impact mapping', () => {
  it('maps low-impact notice checks to low impact labels', () => {
    const check = makeCheck({
      id: 'styling-css-custom-props',
      category: 'sdk-identity',
      title: 'Styling notice',
      impact: 'low',
    });

    expect(getImpactLevel(check)).toBe('low');
    expect(IMPACT_LABELS.low).toBe('Low impact');
  });

  it('keeps heuristic notice checks as manual verification', () => {
    const check = makeCheck({
      id: 'callback-multiple-submissions',
      category: 'callbacks',
      title: 'Multiple submissions notice',
    });

    expect(getImpactLevel(check)).toBe('manual');
  });

  it('uses check-owned impact when a new result supplies it', () => {
    expect(getImpactLevel(makeCheck({ severity: 'warn', impact: 'high' }))).toBe('high');
    expect(getImpactLevel(makeCheck({ severity: 'notice', impact: 'low' }))).toBe('low');
    expect(getImpactLevel(makeCheck({ severity: 'pass', impact: 'high' }))).toBe('none');
  });

  it('keeps PCI review notice checks as manual verification', () => {
    const check = makeCheck({
      id: '3p-no-sri',
      category: 'third-party',
      title: 'Third-party scripts missing SRI',
    });

    expect(getImpactLevel(check)).toBe('manual');
  });
});
