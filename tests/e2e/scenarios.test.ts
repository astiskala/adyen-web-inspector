import type { CheckId, CheckResult } from '../../src/shared/types';
import { test, expect, scanFixture } from './fixtures';

function check(
  result: Awaited<ReturnType<typeof scanFixture>>,
  id: CheckId
): CheckResult | undefined {
  const found = result.checks.find((entry) => entry.id === id);
  expect(found, `Missing check ${id}`).toBeDefined();
  return found;
}

test('Sessions Drop-in exposes configuration and meets frontend criteria', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=sessions-dropin'
  );

  expect(result.payload.page.checkoutConfig).toMatchObject({
    environment: 'test',
    clientKey: 'test_dummy',
    countryCode: 'NL',
    locale: 'en-US',
    hasSession: true,
  });
  expect(result.payload.page.checkoutConfigComplete).toBe(true);
  expect(result.payload.versionInfo.detected).toBe('6.31.0');
  expect(check(result, 'sdk-detected')?.severity).toBe('info');
  expect(check(result, 'sdk-flavor')?.title).toContain('Drop-in');
  expect(check(result, 'sdk-import-method')?.title).toBe('Import method: Unknown.');
  expect(check(result, 'sdk-bundle-type')?.severity).toBe('pass');
  expect(check(result, 'version-detected')?.severity).toBe('info');
  expect(check(result, 'flow-type')?.title).toContain('Sessions');
  expect(check(result, 'auth-client-key')?.severity).toBe('pass');
  expect(check(result, 'auth-country-code')?.severity).toBe('pass');
  expect(check(result, 'callback-on-submit')?.severity).toBe('skip');
  expect(check(result, 'callback-on-payment-completed')?.severity).toBe('pass');
  expect(check(result, 'callback-on-payment-failed')?.severity).toBe('pass');
  expect(check(result, 'callback-before-submit')?.severity).toBe('info');
  expect(check(result, 'risk-df-iframe')?.severity).toBe('pass');
  expect(check(result, '3p-cookiebot-auto-blocking')?.severity).toBe('pass');
  expect(check(result, 'security-csp-present')?.severity).toBe('warn');
  expect(check(result, 'security-api-key-exposed')?.severity).toBe('pass');
  expect(result.standardCompliance.compliant).toBe(true);
});

test('Advanced Components reports missing callbacks, locale, country and disabled risk', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=advanced-components'
  );

  expect(result.payload.page.checkoutConfigComplete).toBe(true);
  expect(check(result, 'sdk-flavor')?.title).toContain('Components');
  expect(check(result, 'flow-type')?.title).toContain('Advanced');
  expect(check(result, 'callback-on-submit')?.severity).toBe('fail');
  expect(check(result, 'callback-on-additional-details')?.severity).toBe('fail');
  expect(check(result, 'callback-on-error')?.severity).toBe('fail');
  expect(check(result, 'auth-country-code')?.severity).toBe('fail');
  expect(check(result, 'auth-locale')?.severity).toBe('warn');
  expect(check(result, 'sdk-analytics')?.severity).toBe('warn');
  expect(check(result, 'risk-module-not-disabled')?.severity).toBe('warn');
  expect(result.standardCompliance.compliant).toBe(false);
});

test('Live config with test key and test CDN flags independent environment and security issues', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=environment-mismatch'
  );

  expect(result.payload.page.checkoutConfig?.environment).toBe('live');
  expect(
    result.payload.capturedRequests.some((request) =>
      request.url.startsWith('https://checkout-live.adyen.com/v71/paymentMethods')
    )
  ).toBe(true);
  expect(check(result, 'env-key-mismatch')?.severity).toBe('fail');
  expect(check(result, 'env-cdn-mismatch')?.severity).toBe('fail');
  expect(check(result, 'env-region')?.title).toBe('Region: EU.');
  expect(check(result, 'security-https')?.severity).toBe('fail');
  expect(check(result, 'security-hsts')?.severity).toBe('notice');
  expect(check(result, 'security-sri-script')?.severity).toBe('fail');
  expect(result.health.tier).toBe('critical');
});

