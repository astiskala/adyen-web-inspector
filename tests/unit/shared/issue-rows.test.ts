import { describe, expect, it } from 'vitest';
import { groupIssuesByImpact, type IssueRow } from '../../../src/shared/export-report';
import type { CheckId, CheckResult, Severity } from '../../../src/shared/types';

/** Issue rows in the order every flat view lists them: impact, severity, then title. */
function buildIssueRows(checks: readonly CheckResult[]): IssueRow[] {
  return groupIssuesByImpact(checks).flatMap((group) => group.issues);
}

const ADYEN_WEB_BEST_PRACTICES_DOC = 'https://docs.adyen.com/online-payments/web-best-practices/';

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
function first<T>(arr: readonly T[]): T {
  expect(arr.length).toBeGreaterThan(0);
  const item = arr[0];
  if (item === undefined) {
    throw new Error('Expected array to have at least one element');
  }
  return item;
}

describe('issue rows', () => {
  it('returns an empty array when given no checks', () => {
    expect(buildIssueRows([])).toEqual([]);
  });

  it('filters out pass, info, and skip severities', () => {
    const checks = [
      makeCheck('sdk-detected', 'pass'),
      makeCheck('sdk-flavor', 'info'),
      makeCheck('sdk-import-method', 'skip'),
    ];

    const rows = buildIssueRows(checks);

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

    const rows = buildIssueRows(checks);

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

    const row = first(buildIssueRows([check]));

    expect(row).toEqual({
      id: 'auth-country-code',
      category: 'auth',
      severity: 'fail',
      title: 'Country code missing',
      impact: 'High impact',
      impactLevel: 'high',
      detail: 'No countryCode in config',
      remediation:
        'Update your AdyenCheckout configuration. Example: AdyenCheckout({ countryCode: "US" })',
      docsUrl: 'https://docs.adyen.com/country-code',
    });
  });

  it('sets detail to null when check has no detail', () => {
    const row = first(buildIssueRows([makeCheck('auth-country-code', 'fail')]));

    expect(row.detail).toBeNull();
  });

  it('preserves docsUrl from the check', () => {
    const check = makeCheck('security-https', 'fail', {
      category: 'security',
      docsUrl: 'https://example.com/docs',
    });

    const row = first(buildIssueRows([check]));

    expect(row.docsUrl).toBe('https://example.com/docs');
  });

  it('falls back to the Adyen best-practices docs when the check has no docsUrl', () => {
    const check = makeCheck('security-https', 'fail', { category: 'security' });

    const row = first(buildIssueRows([check]));

    expect(row.docsUrl).toBe(ADYEN_WEB_BEST_PRACTICES_DOC);
  });

  describe('impact levels', () => {
    it('maps fail severity to high impact', () => {
      const row = first(buildIssueRows([makeCheck('auth-country-code', 'fail')]));

      expect(row.impactLevel).toBe('high');
      expect(row.impact).toBe('High impact');
    });

    it('maps warn severity to medium impact by default', () => {
      const row = first(buildIssueRows([makeCheck('auth-locale', 'warn')]));

      expect(row.impactLevel).toBe('medium');
      expect(row.impact).toBe('Medium impact');
    });

    it('maps warn severity to high impact when the check sets high impact', () => {
      const check = makeCheck('security-sri-css', 'warn', { category: 'security', impact: 'high' });

      const row = first(buildIssueRows([check]));

      expect(row.impactLevel).toBe('high');
      expect(row.impact).toBe('High impact');
    });

    it('maps configured notice severity to low impact', () => {
      const check = makeCheck('styling-css-custom-props', 'notice', { impact: 'low' });

      const row = first(buildIssueRows([check]));

      expect(row.impactLevel).toBe('low');
      expect(row.impact).toBe('Low impact');
    });

    it('maps heuristic notice severity to manual impact', () => {
      const check = makeCheck('callback-multiple-submissions', 'notice', {
        category: 'callbacks',
      });

      const row = first(buildIssueRows([check]));

      expect(row.impactLevel).toBe('manual');
      expect(row.impact).toBe('Manual verification');
    });

    it('maps PCI review notice severity to manual impact', () => {
      const check = makeCheck('3p-no-sri', 'notice', {
        category: 'third-party',
      });

      const row = first(buildIssueRows([check]));

      expect(row.impactLevel).toBe('manual');
      expect(row.impact).toBe('Manual verification');
    });
  });

  describe('sorting', () => {
    it('sorts by impact rank: high before medium before low before manual', () => {
      const checks = [
        makeCheck('callback-multiple-submissions', 'notice', {
          category: 'callbacks',
          title: 'Manual check',
        }),
        makeCheck('auth-locale', 'warn', { title: 'Medium warning' }),
        makeCheck('auth-country-code', 'fail', { title: 'High failure' }),
        makeCheck('styling-css-custom-props', 'notice', {
          title: 'Low notice',
          impact: 'low',
        }),
      ];

      const rows = buildIssueRows(checks);

      expect(rows.map((r) => r.impactLevel)).toEqual(['high', 'medium', 'low', 'manual']);
    });

    it('sorts by severity within the same impact level', () => {
      // Both fail and high-priority warn map to 'high' impact
      const checks = [
        makeCheck('security-sri-css', 'warn', {
          category: 'security',
          title: 'SRI warning (high prio)',
          impact: 'high',
        }),
        makeCheck('auth-country-code', 'fail', { title: 'Country code fail' }),
      ];

      const rows = buildIssueRows(checks);

      // fail (severity rank 0) before warn (severity rank 1), both 'high' impact
      expect(rows.map((r) => r.title)).toEqual(['Country code fail', 'SRI warning (high prio)']);
    });

    it('sorts a low-impact warning before a low-impact notice', () => {
      const checks = [
        makeCheck('styling-css-custom-props', 'notice', { title: 'A notice', impact: 'low' }),
        makeCheck('security-csp-img-src', 'warn', { title: 'B warning', impact: 'low' }),
      ];

      const rows = buildIssueRows(checks);

      expect(rows.map((r) => r.title)).toEqual(['B warning', 'A notice']);
    });

    it('sorts by title alphabetically when impact and severity are identical', () => {
      const checks = [
        makeCheck('callback-on-payment-failed', 'warn', { title: 'Zulu callback' }),
        makeCheck('callback-on-payment-completed', 'warn', { title: 'Alpha callback' }),
        makeCheck('auth-locale', 'warn', { title: 'Mike locale' }),
      ];

      const rows = buildIssueRows(checks);

      expect(rows.map((r) => r.title)).toEqual(['Alpha callback', 'Mike locale', 'Zulu callback']);
    });

    it('applies all three sort tiers together', () => {
      const checks = [
        // manual (notice)
        makeCheck('callback-multiple-submissions', 'notice', {
          category: 'callbacks',
          title: 'Manual notice',
        }),
        // low (notice)
        makeCheck('styling-css-custom-props', 'notice', {
          title: 'Styling notice',
          impact: 'low',
        }),
        // medium (warn, default priority)
        makeCheck('auth-locale', 'warn', { title: 'Locale warn' }),
        // high (fail)
        makeCheck('auth-country-code', 'fail', { title: 'Country fail' }),
        // high (warn, high priority)
        makeCheck('risk-df-iframe', 'warn', {
          category: 'risk',
          title: 'DF iframe warn',
          impact: 'high',
        }),
        // medium (warn, default priority)
        makeCheck('callback-on-payment-completed', 'warn', {
          title: 'Completed callback warn',
        }),
        // high (fail)
        makeCheck('security-https', 'fail', { category: 'security', title: 'HTTPS fail' }),
      ];

      const rows = buildIssueRows(checks);

      expect(rows.map((r) => r.title)).toEqual([
        // high: fails first (alphabetical)
        'Country fail',
        'HTTPS fail',
        // high: warns second
        'DF iframe warn',
        // medium: warns (alphabetical)
        'Completed callback warn',
        'Locale warn',
        // low: notices
        'Styling notice',
        // manual: notices
        'Manual notice',
      ]);
    });
  });

  describe('friendly remediation', () => {
    it('wraps AdyenCheckout remediation in friendly text', () => {
      const check = makeCheck('auth-country-code', 'fail', {
        remediation: 'AdyenCheckout({ countryCode: "US" })',
      });

      const row = first(buildIssueRows([check]));

      expect(row.remediation).toBe(
        'Update your AdyenCheckout configuration. Example: AdyenCheckout({ countryCode: "US" })'
      );
    });

    it('keeps plain remediation text unchanged', () => {
      const check = makeCheck('auth-country-code', 'fail', {
        remediation: 'Set countryCode in your checkout configuration.',
      });

      const row = first(buildIssueRows([check]));

      expect(row.remediation).toBe('Set countryCode in your checkout configuration.');
    });

    it('returns friendly default remediation for fail without remediation text', () => {
      const row = first(buildIssueRows([makeCheck('auth-country-code', 'fail')]));

      expect(row.remediation).toBe(
        'Follow the linked Adyen guidance, apply the configuration change, then rerun the scan.'
      );
    });

    it('returns friendly default remediation for notice without remediation text', () => {
      const check = makeCheck('styling-css-custom-props', 'notice', { impact: 'low' });

      const row = first(buildIssueRows([check]));

      expect(row.remediation).toBe(
        'Review this recommended improvement, apply the change, then rerun the scan.'
      );
    });

    it('returns manual-review default remediation for heuristic notice without remediation text', () => {
      const check = makeCheck('callback-multiple-submissions', 'notice', {
        category: 'callbacks',
      });

      const row = first(buildIssueRows([check]));

      expect(row.remediation).toBe(
        'Review this item manually in your site config and network headers before going live.'
      );
    });

    it('wraps CSP header remediation in friendly text', () => {
      const check = makeCheck('security-csp-present', 'warn', {
        category: 'security',
        remediation: 'Content-Security-Policy: script-src https://checkoutshopper-live.adyen.com',
      });

      const row = first(buildIssueRows([check]));

      expect(row.remediation).toContain('Update your Content-Security-Policy header');
    });

    it('wraps markup remediation in friendly text', () => {
      const check = makeCheck('security-sri-script', 'fail', {
        category: 'security',
        remediation: '<script src="adyen.js" integrity="sha384-x" crossorigin="anonymous">',
      });

      const row = first(buildIssueRows([check]));

      expect(row.remediation).toContain('Update your markup to match this secure example');
    });

    it('wraps generic header remediation in friendly text', () => {
      const check = makeCheck('security-referrer-policy', 'warn', {
        category: 'security',
        remediation: 'Referrer-Policy: strict-origin-when-cross-origin',
      });

      const row = first(buildIssueRows([check]));

      expect(row.remediation).toContain('Set this response header on the checkout page');
    });
  });

  it('preserves explicit docsUrl over the Adyen docs fallback', () => {
    const check = makeCheck('auth-country-code', 'fail', {
      docsUrl: 'https://example.com/specific-docs',
    });

    const row = first(buildIssueRows([check]));

    expect(row.docsUrl).toBe('https://example.com/specific-docs');
  });
});
