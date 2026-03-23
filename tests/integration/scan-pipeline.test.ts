/**
 * Integration tests for the scan pipeline.
 *
 * These tests exercise the full cross-module flow:
 *   ScanPayload → ALL_CHECKS → health score → standard compliance
 *
 * Unlike unit tests (which test individual checks in isolation), these verify
 * that modules compose correctly and produce coherent end-to-end results.
 */

import { describe, it, expect } from 'vitest';
import { ALL_CHECKS } from '../../src/background/checks/index';
import { calculateHealthScore } from '../../src/shared/health';
import { computeStandardCompliance } from '../../src/shared/standard-compliance';
import type { CheckResult, ScanPayload } from '../../src/shared/types';
import {
  makeAdyenPayload,
  makeHeader,
  makeRequest,
  makeScanPayload,
  makePageExtract,
  makeAdyenMetadata,
  makeCheckoutConfig,
  makeVersionInfo,
} from '../fixtures/makeScanPayload';

function runPipeline(payload: ScanPayload): {
  checks: CheckResult[];
  health: ReturnType<typeof calculateHealthScore>;
  compliance: ReturnType<typeof computeStandardCompliance>;
} {
  const checks = ALL_CHECKS.map((check) => check.run(payload));
  const health = calculateHealthScore(checks);
  const compliance = computeStandardCompliance(checks, payload);
  return { checks, health, compliance };
}

describe('Scan pipeline integration', () => {
  it('runs all registered checks against a payload', () => {
    const payload = makeAdyenPayload();
    const { checks } = runPipeline(payload);

    expect(checks.length).toBe(ALL_CHECKS.length);
    for (const result of checks) {
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('severity');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('title');
    }
  });

  it('produces valid health score structure', () => {
    const payload = makeAdyenPayload();
    const { health } = runPipeline(payload);

    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
    expect(health.passing + health.failing + health.warnings).toBe(health.total);
    expect(['excellent', 'issues', 'critical']).toContain(health.tier);
  });

  it('produces valid standard compliance structure', () => {
    const payload = makeAdyenPayload();
    const { compliance } = runPipeline(payload);

    expect(typeof compliance.compliant).toBe('boolean');
    expect(Array.isArray(compliance.reasons)).toBe(true);
  });

  it('every check ID is unique', () => {
    const payload = makeAdyenPayload();
    const { checks } = runPipeline(payload);
    const ids = checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every check severity is a known value', () => {
    const payload = makeAdyenPayload();
    const { checks } = runPipeline(payload);
    const validSeverities = new Set(['pass', 'warn', 'fail', 'notice', 'info', 'skip']);
    for (const result of checks) {
      expect(validSeverities.has(result.severity)).toBe(true);
    }
  });
});

function makeGoodPayload(): ScanPayload {
  const cspValue =
    "default-src 'self'; " +
    "script-src 'self' https://checkoutshopper-live.adyen.com; " +
    'frame-src https://checkoutshopper-live.adyen.com; ' +
    "frame-ancestors 'self'; " +
    'report-uri /csp-report';

  return makeScanPayload({
    pageUrl: 'https://merchant.com/checkout',
    page: makePageExtract({
      adyenMetadata: makeAdyenMetadata({
        version: '6.5.0',
        bundleType: 'esm',
        variants: ['dropin'],
      }),
      checkoutConfig: makeCheckoutConfig({
        clientKey: 'live_ABCDEFGHIJK',
        environment: 'live',
        locale: 'en-US',
        countryCode: 'US',
        onSubmit: 'checkout',
        onAdditionalDetails: 'checkout',
        onPaymentCompleted: 'checkout',
        onPaymentFailed: 'checkout',
        onError: 'checkout',
        hasSession: true,
      }),
      hasDropinDOM: true,
      pageUrl: 'https://merchant.com/checkout',
      pageProtocol: 'https:',
      scripts: [
        {
          src: 'https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/6.5.0/adyen.js',
          integrity: 'sha384-abc123',
          crossorigin: 'anonymous',
        },
      ],
      links: [
        {
          href: 'https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/6.5.0/adyen.css',
          rel: 'stylesheet',
          integrity: 'sha384-def456',
          crossorigin: 'anonymous',
        },
      ],
      iframes: [{ name: 'dfIframe' }],
    }),
    mainDocumentHeaders: [
      makeHeader('content-security-policy', cspValue),
      makeHeader('strict-transport-security', 'max-age=31536000; includeSubDomains'),
      makeHeader('x-content-type-options', 'nosniff'),
      makeHeader('referrer-policy', 'strict-origin-when-cross-origin'),
    ],
    capturedRequests: [
      makeRequest('https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/6.5.0/adyen.js', {
        type: 'script',
        statusCode: 200,
      }),
    ],
    versionInfo: makeVersionInfo({ detected: '6.5.0', latest: '6.5.0' }),
    analyticsData: {
      flavor: 'dropin',
      version: '6.5.0',
      buildType: 'esm',
    },
  });
}

