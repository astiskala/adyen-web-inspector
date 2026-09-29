import { describe, it, expect } from 'vitest';
import { V6_DEPRECATION_CHECKS } from '../../../src/background/checks/v6-deprecations';
import type { ScanPayload } from '../../../src/shared/types';
import {
  makeAdyenPayload,
  makeCheckoutPage,
  makeAdyenMetadata,
  makeCheckoutConfig,
  makeScanPayload,
  makeVersionInfo,
  makeCapturedConfig,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const UPGRADE_DOCS_URL =
  'https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6';

function makeV6AdyenPayload(
  metaOverrides: Parameters<typeof makeAdyenPayload>[0] = {},
  configOverrides: Parameters<typeof makeAdyenPayload>[1] = {},
  payloadOverrides: Parameters<typeof makeAdyenPayload>[2] = {}
): ScanPayload {
  return makeAdyenPayload({ version: '6.31.0', ...metaOverrides }, configOverrides, {
    versionInfo: makeVersionInfo({ detected: '6.31.0' }),
    ...payloadOverrides,
  });
}

function noConfigPayload(): ScanPayload {
  return makeScanPayload({
    page: makeCheckoutPage({ capturedConfig: null, componentConfig: null }),
  });
}

function emptyConfigPayload(): ScanPayload {
  return makeScanPayload({
    page: makeCheckoutPage({
      capturedConfig: makeCapturedConfig({}),
    }),
  });
}

describe('v6 Deprecation Checks', () => {
  // ─── Deprecated Properties ────────────────────────────────────────────────

  describe('v6-deprecated-properties', () => {
    const check = requireCheck(V6_DEPRECATION_CHECKS, 'v6-deprecated-properties');

    it('skips when no config is available', () => {
      const result = check.run(noConfigPayload());
      expect(result.severity).toBe('skip');
    });

    it('skips when config has no known properties or callbacks', () => {
      const result = check.run(emptyConfigPayload());
      expect(result.severity).toBe('skip');
    });

    it('passes when config has known fields but no deprecated properties', () => {
      const result = check.run(makeV6AdyenPayload());
      expect(result.severity).toBe('pass');
    });

    it('does not pass an absence check on partial config', () => {
      const payload = makeScanPayload({
        page: makeCheckoutPage({ capturedConfig: makeCapturedConfig({ clientKey: 'test_X' }) }),
        versionInfo: makeVersionInfo({ detected: '6.31.0' }),
      });
      expect(check.run(payload).severity).toBe('skip');
    });

    it('warns for a positively observed deprecated property even in partial config', () => {
      const payload = makeScanPayload({
        page: makeCheckoutPage({
          capturedConfig: makeCapturedConfig({ setStatusAutomatically: true }),
        }),
        versionInfo: makeVersionInfo({ detected: '6.31.0' }),
      });
      expect(check.run(payload).severity).toBe('warn');
    });

    it('skips v6 deprecations for an integration still running v5', () => {
      const payload = makeAdyenPayload(
        {},
        { setStatusAutomatically: true },
        {
          versionInfo: makeVersionInfo({ detected: '5.67.0' }),
        }
      );
      expect(check.run(payload).severity).toBe('skip');
    });

    it('warns when setStatusAutomatically is present', () => {
      const result = check.run(makeV6AdyenPayload({}, { setStatusAutomatically: true }));
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('setStatusAutomatically');
      expect(result.detail).toContain('disableFinalAnimation');
      expect(result.docsUrl).toBe(UPGRADE_DOCS_URL);
    });

    it('warns when installmentOptions is present', () => {
      const result = check.run(makeV6AdyenPayload({}, { installmentOptions: true }));
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('installmentOptions');
      expect(result.detail).toContain('Card');
    });

    it('warns when showBrandsUnderCardNumber is present', () => {
      const result = check.run(makeV6AdyenPayload({}, { showBrandsUnderCardNumber: true }));
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('showBrandsUnderCardNumber');
    });

    it('warns when showFormInstruction is present', () => {
      const result = check.run(makeV6AdyenPayload({}, { showFormInstruction: true }));
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('showFormInstruction');
    });

    it('reports multiple deprecated properties in one warning', () => {
      const result = check.run(
        makeV6AdyenPayload({}, { setStatusAutomatically: true, showFormInstruction: true })
      );
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('properties');
      expect(result.title).toContain('setStatusAutomatically');
      expect(result.title).toContain('showFormInstruction');
    });

    it('uses singular "property" for a single finding', () => {
      const result = check.run(makeV6AdyenPayload({}, { showBrandsUnderCardNumber: true }));
      expect(result.title).toContain('property');
      expect(result.title).not.toContain('properties');
    });

    it('detects deprecated properties in componentConfig', () => {
      const payload = makeScanPayload({
        versionInfo: makeVersionInfo({ detected: '6.31.0' }),
        page: makeCheckoutPage({
          adyenMetadata: makeAdyenMetadata(),
          componentConfig: makeCheckoutConfig({ setStatusAutomatically: true }),
        }),
      });
      const result = check.run(payload);
      expect(result.severity).toBe('warn');
    });
  });

  // ─── Deprecated Callbacks ─────────────────────────────────────────────────

  describe('v6-deprecated-callbacks', () => {
    const check = requireCheck(V6_DEPRECATION_CHECKS, 'v6-deprecated-callbacks');

    it('skips when no config is available', () => {
      const result = check.run(noConfigPayload());
      expect(result.severity).toBe('skip');
    });

    it('skips when config has no known properties or callbacks', () => {
      const result = check.run(emptyConfigPayload());
      expect(result.severity).toBe('skip');
    });

    it('passes when config has known fields but no deprecated callbacks', () => {
      const result = check.run(makeV6AdyenPayload());
      expect(result.severity).toBe('pass');
    });

    it('warns when onValid is present', () => {
      const result = check.run(makeV6AdyenPayload({}, { onValid: 'checkout' }));
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('onValid');
      expect(result.detail).toContain('no longer used');
      expect(result.docsUrl).toBe(UPGRADE_DOCS_URL);
    });

    it('warns when onOrderCreated is present', () => {
      const result = check.run(makeV6AdyenPayload({}, { onOrderCreated: 'checkout' }));
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('onOrderCreated');
      expect(result.detail).toContain('onOrderUpdated');
    });

    it('warns when onShippingChange is present', () => {
      const result = check.run(makeV6AdyenPayload({}, { onShippingChange: 'component' }));
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('onShippingChange');
      expect(result.detail).toContain('onShippingAddressChange');
      expect(result.detail).toContain('onShippingOptionsChange');
    });

    it('warns when onShopperDetails is present', () => {
      const result = check.run(makeV6AdyenPayload({}, { onShopperDetails: 'component' }));
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('onShopperDetails');
      expect(result.detail).toContain('onAuthorized');
    });

    it('reports multiple deprecated callbacks in one warning', () => {
      const result = check.run(
        makeV6AdyenPayload({}, { onValid: 'checkout', onOrderCreated: 'checkout' })
      );
      expect(result.severity).toBe('warn');
      expect(result.title).toContain('handlers');
      expect(result.title).toContain('onValid');
      expect(result.title).toContain('onOrderCreated');
    });

    it('uses singular "handler" for a single finding', () => {
      const result = check.run(makeV6AdyenPayload({}, { onValid: 'checkout' }));
      expect(result.title).toContain('handler');
      expect(result.title).not.toContain('handlers');
    });

    it('detects deprecated callbacks in componentConfig', () => {
      const payload = makeScanPayload({
        versionInfo: makeVersionInfo({ detected: '6.31.0' }),
        page: makeCheckoutPage({
          adyenMetadata: makeAdyenMetadata(),
          componentConfig: makeCheckoutConfig({ onShopperDetails: 'component' }),
        }),
      });
      const result = check.run(payload);
      expect(result.severity).toBe('warn');
    });
  });

  // ─── Registration ─────────────────────────────────────────────────────────

  it('exports exactly 2 v6 deprecation checks', () => {
    expect(V6_DEPRECATION_CHECKS).toHaveLength(2);
  });

  it('all checks have version-lifecycle category', () => {
    for (const check of V6_DEPRECATION_CHECKS) {
      expect(check.category).toBe('version-lifecycle');
    }
  });
});
