import { describe, it, expect } from 'vitest';
import { SDK_IDENTITY_CHECKS } from '../../../src/background/checks/sdk-identity';
import {
  makeScanPayload,
  makeAdyenPayload,
  makePageExtract,
  makeAdyenMetadata,
  makeAnalyticsData,
  makeCheckoutConfig,
  makeRequest,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const sdkDetected = requireCheck(SDK_IDENTITY_CHECKS, 'sdk-detected');
const sdkFlavor = requireCheck(SDK_IDENTITY_CHECKS, 'sdk-flavor');
const sdkImportMethod = requireCheck(SDK_IDENTITY_CHECKS, 'sdk-import-method');
const sdkBundleType = requireCheck(SDK_IDENTITY_CHECKS, 'sdk-bundle-type');
const sdkAnalytics = requireCheck(SDK_IDENTITY_CHECKS, 'sdk-analytics');
const sdkMultiInit = requireCheck(SDK_IDENTITY_CHECKS, 'sdk-multi-init');

describe('sdk-detected', () => {
  it('returns info when AdyenWebMetadata is present', () => {
    const payload = makeAdyenPayload();
    const result = sdkDetected.run(payload);
    expect(result.severity).toBe('info');
  });

  it('returns info when CDN script src contains checkoutshopper-', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          { src: 'https://checkoutshopper-test.adyen.com/checkoutshopper-sdk/5.67.0/adyen.js' },
        ],
      }),
    });
    const result = sdkDetected.run(payload);
    expect(result.severity).toBe('info');
  });

  it('returns fail when no SDK or CDN script found', () => {
    const payload = makeScanPayload();
    const result = sdkDetected.run(payload);
    expect(result.severity).toBe('fail');
  });
});

describe('sdk-bundle-type', () => {
  it('returns skip when CDN script detected', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          { src: 'https://checkoutshopper-sdk.adyen.com/checkoutshopper-sdk/5.67.0/adyen.js' },
        ],
      }),
    });
    const result = sdkBundleType.run(payload);
    expect(result.severity).toBe('skip');
  });

  it('returns skip when legacy CDN /checkoutshopper/sdk/ script detected', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          {
            src: 'https://checkoutshopper-live-us.adyen.com/checkoutshopper/sdk/6.31.1/adyen.js',
          },
        ],
      }),
    });
    const result = sdkBundleType.run(payload);
    expect(result.severity).toBe('skip');
  });

  it('returns skip when no metadata and no analytics', () => {
    const payload = makeScanPayload();
    const result = sdkBundleType.run(payload);
    expect(result.severity).toBe('skip');
  });

  it('returns warn for auto bundle', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        adyenMetadata: makeAdyenMetadata({ bundleType: 'auto' }),
      }),
    });
    const result = sdkBundleType.run(payload);
    expect(result.severity).toBe('warn');
  });

  it('returns pass for esm bundle', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        adyenMetadata: makeAdyenMetadata({ bundleType: 'esm' }),
      }),
    });
    const result = sdkBundleType.run(payload);
    expect(result.severity).toBe('pass');
  });

  it('returns pass when analytics reports eslegacy buildType (no metadata)', () => {
    const payload = makeScanPayload({
      analyticsData: makeAnalyticsData({ buildType: 'eslegacy' }),
    });
    const result = sdkBundleType.run(payload);
    expect(result.severity).toBe('pass');
    expect(result.title).toContain('eslegacy');
  });

  it('returns warn when analytics reports auto buildType (no metadata)', () => {
    const payload = makeScanPayload({
      analyticsData: makeAnalyticsData({ buildType: 'auto' }),
    });
    const result = sdkBundleType.run(payload);
    expect(result.severity).toBe('warn');
  });

  it('prefers metadata bundleType over analytics buildType', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        adyenMetadata: makeAdyenMetadata({ bundleType: 'esm' }),
      }),
      analyticsData: makeAnalyticsData({ buildType: 'auto' }),
    });
    const result = sdkBundleType.run(payload);
    expect(result.severity).toBe('pass');
    expect(result.title).toContain('esm');
  });
});