test('India live checkout on HTTP is subject to HTTPS and HSTS checks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=india-live-http'
  );

  expect(result.payload.page.checkoutConfig?.environment).toBe('live-in');
  expect(check(result, 'security-https')?.severity).toBe('fail');
  expect(check(result, 'security-hsts')?.severity).toBe('notice');
});

test('Loaded SDK without a mounted checkout does not imply checkout activity', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-merchant.html?scenario=sdk-only');

  expect(result.payload.page.adyenMetadata?.version).toBe('6.31.0');
  expect(result.payload.page.checkoutConfig).toBeNull();
  expect(result.payload.page.hasDropinDOM).toBeUndefined();
  expect(check(result, 'sdk-detected')?.severity).toBe('info');
  expect(check(result, 'sdk-flavor')?.title).toContain('No active');
  expect(check(result, 'flow-type')?.title).toContain('Unknown');
  expect(check(result, 'risk-df-iframe')?.severity).toBe('skip');
  expect(check(result, 'uplift-cobadged-version')?.severity).toBe('skip');
});

test('Unrelated merchant page has no Adyen SDK or checkout evidence', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'no-adyen.html');

  expect(result.payload.page.adyenMetadata).toBeNull();
  expect(result.payload.page.checkoutConfig).toBeNull();
  expect(check(result, 'sdk-detected')?.severity).toBe('fail');
  expect(check(result, 'flow-type')?.title).toContain('Unknown');
  expect(check(result, 'risk-df-iframe')?.severity).toBe('skip');
});

test('Checkout inside a merchant iframe keeps frame config and warns about embedding', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-iframe-merchant.html');

  expect(result.payload.page.isInsideIframe).toBe(true);
  expect(result.payload.page.checkoutConfig?.hasSession).toBe(true);
  expect(result.payload.page.pageUrl).toContain('scenario=sessions-dropin');
  expect(check(result, 'env-not-iframe')?.severity).toBe('warn');
  expect(check(result, 'env-not-iframe')?.remediation).toContain('redirectFromTopWhenInIframe');
  expect(check(result, 'sdk-detected')?.severity).toBe('info');
  expect(result.standardCompliance.compliant).toBe(true);
});

test('Checkout document security headers reach CSP and response-header checks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=secure-headers'
  );

  expect(result.payload.mainDocumentHeadersAvailable).toBe(true);
  expect(check(result, 'security-csp-present')?.severity).toBe('pass');
  expect(check(result, 'security-csp-frame-src')?.severity).toBe('pass');
  expect(check(result, 'security-csp-frame-ancestors')?.severity).toBe('pass');
  expect(check(result, 'security-referrer-policy')?.severity).toBe('pass');
  expect(check(result, 'security-x-content-type')?.severity).toBe('pass');
  expect(check(result, 'security-xss-protection')?.severity).toBe('pass');
  expect(check(result, 'security-csp-reporting')?.title).toContain('report-uri');
});

test('Older v6 checkout reveals deprecated options, legacy callback and repeated init', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-merchant.html?scenario=legacy-v6');

  expect(result.payload.versionInfo.detected).toBe('6.10.0');
  expect(result.payload.page.checkoutInitCount).toBe(2);
  expect(check(result, 'version-latest')?.severity).toBe('warn');
  expect(check(result, 'uplift-cobadged-version')?.severity).toBe('fail');
  expect(check(result, 'v6-deprecated-properties')?.severity).toBe('warn');
  expect(check(result, 'v6-deprecated-callbacks')?.severity).toBe('warn');
  expect(check(result, 'sdk-multi-init')?.severity).toBe('warn');
  expect(check(result, 'callback-on-submit')?.severity).toBe('pass');
  expect(check(result, 'callback-actions-pattern')?.severity).toBe('warn');
});

test('Merchant class overrides are reported even alongside CSS custom properties', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=styling-overrides'
  );

  expect(result.payload.page.adyenStyles.classOverrideCount).toBe(1);
  expect(result.payload.page.adyenStyles.customPropertyCount).toBe(1);
  expect(check(result, 'styling-css-custom-props')?.severity).toBe('notice');
  expect(check(result, 'styling-css-custom-props')?.detail).toContain('.adyen-checkout__card');
});

