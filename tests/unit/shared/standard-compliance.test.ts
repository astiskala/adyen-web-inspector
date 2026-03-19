import { describe, it, expect } from 'vitest';
import { computeStandardCompliance } from '../../../src/shared/standard-compliance';
import type { CheckResult } from '../../../src/shared/types';
import {
  makeScanPayload,
  makePageExtract,
  makeCheckoutConfig,
  makeAnalyticsData,
  makeVersionInfo,
} from '../../fixtures/makeScanPayload';

function makeVersionCheck(severity: CheckResult['severity']): CheckResult {
  return {
    id: 'version-latest',
    category: 'version-lifecycle',
    severity,
    title: severity === 'pass' ? 'Running the latest version.' : 'Not on the latest version.',
  };
}

describe('computeStandardCompliance', () => {
  it('returns compliant when latest version, Sessions flow, and Drop-in', () => {
    const checks = [makeVersionCheck('pass')];
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig({ hasSession: true }),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin', sessionId: 'session-123' }),
    });

    const result = computeStandardCompliance(checks, payload);

    expect(result.compliant).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('returns non-compliant when version is not latest', () => {
    const checks = [makeVersionCheck('warn')];
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig({ hasSession: true }),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin', sessionId: 'session-123' }),
    });

    const result = computeStandardCompliance(checks, payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toContain('Not using the latest SDK version.');
  });

  it('returns non-compliant when not using Sessions flow', () => {
    const checks = [makeVersionCheck('pass')];
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig(),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin' }),
    });

    const result = computeStandardCompliance(checks, payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toContain('Not using Sessions flow.');
  });

  it('returns non-compliant when not using Drop-in', () => {
    const checks = [makeVersionCheck('pass')];
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig({ hasSession: true }),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'components', sessionId: 'session-123' }),
    });

    const result = computeStandardCompliance(checks, payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toContain('Not using Drop-in.');
  });

  it('returns all three reasons when none of the criteria are met', () => {
    const checks = [makeVersionCheck('notice')];
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig(),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'components' }),
    });

    const result = computeStandardCompliance(checks, payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toHaveLength(3);
    expect(result.reasons).toContain('Not using the latest SDK version.');
    expect(result.reasons).toContain('Not using Sessions flow.');
    expect(result.reasons).toContain('Not using Drop-in.');
  });

  it('returns non-compliant when version-latest check is missing', () => {
    const checks: CheckResult[] = [];
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig({ hasSession: true }),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin', sessionId: 'session-123' }),
    });

    const result = computeStandardCompliance(checks, payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toContain('Not using the latest SDK version.');
  });

  it('detects Drop-in from DOM presence when analytics not available', () => {
    const checks = [makeVersionCheck('pass')];
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig({ hasSession: true }),
        hasDropinDOM: true,
      }),
      versionInfo: makeVersionInfo({ detected: '6.0.0', latest: '6.0.0' }),
    });

    const result = computeStandardCompliance(checks, payload);

    expect(result.compliant).toBe(true);
  });
});
