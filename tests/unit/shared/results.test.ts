import { describe, it, expect } from 'vitest';
import { ADYEN_WEB_BEST_PRACTICES_DOC } from '../../../src/shared/check-config';
import { getRecommendedDocsUrl } from '../../../src/shared/results';
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