test('Known third-party scripts on checkout produce inventory and replay findings', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=third-party'
  );

  expect(result.payload.page.scripts).toHaveLength(5);
  expect(check(result, '3p-tag-manager')?.severity).toBe('notice');
  expect(check(result, '3p-session-replay')?.severity).toBe('warn');
  expect(check(result, '3p-ad-pixels')?.severity).toBe('warn');
  expect(check(result, '3p-no-sri')?.severity).toBe('notice');
});

test('Cookiebot auto-blocking on a Card checkout warns about inaccessible card fields', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=cookiebot-auto-card'
  );

  expect(result.payload.page.hasCardDOM).toBe(true);
  expect(result.payload.page.scripts).toContainEqual(
    expect.objectContaining({
      src: 'https://consent.cookiebot.com/uc.js',
      blockingMode: 'auto',
    })
  );
  expect(check(result, '3p-cookiebot-auto-blocking')?.severity).toBe('warn');
});

test('Inferred-only checkout fields never count as verified checkout options', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=inferred-only'
  );

  expect(result.payload.page.checkoutConfig).toBeNull();
  expect(result.payload.page.inferredConfig).toMatchObject({
    countryCode: 'NL',
    environment: 'test',
  });
  expect(result.payload.page.checkoutConfigComplete).toBeUndefined();
  expect(check(result, 'auth-country-code')?.severity).toBe('notice');
  expect(check(result, 'callback-on-submit')?.severity).toBe('skip');
  expect(check(result, 'sdk-analytics')?.severity).toBe('skip');
});

test('Styling through SDK custom properties passes without class overrides', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=styling-custom'
  );

  expect(result.payload.page.adyenStyles.classOverrideCount).toBe(0);
  expect(result.payload.page.adyenStyles.customPropertyCount).toBe(1);
  expect(check(result, 'styling-css-custom-props')?.severity).toBe('pass');
});

test('Advanced Components with v6 actions handles required callbacks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=advanced-actions'
  );

  expect(check(result, 'flow-type')?.title).toContain('Advanced');
  expect(check(result, 'callback-on-submit')?.severity).toBe('pass');
  expect(check(result, 'callback-on-additional-details')?.severity).toBe('pass');
  expect(check(result, 'callback-on-error')?.severity).toBe('pass');
  expect(check(result, 'callback-actions-pattern')?.severity).toBe('pass');
  expect(check(result, 'callback-on-submit-filtering')?.severity).toBe('notice');
  expect(check(result, 'callback-multiple-submissions')?.severity).toBe('notice');
  expect(check(result, 'sdk-multi-init')?.severity).toBe('pass');
});

test('Live CDN region mismatch is independent of CDN environment and configured region', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=regional-cdn'
  );

  expect(result.payload.page.checkoutConfig?.environment).toBe('live-us');
  expect(check(result, 'env-region')?.title).toBe('Region: US.');
  expect(check(result, 'env-cdn-mismatch')?.severity).toBe('pass');
  expect(check(result, 'env-region-mismatch')?.severity).toBe('warn');
  expect(check(result, 'sdk-import-method')?.title).toBe('Import method: CDN.');
  expect(check(result, 'sdk-bundle-type')?.severity).toBe('skip');
});

test('Selective custom pay button flags unsupported methods and unhandled callbacks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=custom-pay-button'
  );

  expect(result.payload.page.checkoutConfig?.beforeSubmit).toBe('checkout');
  expect(
    result.payload.capturedRequests.some((request) => request.url.includes('variant=paypal'))
  ).toBe(true);
  expect(check(result, 'callback-on-submit-filtering')?.severity).toBe('warn');
  expect(check(result, 'callback-before-submit')?.severity).toBe('pass');
  expect(check(result, 'callback-multiple-submissions')?.severity).toBe('info');
  expect(check(result, 'callback-custom-pay-button-compatibility')?.severity).toBe('warn');
});

