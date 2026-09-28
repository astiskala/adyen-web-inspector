import { describe, expect, it } from 'vitest';
import { buildFindingProjection, buildReportExportData } from '../../../src/shared/export-report';
import type { CheckResult, ScanResult } from '../../../src/shared/types';
import { makeScanPayload, makeScanResult } from '../../fixtures/makeScanPayload';

function makeCheck(overrides: Partial<CheckResult>): CheckResult {
  return {
    id: 'auth-country-code',
    category: 'auth',
    severity: 'fail',
    title: 'Country code missing',
    ...overrides,
  };
}

function makeResult(checks: CheckResult[] = []): ScanResult {
  return makeScanResult({
    pageUrl: 'https://merchant.example/checkout',
    checks,
    health: { score: 50, passing: 1, failing: 1, warnings: 0, total: 2, tier: 'critical' },
    payload: makeScanPayload({
      capturedRequests: [
        {
          url: 'https://merchant.example/checkout',
          type: 'main_frame',
          statusCode: 200,
          responseHeaders: [],
        },
        {
          url: 'https://merchant.example/metrics',
          type: 'other',
          statusCode: 200,
          responseHeaders: [],
        },
        {
          url: 'https://checkoutshopper-test.adyen.com/collect',
          type: 'other',
          statusCode: 200,
          responseHeaders: [],
        },
        { url: 'not a URL', type: 'other', statusCode: 0, responseHeaders: [] },
      ],
    }),
  });
}

describe('buildFindingProjection', () => {
  it('groups Best Practices and Security findings by shared impact and severity order', () => {
    const result = makeResult([
      makeCheck({
        id: 'callback-multiple-submissions',
        category: 'callbacks',
        severity: 'notice',
        title: 'Manual review',
      }),
      makeCheck({
        id: 'security-sri-css',
        category: 'security',
        severity: 'warn',
        title: 'SRI warning',
        impact: 'high',
      }),
      makeCheck({ id: 'auth-locale', severity: 'warn', title: 'Locale warning' }),
      makeCheck({ id: 'auth-country-code', severity: 'fail', title: 'Country failure' }),
      makeCheck({
        id: 'security-https',
        category: 'security',
        severity: 'pass',
        title: 'Zulu pass',
      }),
      makeCheck({
        id: 'security-csp-present',
        category: 'security',
        severity: 'pass',
        title: 'Alpha pass',
      }),
      makeCheck({ id: 'sdk-flavor', category: 'sdk-identity', severity: 'info', title: 'Flavor' }),
    ]);

    const projection = buildFindingProjection(result);

    expect(
      projection.bestPractices.issueGroups.map((group) => [
        group.impact,
        group.checks.map((check) => check.title),
      ])
    ).toEqual([
      ['high', ['Country failure']],
      ['medium', ['Locale warning']],
      ['manual', ['Manual review']],
    ]);
    expect(
      projection.security.issueGroups.map((group) => [
        group.impact,
        group.checks.map((check) => check.title),
      ])
    ).toEqual([['high', ['SRI warning']]]);
    expect(projection.security.successfulChecks.map((check) => check.title)).toEqual([
      'Alpha pass',
      'Zulu pass',
    ]);
    expect(projection.bestPractices.successfulChecks).toEqual([]);
    expect(buildReportExportData(result).security.issues.map((issue) => issue.title)).toEqual([
      'SRI warning',
    ]);
  });

  it('shares network filtering, raw config and skipped reasons with exported reports', () => {
    const result = makeResult([
      makeCheck({
        id: '3p-no-sri',
        category: 'third-party',
        severity: 'skip',
        title: 'Third-party SRI — No scripts found.',
        detail: 'Review manually.',
      }),
      makeCheck({
        id: 'env-cdn-mismatch',
        category: 'environment',
        severity: 'skip',
        title: 'CDN mismatch — No assets loaded.',
      }),
      makeCheck({
        id: 'risk-df-iframe',
        category: 'risk',
        severity: 'skip',
        title: 'No detail or separator',
      }),
    ]);

    const projection = buildFindingProjection(result);
    const exported = buildReportExportData(result);

    expect(projection.skippedChecks.map((check) => [check.title, check.reason])).toEqual([
      ['Third-party SRI', 'Review manually.'],
      ['CDN mismatch', 'No assets loaded.'],
      ['No detail or separator', '—'],
    ]);
    expect(projection.skippedChecks).toEqual(exported.skippedChecks);
    expect(projection.network.capturedRequests.map((request) => request.url)).toEqual([
      'https://merchant.example/checkout',
      'https://checkoutshopper-test.adyen.com/collect',
    ]);
    expect(projection.network).toEqual(exported.network);
    expect(projection.rawConfig).toEqual(exported.rawConfig);
  });
});
