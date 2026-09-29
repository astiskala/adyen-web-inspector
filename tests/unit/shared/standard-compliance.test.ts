import { describe, it, expect } from 'vitest';
import { readImplementationAttributes } from '../../../src/shared/implementation-attributes';
import { computeStandardCompliance } from '../../../src/shared/standard-compliance';
import type { ScanPayload } from '../../../src/shared/types';
import {
  makeScanPayload,
  makeCheckoutPage,
  makeCheckoutConfig,
  makeAnalyticsData,
  makeVersionInfo,
  makeCapturedConfig,
} from '../../fixtures/makeScanPayload';

function assess(payload: ScanPayload): ReturnType<typeof computeStandardCompliance> {
  return computeStandardCompliance(
    payload.versionInfo.detected,
    readImplementationAttributes(payload)
  );
}

describe('computeStandardCompliance', () => {
  it('returns aligned when minimum version, Sessions flow, and Drop-in are detected', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig(makeCheckoutConfig({ hasSession: true })),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin', sessionId: 'session-123' }),
      versionInfo: makeVersionInfo({ detected: '6.30.0' }),
    });

    const result = assess(payload);

    expect(result.compliant).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('accepts a newer version without requiring the exact latest release', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig(makeCheckoutConfig({ hasSession: true })),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin', sessionId: 'session-123' }),
      versionInfo: makeVersionInfo({ detected: '6.31.1', latest: '6.32.0' }),
    });

    const result = assess(payload);

    expect(result.compliant).toBe(true);
  });

  it('returns not aligned when the version is below the documented minimum', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig(makeCheckoutConfig({ hasSession: true })),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin', sessionId: 'session-123' }),
      versionInfo: makeVersionInfo({ detected: '6.29.0' }),
    });

    const result = assess(payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toContain('Web Drop-in 6.30.0 or later is required.');
  });

  it('returns not aligned when not using Sessions flow', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig(makeCheckoutConfig()),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin' }),
      versionInfo: makeVersionInfo({ detected: '6.30.0' }),
    });

    const result = assess(payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toContain('Not using Sessions flow.');
  });

  it('returns not aligned when not using Drop-in', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig(makeCheckoutConfig({ hasSession: true })),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'components', sessionId: 'session-123' }),
      versionInfo: makeVersionInfo({ detected: '6.30.0' }),
    });

    const result = assess(payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toContain('Not using Drop-in.');
  });

  it('returns all three reasons when none of the criteria are met', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig(makeCheckoutConfig()),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'components' }),
      versionInfo: makeVersionInfo({ detected: '6.29.0' }),
    });

    const result = assess(payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toHaveLength(3);
    expect(result.reasons).toContain('Web Drop-in 6.30.0 or later is required.');
    expect(result.reasons).toContain('Not using Sessions flow.');
    expect(result.reasons).toContain('Not using Drop-in.');
  });

  it('returns not aligned when the SDK version cannot be verified', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig(makeCheckoutConfig({ hasSession: true })),
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin', sessionId: 'session-123' }),
      versionInfo: makeVersionInfo({ detected: null }),
    });

    const result = assess(payload);

    expect(result.compliant).toBe(false);
    expect(result.reasons).toContain('Web Drop-in 6.30.0 or later could not be verified.');
  });

  it('detects Drop-in from DOM presence when analytics not available', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        capturedConfig: makeCapturedConfig(makeCheckoutConfig({ hasSession: true })),
        hasDropinDOM: true,
      }),
      versionInfo: makeVersionInfo({ detected: '6.30.0', latest: '6.30.0' }),
    });

    const result = assess(payload);

    expect(result.compliant).toBe(true);
  });
});