test('Restrictive CSP and missing CSS SRI are reported while iframe referrer policy is present', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=csp-resources'
  );

  expect(
    result.payload.page.scripts.some((script) => script.src.includes('checkoutshopper-test'))
  ).toBe(true);
  expect(result.payload.page.links.some((link) => link.href.includes('checkoutshopper-test'))).toBe(
    true
  );
  expect(check(result, 'security-csp-present')?.severity).toBe('pass');
  expect(check(result, 'security-csp-script-src')?.severity).toBe('warn');
  expect(check(result, 'security-sri-css')?.severity).toBe('warn');
  expect(check(result, 'security-iframe-referrerpolicy')?.severity).toBe('pass');
});

test('Synthetic client-side API key pattern is reported as exposed', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=exposed-decoy'
  );

  expect(result.payload.page.apiKeyDetected).toBe(true);
  expect(check(result, 'security-api-key-exposed')?.severity).toBe('fail');
  expect(result.health.tier).toBe('critical');
});

test('Checkout analytics POST during a scan supplies flavor and Sessions flow evidence', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=advanced-actions',
    async (page) => {
      await page.evaluate(async () => {
        await globalThis.fetch(
          'https://checkoutanalytics-test.adyen.com/checkoutanalytics/v3/setup',
          {
            method: 'POST',
            body: globalThis.JSON.stringify({
              flavor: 'custom',
              version: '6.31.0',
              buildType: 'esm',
              sessionId: 'dummy-session',
            }),
          }
        );
      });
    }
  );

  expect(result.payload.analyticsData).toMatchObject({
    flavor: 'custom',
    version: '6.31.0',
    buildType: 'esm',
    sessionId: 'dummy-session',
  });
  expect(check(result, 'sdk-flavor')?.title).toBe('Integration flavor: Custom.');
  expect(check(result, 'flow-type')?.title).toContain('Sessions');
  expect(check(result, 'callback-on-submit')?.severity).toBe('skip');
});

test('CDN URL identifies the SDK without exposed metadata and flags legacy auth settings', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=cdn-without-metadata'
  );

  expect(result.payload.page.adyenMetadata).toBeNull();
  expect(result.payload.versionInfo.detected).toBe('6.31.0');
  expect(check(result, 'sdk-detected')?.severity).toBe('info');
  expect(check(result, 'sdk-import-method')?.title).toBe('Import method: CDN.');
  expect(check(result, 'version-detected')?.severity).toBe('info');
  expect(check(result, 'auth-client-key')?.severity).toBe('warn');
  expect(check(result, 'auth-locale')?.title).toContain('not in the supported');
});

test('Server-created session mounts v6 Drop-in with checkout-level outcome handlers', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=sessions-server'
  );

  expect(
    result.payload.capturedRequests.some((request) => request.url.endsWith('/api/sessions'))
  ).toBe(true);
  expect(result.payload.page.checkoutConfig).toMatchObject({
    hasSession: true,
    countryCode: 'NL',
    locale: 'en-US',
    onPaymentCompleted: 'checkout',
    onPaymentFailed: 'checkout',
  });
  expect(check(result, 'flow-type')?.title).toContain('Sessions');
  expect(check(result, 'sdk-flavor')?.title).toContain('Drop-in');
  expect(check(result, 'callback-on-submit')?.severity).toBe('skip');
  expect(check(result, 'callback-on-payment-completed')?.severity).toBe('pass');
  expect(check(result, 'callback-on-payment-failed')?.severity).toBe('pass');
  expect(check(result, 'sdk-multi-init')?.severity).toBe('pass');
  expect(result.standardCompliance.compliant).toBe(true);
});

test('Sessions Drop-in with server-side country but missing outcome handlers reports risks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=sessions-server-incomplete'
  );

  expect(result.payload.page.checkoutConfig).toMatchObject({ hasSession: true, locale: 'en-US' });
  expect(result.payload.page.checkoutConfig?.countryCode).toBeUndefined();
  expect(check(result, 'flow-type')?.title).toContain('Sessions');
  expect(check(result, 'auth-country-code')?.severity).toBe('warn');
  expect(check(result, 'callback-on-submit')?.severity).toBe('skip');
  expect(check(result, 'callback-on-payment-completed')?.severity).toBe('fail');
  expect(check(result, 'callback-on-payment-failed')?.severity).toBe('fail');
  expect(check(result, 'risk-df-iframe')?.severity).toBe('warn');
  expect(result.health.tier).toBe('critical');
  expect(result.standardCompliance.compliant).toBe(true);
});