describe('sdk-flavor', () => {
  it('reports Drop-in from analytics flavor data', () => {
    const payload = makeAdyenPayload(
      {},
      {},
      {
        analyticsData: makeAnalyticsData({ flavor: 'dropin' }),
      }
    );
    const result = sdkFlavor.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Drop-in');
    expect(result.detail).toContain('analytics');
  });

  it('reports Components from analytics flavor data', () => {
    const payload = makeAdyenPayload(
      {},
      {},
      {
        analyticsData: makeAnalyticsData({ flavor: 'components' }),
      }
    );
    const result = sdkFlavor.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Components');
    expect(result.detail).toContain('analytics');
  });

  it('reports Custom from analytics flavor data', () => {
    const payload = makeAdyenPayload(
      {},
      {},
      {
        analyticsData: makeAnalyticsData({ flavor: 'custom' }),
      }
    );
    const result = sdkFlavor.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Custom');
  });

  it('reports Drop-in when dropin script src is detected (no analytics)', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [{ src: 'https://checkoutshopper-test.adyen.com/dropin/v5/adyen.js' }],
      }),
    });
    const result = sdkFlavor.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Drop-in');
  });

  it('reports Components when checkout config is present (no dropin script, no analytics)', () => {
    const payload = makeAdyenPayload();
    const result = sdkFlavor.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Components');
  });

  it('reports not mounted when SDK is loaded but no checkout activity', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        adyenMetadata: makeAdyenMetadata(),
      }),
    });
    const result = sdkFlavor.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toBe('No Adyen Web checkout was mounted on this page.');
    expect(result.detail).toContain('Navigate to the page');
  });

  it('reports not mounted when CDN script loaded but no checkout activity', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          { src: 'https://checkoutshopper-test.adyen.com/checkoutshopper-sdk/5.67.0/adyen.js' },
        ],
      }),
    });
    const result = sdkFlavor.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toBe('No Adyen Web checkout was mounted on this page.');
  });

  it('does not report not-mounted when SDK loaded with Adyen iframes but no config', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        adyenMetadata: makeAdyenMetadata(),
        iframes: [{ name: 'adyen-card', src: 'https://checkoutshopper-test.adyen.com/card.html' }],
      }),
    });
    const result = sdkFlavor.run(payload);
    // Should NOT say not-mounted, should say Unknown since there is activity but no flavor signal
    expect(result.title).not.toContain('No Adyen Web checkout was mounted');
  });

  it('does not report not-mounted when SDK loaded with API calls but no config', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        adyenMetadata: makeAdyenMetadata(),
      }),
      capturedRequests: [
        makeRequest('https://checkout-test.adyen.com/v71/sessions', { type: 'other' }),
      ],
    });
    const result = sdkFlavor.run(payload);
    expect(result.title).not.toContain('No Adyen Web checkout was mounted');
  });

  it('reports Unknown when no SDK, no dropin, no config, and no analytics', () => {
    const payload = makeScanPayload();
    const result = sdkFlavor.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Unknown');
  });

  it('prefers analytics data over heuristic fallback', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: { clientKey: 'test_ABC', environment: 'test' },
      }),
      analyticsData: makeAnalyticsData({ flavor: 'dropin' }),
    });
    const result = sdkFlavor.run(payload);
    expect(result.title).toContain('Drop-in');
    expect(result.detail).toContain('analytics');
  });
});

describe('sdk-import-method', () => {
  it('reports CDN when script host is *.cdn.adyen.com', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          { src: 'https://checkoutshopper.cdn.adyen.com/checkoutshopper-sdk/5.67.0/adyen.js' },
        ],
      }),
    });
    const result = sdkImportMethod.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toBe('Import method: CDN.');
  });

  it('reports Adyen when script host is *.adyen.com (non-CDN)', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          {
            src: 'https://checkoutshopper-live-apse.adyen.com/checkoutshopper/sdk/6.31.1/adyen.js',
          },
        ],
      }),
    });
    const result = sdkImportMethod.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toBe('Import method: Adyen.');
  });

  it('prioritises CDN when both CDN and non-CDN Adyen script hosts are present', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          {
            src: 'https://checkoutshopper-live-apse.adyen.com/checkoutshopper/sdk/6.31.1/adyen.js',
          },
          { src: 'https://checkoutshopper.cdn.adyen.com/checkoutshopper-sdk/5.67.0/adyen.js' },
        ],
      }),
    });
    const result = sdkImportMethod.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toBe('Import method: CDN.');
  });

  it('reports npm import method when no Adyen-hosted script tags are present', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [{ src: 'https://cdn.example.com/app.bundle.js' }],
      }),
    });
    const result = sdkImportMethod.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toBe('Import method: npm.');
  });

  it('reports npm import method when no script tags are present', () => {
    const payload = makeScanPayload();
    const result = sdkImportMethod.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toBe('Import method: npm.');
  });
});

describe('sdk-analytics', () => {
  it('returns pass when analytics is not explicitly disabled', () => {
    const payload = makeAdyenPayload();
    const result = sdkAnalytics.run(payload);
    expect(result.severity).toBe('pass');
    expect(result.id).toBe('sdk-analytics');
  });

  it('returns pass when analytics.enabled is true', () => {
    const payload = makeAdyenPayload({}, { analyticsEnabled: true });
    const result = sdkAnalytics.run(payload);
    expect(result.severity).toBe('pass');
    expect(result.id).toBe('sdk-analytics');
  });

  it('returns warn when analytics.enabled is false', () => {
    const payload = makeAdyenPayload({}, { analyticsEnabled: false });
    const result = sdkAnalytics.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.title).toContain('disabled');
  });

  it('returns warn when analytics disabled and SDK detected via script src only', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        adyenMetadata: null,
        scripts: [
          { src: 'https://checkoutshopper-test.adyen.com/checkoutshopper-sdk/5.67.0/adyen.js' },
        ],
        checkoutConfig: makeCheckoutConfig({ analyticsEnabled: false }),
      }),
    });
    const result = sdkAnalytics.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.title).toContain('disabled');
  });

  it('returns skip when SDK is not loaded', () => {
    const payload = makeScanPayload();
    const result = sdkAnalytics.run(payload);
    expect(result.severity).toBe('skip');
  });

  it('returns skip when SDK is loaded but checkout is not mounted', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        adyenMetadata: makeAdyenMetadata(),
      }),
    });
    const result = sdkAnalytics.run(payload);
    expect(result.severity).toBe('skip');
  });
});

describe('sdk-multi-init', () => {
  it('skips when init count is missing', () => {
    const payload = makeScanPayload({
      page: makePageExtract(), // checkoutInitCount is omitted
    });
    const result = sdkMultiInit.run(payload);
    expect(result.severity).toBe('skip');
  });

  it('passes when initialised once', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutInitCount: 1 }),
    });
    const result = sdkMultiInit.run(payload);
    expect(result.severity).toBe('pass');
  });

  it('warns when initialised multiple times', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutInitCount: 2 }),
    });
    const result = sdkMultiInit.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.title).toContain('(count: 2)');
  });
});
