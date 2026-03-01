import { describe, it, expect } from 'vitest';
import { ENVIRONMENT_CHECKS } from '../../../src/background/checks/environment';
import {
  makeScanPayload,
  makeAdyenPayload,
  makePageExtract,
  makeRequest,
  makeCheckoutConfig,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const envRegion = requireCheck(ENVIRONMENT_CHECKS, 'env-region');
const envCdnMismatch = requireCheck(ENVIRONMENT_CHECKS, 'env-cdn-mismatch');
const envKeyMismatch = requireCheck(ENVIRONMENT_CHECKS, 'env-key-mismatch');
const envNotIframe = requireCheck(ENVIRONMENT_CHECKS, 'env-not-iframe');
const envRegionMismatch = requireCheck(ENVIRONMENT_CHECKS, 'env-region-mismatch');

describe('env-region', () => {
  it('skips region check in test environment', () => {
    const payload = makeAdyenPayload({}, { environment: 'test' });
    const result = envRegion.run(payload);
    expect(result.severity).toBe('skip');
    expect(result.title).toContain('skipped');
  });

  it('returns info in live environment', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'live' },
      { capturedRequests: [makeRequest('https://checkout-live.adyenpayments.com/v71/sessions')] }
    );
    const result = envRegion.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Region:');
  });

  it('uses checkout config region when environment includes live region suffix', () => {
    const payload = makeAdyenPayload({}, { environment: 'live-us' });
    const result = envRegion.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Region: US.');
    expect(result.detail).toContain('checkoutConfig.environment');
  });
});

describe('env-cdn-mismatch', () => {
  it('skips when no CDN requests are present', () => {
    const payload = makeAdyenPayload({}, { environment: 'live' });
    expect(envCdnMismatch.run(payload).severity).toBe('skip');
  });

  it('skips when CDN env is detected but no configured environment', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
      capturedRequests: [
        makeRequest('https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk.js'),
      ],
    });
    expect(envCdnMismatch.run(payload).severity).toBe('skip');
  });

  it('passes when CDN live matches configured live', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'live' },
      {
        capturedRequests: [
          makeRequest('https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk.js'),
        ],
      }
    );
    expect(envCdnMismatch.run(payload).severity).toBe('pass');
  });

  it('passes when CDN test matches configured test', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'test' },
      {
        capturedRequests: [
          makeRequest('https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/sdk.js'),
        ],
      }
    );
    expect(envCdnMismatch.run(payload).severity).toBe('pass');
  });

  it('fails when CDN is live but configured environment is test', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'test' },
      {
        capturedRequests: [
          makeRequest('https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk.js'),
        ],
      }
    );
    expect(envCdnMismatch.run(payload).severity).toBe('fail');
  });

  it('fails when CDN is test but configured environment is live', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'live' },
      {
        capturedRequests: [
          makeRequest('https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/sdk.js'),
        ],
      }
    );
    expect(envCdnMismatch.run(payload).severity).toBe('fail');
  });

  it('passes when live region CDN matches configured live', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'live-us' },
      {
        capturedRequests: [
          makeRequest('https://checkoutshopper-live-us.cdn.adyen.com/checkoutshopper/sdk.js'),
        ],
      }
    );
    expect(envCdnMismatch.run(payload).severity).toBe('pass');
  });
});

describe('env-key-mismatch', () => {
  it('passes when test key matches test requests', () => {
    const payload = makeAdyenPayload(
      {},
      { clientKey: 'test_XXXX' },
      { capturedRequests: [makeRequest('https://checkout-test.adyen.com/v71/sessions')] }
    );
    expect(envKeyMismatch.run(payload).severity).toBe('pass');
  });

  it('fails when live key used with test requests', () => {
    const payload = makeAdyenPayload(
      {},
      { clientKey: 'live_XXXX' },
      { capturedRequests: [makeRequest('https://checkout-test.adyen.com/v71/sessions')] }
    );
    expect(envKeyMismatch.run(payload).severity).toBe('fail');
  });

  it('fails when test key used with live requests', () => {
    const payload = makeAdyenPayload(
      {},
      { clientKey: 'test_XXXX' },
      { capturedRequests: [makeRequest('https://checkout-live.adyen.com/v71/sessions')] }
    );
    expect(envKeyMismatch.run(payload).severity).toBe('fail');
  });

  it('fails when test key used with live adyenpayments requests', () => {
    const payload = makeAdyenPayload(
      {},
      { clientKey: 'test_XXXX' },
      { capturedRequests: [makeRequest('https://checkout-live-us.adyenpayments.com/v71/sessions')] }
    );
    expect(envKeyMismatch.run(payload).severity).toBe('fail');
  });

  it('skips when no client key', () => {
    const payload = makeAdyenPayload({}, { clientKey: undefined });
    expect(envKeyMismatch.run(payload).severity).toBe('skip');
  });

  it('skips when no captured requests', () => {
    const payload = makeAdyenPayload({}, { clientKey: 'test_XXXX' });
    expect(envKeyMismatch.run(payload).severity).toBe('skip');
  });
});

describe('env-not-iframe', () => {
  it('passes when page is not inside iframe', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ isInsideIframe: false }),
    });
    expect(envNotIframe.run(payload).severity).toBe('pass');
  });

  it('warns when page is inside iframe', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ isInsideIframe: true }),
    });
    expect(envNotIframe.run(payload).severity).toBe('warn');
  });
});

describe('env-region-mismatch', () => {
  it('skips when no regional CDN requests', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'live-us' },
      { capturedRequests: [makeRequest('https://checkoutshopper-live.cdn.adyen.com/sdk.js')] }
    );
    expect(envRegionMismatch.run(payload).severity).toBe('skip');
  });

  it('passes when CDN region matches configured region', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'live-us' },
      { capturedRequests: [makeRequest('https://checkoutshopper-live-us.cdn.adyen.com/sdk.js')] }
    );
    expect(envRegionMismatch.run(payload).severity).toBe('pass');
  });

  it('warns when CDN region mismatches configured region', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'live-apse' },
      { capturedRequests: [makeRequest('https://checkoutshopper-live-us.cdn.adyen.com/sdk.js')] }
    );
    const result = envRegionMismatch.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.title).toContain('US vs APSE');
  });

  it('skips when configured region is unknown', () => {
    const payload = makeAdyenPayload(
      {},
      { environment: 'live' },
      { capturedRequests: [makeRequest('https://checkoutshopper-live-us.cdn.adyen.com/sdk.js')] }
    );
    expect(envRegionMismatch.run(payload).severity).toBe('skip');
  });
});

describe('componentConfig fallback', () => {
  it('env-key-mismatch resolves clientKey from componentConfig', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        componentConfig: makeCheckoutConfig({ clientKey: 'test_COMPONENT' }),
      }),
      capturedRequests: [makeRequest('https://checkout-test.adyen.com/v71/sessions')],
    });
    expect(envKeyMismatch.run(payload).severity).toBe('pass');
  });
});