test('Advanced Card uses merchant payment methods and checkout-level v6 callbacks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=advanced-server-card'
  );

  expect(
    result.payload.capturedRequests.some((request) => request.url.endsWith('/api/paymentMethods'))
  ).toBe(true);
  expect(result.payload.page.checkoutConfig).toMatchObject({
    environment: 'test',
    clientKey: 'test_dummy',
    countryCode: 'NL',
    onSubmit: 'checkout',
    onAdditionalDetails: 'checkout',
    onPaymentCompleted: 'checkout',
    onPaymentFailed: 'checkout',
  });
  expect(check(result, 'sdk-flavor')?.title).toContain('Components');
  expect(check(result, 'flow-type')?.title).toContain('Advanced');
  expect(check(result, 'callback-on-submit')?.severity).toBe('pass');
  expect(check(result, 'callback-on-additional-details')?.severity).toBe('pass');
  expect(check(result, 'callback-actions-pattern')?.severity).toBe('pass');
  expect(check(result, 'risk-df-iframe')?.severity).toBe('pass');
  expect(result.standardCompliance.compliant).toBe(false);
});

test('Card-only callback registration warns instead of treating handlers as checkout-level', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=component-callbacks'
  );

  expect(result.payload.page.checkoutConfigComplete).toBe(true);
  expect(result.payload.page.checkoutConfig).toMatchObject({
    onSubmit: 'component',
    onAdditionalDetails: 'component',
    onError: 'component',
    onPaymentCompleted: 'component',
    onPaymentFailed: 'component',
  });
  expect(check(result, 'callback-on-submit')?.severity).toBe('warn');
  expect(check(result, 'callback-on-additional-details')?.severity).toBe('warn');
  expect(check(result, 'callback-on-error')?.severity).toBe('warn');
  expect(check(result, 'callback-on-payment-completed')?.severity).toBe('warn');
  expect(check(result, 'callback-on-payment-failed')?.severity).toBe('warn');
});

test('SPA route change reuses one Drop-in initialization', async ({ context, extensionId }) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=spa-single-init'
  );

  expect(result.pageUrl).toContain('#checkout');
  expect(result.payload.page.checkoutInitCount).toBe(1);
  expect(check(result, 'sdk-multi-init')?.severity).toBe('pass');
  expect(check(result, 'flow-type')?.title).toContain('Sessions');
  expect(check(result, 'sdk-flavor')?.title).toContain('Drop-in');
});

test('SPA rerender that recreates Drop-in warns about duplicate initialization', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=spa-double-init'
  );

  expect(result.pageUrl).toContain('#checkout');
  expect(result.payload.page.checkoutInitCount).toBe(2);
  expect(check(result, 'sdk-multi-init')?.severity).toBe('warn');
  expect(check(result, 'sdk-multi-init')?.title).toContain('count: 2');
  expect(check(result, 'sdk-flavor')?.title).toContain('Drop-in');
});

test('Documented CDN assets with valid SRI and compatible CSP pass resource checks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-merchant.html?scenario=cdn-sri');

  expect(
    result.payload.page.scripts.some((script) => script.src.includes('/sdk/6.31.0/adyen.js'))
  ).toBe(true);
  expect(check(result, 'sdk-import-method')?.title).toBe('Import method: CDN.');
  expect(check(result, 'security-sri-script')?.severity).toBe('pass');
  expect(check(result, 'security-sri-css')?.severity).toBe('pass');
  expect(check(result, 'security-csp-script-src')?.severity).toBe('pass');
  expect(check(result, 'security-csp-reporting')?.severity).toBe('pass');
  expect(check(result, 'env-cdn-mismatch')?.severity).toBe('pass');
});

test('The same documented CDN URLs without SRI fail integrity checks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-merchant.html?scenario=cdn-no-sri');

  expect(
    result.payload.page.scripts.some((script) => script.src.includes('/sdk/6.31.0/adyen.js'))
  ).toBe(true);
  expect(check(result, 'security-sri-script')?.severity).toBe('fail');
  expect(check(result, 'security-sri-css')?.severity).toBe('warn');
  expect(check(result, 'security-csp-script-src')?.severity).toBe('pass');
});
