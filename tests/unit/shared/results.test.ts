import { describe, it, expect } from 'vitest';
import { getImpactLabel, getImpactLevel, getRemediationText } from '../../../src/shared/results';
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
    expect(getImpactLabel(check)).toBe('Low impact');
  });

  it('keeps heuristic notice checks as manual verification', () => {
    const check = makeCheck({
      id: 'callback-multiple-submissions',
      category: 'callbacks',
      title: 'Multiple submissions notice',
    });

    expect(getImpactLevel(check)).toBe('manual');
    expect(getImpactLabel(check)).toBe('Manual verification');
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
    expect(getImpactLabel(check)).toBe('Manual verification');
  });
});

describe('getImpactLabel for non-issues', () => {
  it.each([
    ['pass', 'No impact'],
    ['skip', 'Not applicable'],
    ['info', 'Informational'],
  ] as const)('labels %s results as %s', (severity, label) => {
    expect(getImpactLabel(makeCheck({ severity }))).toBe(label);
  });
});

describe('getRemediationText', () => {
  it.each([
    ['AdyenCheckout({ locale: "en-US" })', 'Update your AdyenCheckout configuration.'],
    ['Content-Security-Policy: frame-src *', 'Update your Content-Security-Policy header'],
    ['X-Frame-Options: DENY', 'Set this response header on the checkout page'],
    ['<script src="adyen.js" integrity="sha384-x">', 'Update your markup'],
  ])('frames the remediation example %s for readers', (remediation, prefix) => {
    const check = makeCheck({ severity: 'warn', remediation });

    expect(getRemediationText(check, { friendly: true })).toContain(prefix);
    expect(getRemediationText(check)).toBe(remediation);
  });

  it.each([
    [
      { severity: 'fail' },
      'Review this check and align your integration with Adyen best practices.',
    ],
    [
      { severity: 'notice', impact: 'low' },
      'Review this recommendation and align your integration with Adyen best practices.',
    ],
    [
      { severity: 'notice' },
      'Validate this area manually based on your page headers and Adyen setup.',
    ],
    [{ severity: 'pass' }, 'No remediation required.'],
  ] as const)('uses plain default remediation for %o', (overrides, text) => {
    expect(getRemediationText(makeCheck(overrides))).toBe(text);
  });

  it('uses low-impact default remediation for automated notice checks', () => {
    const check = makeCheck({
      id: 'styling-css-custom-props',
      category: 'sdk-identity',
      title: 'Styling notice',
      impact: 'low',
    });

    expect(getRemediationText(check, { friendly: true })).toBe(
      'Review this recommended improvement, apply the change, then rerun the scan.'
    );
  });

  it('uses manual-review default remediation for heuristic notice checks', () => {
    const check = makeCheck({
      id: 'callback-multiple-submissions',
      category: 'callbacks',
      title: 'Multiple submissions notice',
    });

    expect(getRemediationText(check, { friendly: true })).toBe(
      'Review this item manually in your site config and network headers before going live.'
    );
  });
});