describe('Well-configured integration', () => {
  it('achieves high health score with well-configured setup', () => {
    const { health } = runPipeline(makeGoodPayload());

    expect(health.score).toBeGreaterThanOrEqual(70);
    expect(health.failing).toBe(0);
  });

  it('achieves standard compliance with sessions + dropin + latest', () => {
    const { compliance } = runPipeline(makeGoodPayload());

    expect(compliance.compliant).toBe(true);
    expect(compliance.reasons).toHaveLength(0);
  });
});

describe('Misconfigured integration', () => {
  it('produces failures for HTTP page on live environment', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'live', clientKey: 'live_ABCDEFGHIJK' },
      {
        pageUrl: 'http://insecure.example.com',
        page: makePageExtract({
          pageUrl: 'http://insecure.example.com',
          pageProtocol: 'http:',
          adyenMetadata: makeAdyenMetadata(),
          checkoutConfig: makeCheckoutConfig({
            environment: 'live',
            clientKey: 'live_ABCDEFGHIJK',
          }),
        }),
        capturedRequests: [
          makeRequest(
            'https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/5.67.0/adyen.js',
            {
              type: 'script',
              statusCode: 200,
            }
          ),
        ],
      }
    );

    const { checks, health } = runPipeline(payload);
    const httpsCheck = checks.find((c) => c.id === 'security-https');
    expect(httpsCheck?.severity).toBe('fail');
    expect(health.tier).toBe('critical');
  });

  it('produces non-compliance for advanced flow without dropin', () => {
    const payload = makeAdyenPayload(
      { variants: ['card'] },
      { onSubmit: 'checkout', hasSession: false },
      {
        versionInfo: makeVersionInfo({ detected: '5.0.0', latest: '6.5.0' }),
        analyticsData: { flavor: 'components', version: '5.0.0' },
      }
    );

    const { compliance } = runPipeline(payload);
    expect(compliance.compliant).toBe(false);
    expect(compliance.reasons.length).toBeGreaterThan(0);
  });

  it('flags missing client key', () => {
    const payload = makeAdyenPayload({}, { clientKey: undefined });

    const { checks } = runPipeline(payload);
    const authCheck = checks.find((c) => c.id === 'auth-client-key');
    expect(authCheck).toBeDefined();
    expect(authCheck?.severity).not.toBe('pass');
  });

  it('flags environment/key mismatch (test key with live API requests)', () => {
    const payload = makeAdyenPayload(
      {},
      { clientKey: 'test_ABCDEFGHIJK', environment: 'live' },
      {
        capturedRequests: [
          makeRequest('https://checkoutanalytics-live.adyen.com/checkoutanalytics/v3/setup', {
            type: 'other',
            statusCode: 200,
          }),
        ],
      }
    );

    const { checks } = runPipeline(payload);
    const mismatch = checks.find((c) => c.id === 'env-key-mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe('fail');
  });
});

describe('Health score tiers from check results', () => {
  it('returns critical tier when any check fails', () => {
    const payload = makeScanPayload({
      pageUrl: 'http://insecure.test',
      page: makePageExtract({
        pageUrl: 'http://insecure.test',
        pageProtocol: 'http:',
        adyenMetadata: makeAdyenMetadata(),
        checkoutConfig: makeCheckoutConfig(),
      }),
    });

    const { health } = runPipeline(payload);
    expect(health.tier).toBe('critical');
  });

  it('tier is consistent with failing/warning counts', () => {
    const payload = makeAdyenPayload();
    const { health } = runPipeline(payload);

    if (health.failing > 0) {
      expect(health.tier).toBe('critical');
    } else if (health.warnings > 0) {
      expect(health.tier).toBe('issues');
    } else {
      expect(health.tier).toBe('excellent');
    }
  });
});

describe('Version detection cascade', () => {
  it('reports detected version as info when available', () => {
    const payload = makeAdyenPayload(
      { version: '5.50.0' },
      {},
      { versionInfo: makeVersionInfo({ detected: '5.50.0', latest: '6.5.0' }) }
    );

    const { checks } = runPipeline(payload);
    const versionDetected = checks.find((c) => c.id === 'version-detected');
    expect(versionDetected?.severity).toBe('info');
    expect(versionDetected?.title).toContain('5.50.0');
  });

  it('reports missing version when none detected', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ adyenMetadata: { bundleType: 'esm', variants: ['dropin'] } }),
      versionInfo: makeVersionInfo({ detected: null }),
    });

    const { checks } = runPipeline(payload);
    const versionDetected = checks.find((c) => c.id === 'version-detected');
    expect(versionDetected?.severity).not.toBe('pass');
  });
});
