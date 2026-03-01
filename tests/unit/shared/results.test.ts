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

describe('getImpactLevel', () => {
  it('returns none for pass severity', () => {
    expect(getImpactLevel(makeCheck({ severity: 'pass' }))).toBe('none');
  });

  it('returns none for info severity', () => {
    expect(getImpactLevel(makeCheck({ severity: 'info' }))).toBe('none');
  });

  it('returns none for skip severity', () => {
    expect(getImpactLevel(makeCheck({ severity: 'skip' }))).toBe('none');
  });
});

describe('getImpactLabel', () => {
  it('returns No impact for pass severity', () => {
    expect(getImpactLabel(makeCheck({ severity: 'pass' }))).toBe('No impact');
  });

  it('returns Not applicable for skip severity', () => {
    expect(getImpactLabel(makeCheck({ severity: 'skip' }))).toBe('Not applicable');
  });

  it('returns Informational for info severity', () => {
    expect(getImpactLabel(makeCheck({ severity: 'info' }))).toBe('Informational');
  });

  it('returns Manual verification needed for notice severity', () => {
    expect(getImpactLabel(makeCheck({ severity: 'notice' }))).toBe('Manual verification needed');
  });
});

describe('getRemediationText', () => {
  it('returns no-remediation fallback for pass severity with no remediation', () => {
    const check = makeCheck({ severity: 'pass' });
    expect(getRemediationText(check)).toBe('No remediation required.');
  });

  it('returns raw remediation text when not friendly', () => {
    const check = makeCheck({ severity: 'fail', remediation: '<script src="fixed.js"></script>' });
    expect(getRemediationText(check)).toBe('<script src="fixed.js"></script>');
  });

  it('returns friendly markup remediation for script tag', () => {
    const check = makeCheck({ severity: 'warn', remediation: '<script src="fixed.js"></script>' });
    expect(getRemediationText(check, { friendly: true })).toContain(
      'Update your markup to match this secure example'
    );
  });

  it('returns friendly markup remediation for link tag', () => {
    const check = makeCheck({
      severity: 'warn',
      remediation: '<link rel="preload" href="sdk.js">',
    });
    expect(getRemediationText(check, { friendly: true })).toContain(
      'Update your markup to match this secure example'
    );
  });

  it('returns friendly markup remediation for iframe tag', () => {
    const check = makeCheck({
      severity: 'warn',
      remediation: '<iframe src="https://example.com"></iframe>',
    });
    expect(getRemediationText(check, { friendly: true })).toContain(
      'Update your markup to match this secure example'
    );
  });

  it('returns non-friendly raw text for unknown format', () => {
    const check = makeCheck({ severity: 'fail', remediation: 'Some plain text.' });
    expect(getRemediationText(check, { friendly: true })).toBe('Some plain text.');
  });

  it('returns non-friendly default for warn with no remediation', () => {
    const check = makeCheck({ severity: 'warn' });
    expect(getRemediationText(check)).toBe(
      'Review this check and align your integration with Adyen best practices.'
    );
  });

  it('returns friendly default for notice with no remediation', () => {
    const check = makeCheck({ severity: 'notice' });
    expect(getRemediationText(check, { friendly: true })).toBe(
      'Review this item manually in your site config and network headers before going live.'
    );
  });

  it('returns non-friendly default for notice with no remediation', () => {
    const check = makeCheck({ severity: 'notice' });
    expect(getRemediationText(check)).toBe(
      'Validate this area manually based on your page headers and Adyen setup.'
    );
  });

  it('returns friendly default for fail with no remediation', () => {
    const check = makeCheck({ severity: 'fail' });
    expect(getRemediationText(check, { friendly: true })).toBe(
      'Follow the linked Adyen guidance, apply the configuration change, then rerun the scan.'
    );
  });
});

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
