import { describe, expect, it } from 'vitest';
import { buildIssueExportRows } from '../../../src/shared/export-utils';
import { ADYEN_WEB_BEST_PRACTICES_DOC } from '../../../src/shared/check-config';
import type { CheckId, CheckResult, Severity } from '../../../src/shared/types';

function makeCheck(
  id: CheckId,
  severity: Severity,
  overrides: Partial<CheckResult> = {}
): CheckResult {
  return {
    id,
    category: 'sdk-identity',
    severity,
    title: `Test check ${id}`,
    ...overrides,
  };
}

/** Asserts that the array has at least one element and returns the first. */
function first<T>(arr: T[]): T {
  expect(arr.length).toBeGreaterThan(0);
  const item = arr[0];
  if (item === undefined) {
    throw new Error('Expected array to have at least one element');
  }
  return item;
}

describe('buildIssueExportRows', () => {
  it('returns an empty array when given no checks', () => {
    expect(buildIssueExportRows([])).toEqual([]);
  });

  it('filters out pass, info, and skip severities', () => {
    const checks = [
      makeCheck('sdk-detected', 'pass'),
      makeCheck('sdk-flavor', 'info'),
      makeCheck('sdk-import-method', 'skip'),
    ];

    const rows = buildIssueExportRows(checks);

    expect(rows).toHaveLength(0);
  });

  it('keeps fail, warn, and notice severities', () => {
    const checks = [
      makeCheck('auth-country-code', 'fail'),
      makeCheck('version-latest', 'warn'),
      makeCheck('security-referrer-policy', 'notice'),
      makeCheck('sdk-detected', 'pass'),
      makeCheck('sdk-flavor', 'info'),
      makeCheck('sdk-import-method', 'skip'),
    ];

    const rows = buildIssueExportRows(checks);

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.severity)).toEqual(['fail', 'warn', 'notice']);
  });

  it('returns rows with all expected fields', () => {
    const check = makeCheck('auth-country-code', 'fail', {
      category: 'auth',
      title: 'Country code missing',
      detail: 'No countryCode in config',
      remediation: 'AdyenCheckout({ countryCode: "US" })',
      docsUrl: 'https://docs.adyen.com/country-code',
    });

    const row = first(buildIssueExportRows([check]));

    expect(row).toEqual({
      id: 'auth-country-code',
      category: 'auth',
      severity: 'fail',
      title: 'Country code missing',
      impact: 'High impact',
      impactLevel: 'high',
      detail: 'No countryCode in config',
      remediation: 'AdyenCheckout({ countryCode: "US" })',
      docsUrl: 'https://docs.adyen.com/country-code',
    });
  });

  it('sets detail to null when check has no detail', () => {
    const row = first(buildIssueExportRows([makeCheck('auth-country-code', 'fail')]));

    expect(row.detail).toBeNull();
  });

  it('preserves docsUrl from the check', () => {
    const check = makeCheck('security-https', 'fail', {
      category: 'security',
      docsUrl: 'https://example.com/docs',
    });

    const row = first(buildIssueExportRows([check]));

    expect(row.docsUrl).toBe('https://example.com/docs');
  });

  it('returns null docsUrl when check has no docsUrl and preferAdyenDocs is not set', () => {
    const check = makeCheck('security-https', 'fail', { category: 'security' });

    const row = first(buildIssueExportRows([check]));

    expect(row.docsUrl).toBeNull();
  });

  describe('impact levels', () => {
    it('maps fail severity to high impact', () => {
      const row = first(buildIssueExportRows([makeCheck('auth-country-code', 'fail')]));

      expect(row.impactLevel).toBe('high');
      expect(row.impact).toBe('High impact');
    });

    it('maps warn severity to medium impact by default', () => {
      const row = first(buildIssueExportRows([makeCheck('auth-locale', 'warn')]));

      expect(row.impactLevel).toBe('medium');
      expect(row.impact).toBe('Medium impact');
    });

    it('maps warn severity to high impact when check has high warning priority', () => {
      // security-sri-css has 'high' in WARNING_PRIORITY_BY_ID
      const check = makeCheck('security-sri-css', 'warn', { category: 'security' });

      const row = first(buildIssueExportRows([check]));

      expect(row.impactLevel).toBe('high');
      expect(row.impact).toBe('High impact');
    });

    it('maps notice severity to manual impact', () => {
      const check = makeCheck('security-referrer-policy', 'notice', { category: 'security' });

      const row = first(buildIssueExportRows([check]));

      expect(row.impactLevel).toBe('manual');
      expect(row.impact).toBe('Manual verification needed');
    });
  });

  describe('sortByImpact option', () => {
    it('preserves insertion order when sortByImpact is not set', () => {
      const checks = [
        makeCheck('security-referrer-policy', 'notice', {
          category: 'security',
          title: 'Z notice',
        }),
        makeCheck('auth-locale', 'warn', { title: 'A warning' }),
        makeCheck('auth-country-code', 'fail', { title: 'B failure' }),
      ];

      const rows = buildIssueExportRows(checks);

      expect(rows.map((r) => r.title)).toEqual(['Z notice', 'A warning', 'B failure']);
    });

    it('preserves insertion order when sortByImpact is false', () => {
      const checks = [
        makeCheck('security-referrer-policy', 'notice', {
          category: 'security',
          title: 'Z notice',
        }),
        makeCheck('auth-locale', 'warn', { title: 'A warning' }),
        makeCheck('auth-country-code', 'fail', { title: 'B failure' }),
      ];

      const rows = buildIssueExportRows(checks, { sortByImpact: false });

      expect(rows.map((r) => r.title)).toEqual(['Z notice', 'A warning', 'B failure']);
    });

    it('sorts by impact rank: high before medium before low before manual', () => {
      const checks = [
        makeCheck('security-referrer-policy', 'notice', {
          category: 'security',
          title: 'Manual check',
        }),
        makeCheck('auth-locale', 'warn', { title: 'Medium warning' }),
        makeCheck('auth-country-code', 'fail', { title: 'High failure' }),
      ];

      const rows = buildIssueExportRows(checks, { sortByImpact: true });

      expect(rows.map((r) => r.impactLevel)).toEqual(['high', 'medium', 'manual']);
    });

    it('sorts by severity within the same impact level', () => {
      // Both fail and high-priority warn map to 'high' impact
      const checks = [
        makeCheck('security-sri-css', 'warn', {
          category: 'security',
          title: 'SRI warning (high prio)',
        }),
        makeCheck('auth-country-code', 'fail', { title: 'Country code fail' }),
      ];

      const rows = buildIssueExportRows(checks, { sortByImpact: true });

      // fail (severity rank 0) before warn (severity rank 1), both 'high' impact
      expect(rows.map((r) => r.title)).toEqual(['Country code fail', 'SRI warning (high prio)']);
    });

    it('sorts by title alphabetically when impact and severity are identical', () => {
      const checks = [
        makeCheck('callback-on-payment-failed', 'warn', { title: 'Zulu callback' }),
        makeCheck('callback-on-payment-completed', 'warn', { title: 'Alpha callback' }),
        makeCheck('auth-locale', 'warn', { title: 'Mike locale' }),
      ];

      const rows = buildIssueExportRows(checks, { sortByImpact: true });

      expect(rows.map((r) => r.title)).toEqual(['Alpha callback', 'Mike locale', 'Zulu callback']);
    });

    it('applies all three sort tiers together', () => {
      const checks = [
        // manual (notice)
        makeCheck('security-referrer-policy', 'notice', {
          category: 'security',
          title: 'Referrer notice',
        }),
        // medium (warn, default priority)
        makeCheck('auth-locale', 'warn', { title: 'Locale warn' }),
        // high (fail)
        makeCheck('auth-country-code', 'fail', { title: 'Country fail' }),
        // high (warn, high priority)
        makeCheck('risk-df-iframe', 'warn', { category: 'risk', title: 'DF iframe warn' }),
        // medium (warn, default priority)
        makeCheck('callback-on-payment-completed', 'warn', {
          title: 'Completed callback warn',
        }),
        // high (fail)
        makeCheck('security-https', 'fail', { category: 'security', title: 'HTTPS fail' }),
      ];

      const rows = buildIssueExportRows(checks, { sortByImpact: true });

      expect(rows.map((r) => r.title)).toEqual([
        // high: fails first (alphabetical)
        'Country fail',
        'HTTPS fail',
        // high: warns second
        'DF iframe warn',
        // medium: warns (alphabetical)
        'Completed callback warn',
        'Locale warn',
        // manual: notices
        'Referrer notice',
      ]);
    });
  });

  describe('friendlyRemediation option', () => {
    it('returns raw remediation text when friendlyRemediation is not set', () => {
      const check = makeCheck('auth-country-code', 'fail', {
        remediation: 'AdyenCheckout({ countryCode: "US" })',
      });

      const row = first(buildIssueExportRows([check]));

      expect(row.remediation).toBe('AdyenCheckout({ countryCode: "US" })');
    });

    it('returns friendly remediation text when friendlyRemediation is true', () => {
      const check = makeCheck('auth-country-code', 'fail', {
        remediation: 'AdyenCheckout({ countryCode: "US" })',
      });

      const row = first(buildIssueExportRows([check], { friendlyRemediation: true }));

      expect(row.remediation).toBe(
        'Update your AdyenCheckout configuration. Example: AdyenCheckout({ countryCode: "US" })'
      );
    });

    it('returns raw remediation text when friendlyRemediation is false', () => {
      const check = makeCheck('auth-country-code', 'fail', {
        remediation: 'AdyenCheckout({ countryCode: "US" })',
      });

      const row = first(buildIssueExportRows([check], { friendlyRemediation: false }));

      expect(row.remediation).toBe('AdyenCheckout({ countryCode: "US" })');
    });

    it('returns friendly default remediation for fail without remediation text', () => {
      const row = first(
        buildIssueExportRows([makeCheck('auth-country-code', 'fail')], {
          friendlyRemediation: true,
        })
      );

      expect(row.remediation).toBe(
        'Follow the linked Adyen guidance, apply the configuration change, then rerun the scan.'
      );
    });

    it('returns friendly default remediation for notice without remediation text', () => {
      const check = makeCheck('security-referrer-policy', 'notice', { category: 'security' });

      const row = first(buildIssueExportRows([check], { friendlyRemediation: true }));

      expect(row.remediation).toBe(
        'Review this item manually in your site config and network headers before going live.'
      );
    });

    it('wraps CSP header remediation in friendly text', () => {
      const check = makeCheck('security-csp-present', 'warn', {
        category: 'security',
        remediation: 'Content-Security-Policy: script-src https://checkoutshopper-live.adyen.com',
      });

      const row = first(buildIssueExportRows([check], { friendlyRemediation: true }));

      expect(row.remediation).toContain('Update your Content-Security-Policy header');
    });

    it('wraps generic header remediation in friendly text', () => {
      const check = makeCheck('security-referrer-policy', 'warn', {
        category: 'security',
        remediation: 'Referrer-Policy: strict-origin-when-cross-origin',
      });

      const row = first(buildIssueExportRows([check], { friendlyRemediation: true }));

      expect(row.remediation).toContain('Set this response header on the checkout page');
    });
  });

  describe('preferAdyenDocs option', () => {
    it('falls back to Adyen best-practices URL when check has no docsUrl', () => {
      const row = first(
        buildIssueExportRows([makeCheck('auth-country-code', 'fail')], {
          preferAdyenDocs: true,
        })
      );

      expect(row.docsUrl).toBe(ADYEN_WEB_BEST_PRACTICES_DOC);
    });

    it('preserves explicit docsUrl even when preferAdyenDocs is true', () => {
      const check = makeCheck('auth-country-code', 'fail', {
        docsUrl: 'https://example.com/specific-docs',
      });

      const row = first(buildIssueExportRows([check], { preferAdyenDocs: true }));

      expect(row.docsUrl).toBe('https://example.com/specific-docs');
    });

    it('returns null docsUrl when preferAdyenDocs is false and check has no docsUrl', () => {
      const row = first(
        buildIssueExportRows([makeCheck('auth-country-code', 'fail')], {
          preferAdyenDocs: false,
        })
      );

      expect(row.docsUrl).toBeNull();
    });
  });

  describe('combined options', () => {
    it('applies sorting, friendly remediation, and Adyen docs together', () => {
      const checks = [
        makeCheck('security-referrer-policy', 'notice', {
          category: 'security',
          title: 'Referrer notice',
        }),
        makeCheck('auth-country-code', 'fail', {
          title: 'Country fail',
          remediation: 'AdyenCheckout({ countryCode: "NL" })',
        }),
        makeCheck('version-latest', 'warn', { title: 'Version warn' }),
      ];

      const rows = buildIssueExportRows(checks, {
        sortByImpact: true,
        friendlyRemediation: true,
        preferAdyenDocs: true,
      });

      // Sorted: high (fail) -> medium (warn) -> manual (notice)
      expect(rows.map((r) => r.title)).toEqual(['Country fail', 'Version warn', 'Referrer notice']);

      // Friendly remediation applied
      expect(first(rows).remediation).toContain('Update your AdyenCheckout configuration');

      // preferAdyenDocs fallback applied for checks without docsUrl
      expect(rows.every((r) => r.docsUrl === ADYEN_WEB_BEST_PRACTICES_DOC)).toBe(true);
    });
  });
});
