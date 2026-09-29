/** Minimal, credential-free reproductions from live browser testing on 2026-09-29. */
import { describe, expect, it } from 'vitest';
import { assessScan } from '../../src/background/scan-assessment';
import type { ScanResult } from '../../src/shared/types';
import {
  makeAdyenMetadata,
  makeCapturedConfig,
  makeCheckoutConfig,
  makeCheckoutPage,
  makeDocumentHeaders,
  makeRequest,
} from '../fixtures/makeScanPayload';

const RISK_SCRIPT =
  'https://checkoutshopper-live.adyen.com/checkoutshopper/assets/js/datacollection/datacollection.js';
const SDK_SCRIPT = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.33.0/adyen.js';

/** Models MyStore's merchant bundles and dynamically inserted risk script. */
async function scanMyStore(): Promise<ScanResult> {
  return assessScan(
    {
      tabId: 1,
      page: makeCheckoutPage({
        pageUrl: 'https://www.mystoredemo.io/#/checkout',
        hasDropinDOM: true,
        adyenMetadata: makeAdyenMetadata({ version: '6.46.0-alpha.7c7199d' }),
        capturedConfig: makeCapturedConfig(
          makeCheckoutConfig({ environment: 'test', hasSession: true })
        ),
        scripts: [
          { src: RISK_SCRIPT },
          { src: 'https://www.mystoredemo.io/runtime.bundle.js' },
          { src: 'https://www.mystoredemo.io/vendors.bundle.js' },
          { src: 'https://www.mystoredemo.io/main.bundle.js' },
        ],
      }),
      traffic: {
        documentHeaders: makeDocumentHeaders(),
        capturedRequests: [makeRequest(RISK_SCRIPT)],
        analyticsData: null,
      },
      latestVersion: '6.45.2',
      scannedAt: '2026-09-29T00:00:00.000Z',
    },
    async () => null
  );
}

// Known defects: expected failures execute the desired assertions and fail on an unexpected pass.
// Remove .fails when the corresponding production fix lands.
describe('MyStore live-site regressions', () => {
  it.fails('does not require SDK SRI on a dynamically loaded risk-data script', async () => {
    const result = await scanMyStore();
    expect(result.checks.find(({ id }) => id === 'security-sri-script')).toMatchObject({
      severity: 'skip',
    });
  });

  it.fails('does not treat the risk host as the checkout SDK CDN environment', async () => {
    const result = await scanMyStore();
    expect(result.checks.find(({ id }) => id === 'env-cdn-mismatch')).toMatchObject({
      severity: 'skip',
    });
  });

  it.fails('does not infer an Adyen-hosted SDK import from the risk script', async () => {
    const result = await scanMyStore();
    expect(result.attributes.importMethod).toBe('Unknown');
  });
});

describe('Payment Checkout live-site controls', () => {
  it.each([true, false])('recognizes hosted SDK with Drop-in=%s', async (hasDropinDOM) => {
    const result = await assessScan(
      {
        tabId: 2,
        page: makeCheckoutPage({
          hasDropinDOM,
          hasCardDOM: true,
          adyenMetadata: makeAdyenMetadata({
            version: '6.33.0',
            bundleType: 'umd',
            variants: [],
          }),
          capturedConfig: makeCapturedConfig(
            makeCheckoutConfig({ environment: 'test', hasSession: true })
          ),
          scripts: [{ src: SDK_SCRIPT }],
        }),
        traffic: {
          documentHeaders: makeDocumentHeaders(),
          capturedRequests: [makeRequest(SDK_SCRIPT)],
          analyticsData: null,
        },
        latestVersion: '6.45.2',
        scannedAt: '2026-09-29T00:00:00.000Z',
      },
      async () => null
    );
    expect(result.sdkPresence.detected).toBe(true);
    expect(result.attributes.flavor.value).toBe(hasDropinDOM ? 'Drop-in' : 'Components');
    expect(result.attributes.flow.value).toBe('sessions');
    expect(result.checks.find(({ id }) => id === 'env-cdn-mismatch')).toMatchObject({
      severity: 'pass',
    });
    expect(result.checks.find(({ id }) => id === 'security-sri-script')).toMatchObject({
      severity: 'fail',
    });
  });
});
