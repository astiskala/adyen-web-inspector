import { describe, it, expect } from 'vitest';
import { ADYEN_WEB_BEST_PRACTICES_DOC } from '../../../src/shared/check-config';
import {
  getImpactLabel,
  getImpactLevel,
  getRecommendedDocsUrl,
  getRemediationText,
} from '../../../src/shared/results';
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

describe('getRecommendedDocsUrl', () => {
  it('keeps explicit external docs when preferAdyenDocs is true', () => {
    const check = makeCheck({
      docsUrl: 'https://owasp.org/www-project-secure-headers/#referrer-policy',
    });

    expect(getRecommendedDocsUrl(check, true)).toBe(check.docsUrl);
  });

  it('falls back to Adyen best-practices docs when docsUrl is missing', () => {
    const check = makeCheck();

    expect(getRecommendedDocsUrl(check, true)).toBe(ADYEN_WEB_BEST_PRACTICES_DOC);
  });

  it('returns null when docsUrl is missing and preferAdyenDocs is false', () => {
    const check = makeCheck();

    expect(getRecommendedDocsUrl(check, false)).toBeNull();
  });
});

describe('notice impact mapping', () => {
  it('maps low-impact notice checks to low impact labels', () => {
    const check = makeCheck({
      id: 'styling-css-custom-props',
      category: 'sdk-identity',
      title: 'Styling notice',
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
    expect(getImpactLabel(check)).toBe('Manual verification needed');
  });

  it('keeps PCI review notice checks as manual verification', () => {
    const check = makeCheck({
      id: '3p-no-sri',
      category: 'third-party',
      title: 'Third-party scripts missing SRI',
    });

    expect(getImpactLevel(check)).toBe('manual');
    expect(getImpactLabel(check)).toBe('Manual verification needed');
  });
});

describe('getRemediationText', () => {
  it('uses low-impact default remediation for automated notice checks', () => {
    const check = makeCheck({
      id: 'styling-css-custom-props',
      category: 'sdk-identity',
      title: 'Styling notice',
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
