import { test, expect, requireCheck, scanFixture } from './fixtures';

test('Sessions Drop-in exposes configuration and meets frontend criteria', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=sessions-dropin'
  );

  expect(result.payload.page.capturedConfig?.options).toMatchObject({
    environment: 'test',
    clientKey: 'test_dummy',
    countryCode: 'NL',
    locale: 'en-US',
    hasSession: true,
  });
  expect(result.payload.page.capturedConfig?.complete).toBe(true);
  expect(result.payload.versionInfo.detected).toBe('6.31.0');
  expect(requireCheck(result, 'sdk-detected').severity).toBe('info');
  expect(requireCheck(result, 'sdk-flavor').title).toContain('Drop-in');
  expect(requireCheck(result, 'sdk-import-method').title).toBe('Import method: Unknown.');
  expect(requireCheck(result, 'sdk-bundle-type').severity).toBe('pass');
  expect(requireCheck(result, 'version-detected').severity).toBe('info');
  expect(result.payload.versionInfo.detectedReleasedAt).toBeDefined();
  expect(requireCheck(result, 'version-latest')).toMatchObject({
    severity: 'notice',
    impact: 'low',
  });
  expect(requireCheck(result, 'version-latest').title).toContain(
    'released within the last 6 months'
  );
  expect(requireCheck(result, 'flow-type').title).toContain('Sessions');
  expect(requireCheck(result, 'auth-client-key').severity).toBe('pass');
  expect(requireCheck(result, 'auth-client-key-rejected').severity).toBe('skip');
  expect(requireCheck(result, 'auth-country-code').severity).toBe('pass');
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('skip');
  expect(requireCheck(result, 'callback-on-payment-completed').severity).toBe('pass');
  expect(requireCheck(result, 'callback-on-payment-failed').severity).toBe('pass');
  expect(requireCheck(result, 'callback-before-submit').severity).toBe('info');
  expect(requireCheck(result, 'risk-df-iframe').severity).toBe('pass');
  expect(requireCheck(result, '3p-cookiebot-auto-blocking').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-present').severity).toBe('warn');
  expect(requireCheck(result, 'security-api-key-exposed').severity).toBe('pass');
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

  expect(result.payload.page.capturedConfig?.complete).toBe(true);
  expect(requireCheck(result, 'sdk-flavor').title).toContain('Components');
  expect(requireCheck(result, 'flow-type').title).toContain('Advanced');
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('fail');
  expect(requireCheck(result, 'callback-on-additional-details').severity).toBe('fail');
  expect(requireCheck(result, 'callback-on-error').severity).toBe('fail');
  expect(requireCheck(result, 'auth-country-code').severity).toBe('fail');
  expect(requireCheck(result, 'auth-locale').severity).toBe('warn');
  expect(requireCheck(result, 'sdk-analytics').severity).toBe('warn');
  expect(requireCheck(result, 'risk-module-not-disabled').severity).toBe('warn');
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

  expect(result.payload.page.capturedConfig?.options.environment).toBe('live');
  expect(
    result.payload.capturedRequests.some((request) =>
      request.url.startsWith('https://checkout-live.adyen.com/v71/paymentMethods')
    )
  ).toBe(true);
  expect(requireCheck(result, 'env-key-mismatch').severity).toBe('fail');
  expect(requireCheck(result, 'env-cdn-mismatch').severity).toBe('fail');
  expect(requireCheck(result, 'env-region').title).toBe('Region: EU.');
  expect(requireCheck(result, 'security-https').severity).toBe('fail');
  expect(requireCheck(result, 'security-hsts').severity).toBe('notice');
  expect(requireCheck(result, 'security-sri-script').severity).toBe('fail');
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

  expect(result.payload.page.capturedConfig?.options.environment).toBe('live-in');
  expect(requireCheck(result, 'security-https').severity).toBe('fail');
  expect(requireCheck(result, 'security-hsts').severity).toBe('notice');
});

test('Loaded SDK without a mounted checkout does not imply checkout activity', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-merchant.html?scenario=sdk-only');

  expect(result.payload.page.adyenMetadata?.version).toBe('6.31.0');
  expect(result.payload.page.capturedConfig).toBeNull();
  expect(result.payload.page.hasDropinDOM).toBeUndefined();
  expect(requireCheck(result, 'sdk-detected').severity).toBe('info');
  expect(requireCheck(result, 'sdk-flavor').title).toContain('No active');
  expect(requireCheck(result, 'flow-type').title).toContain('Unknown');
  expect(requireCheck(result, 'risk-df-iframe').severity).toBe('skip');
  expect(requireCheck(result, 'uplift-cobadged-version').severity).toBe('skip');
});

test('Unrelated merchant page has no Adyen SDK or checkout evidence', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'no-adyen.html');

  expect(result.payload.page.adyenMetadata).toBeNull();
  expect(result.payload.page.capturedConfig).toBeNull();
  expect(requireCheck(result, 'sdk-detected').severity).toBe('fail');
  expect(requireCheck(result, 'flow-type').title).toContain('Unknown');
  expect(requireCheck(result, 'risk-df-iframe').severity).toBe('skip');
});

test('Checkout inside a merchant iframe keeps frame config and warns about embedding', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-iframe-merchant.html');

  expect(result.payload.page.checkoutInIframe).toBe(true);
  expect(result.payload.page.capturedConfig?.options.hasSession).toBe(true);
  expect(result.payload.page.pageUrl).toContain('scenario=sessions-dropin');
  expect(requireCheck(result, 'env-not-iframe').severity).toBe('warn');
  expect(requireCheck(result, 'env-not-iframe').remediation).toContain(
    'redirectFromTopWhenInIframe'
  );
  expect(requireCheck(result, 'sdk-detected').severity).toBe('info');
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

  expect(result.payload.documentHeaders.status).toBe('observed');
  expect(requireCheck(result, 'security-csp-present').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-frame-src').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-connect-src').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-img-src').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-form-action').severity).toBe('warn');
  expect(requireCheck(result, 'security-csp-frame-ancestors').severity).toBe('pass');
  expect(requireCheck(result, 'security-referrer-policy').severity).toBe('pass');
  expect(requireCheck(result, 'security-x-content-type').severity).toBe('pass');
  expect(requireCheck(result, 'security-xss-protection').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-reporting').title).toContain('report-uri');
});

test('Older v6 checkout reveals deprecated options, legacy callback and repeated init', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-merchant.html?scenario=legacy-v6');

  expect(result.payload.versionInfo.detected).toBe('6.10.0');
  expect(result.payload.page.checkoutInitCount).toBe(2);
  expect(requireCheck(result, 'version-latest').severity).toBe('warn');
  expect(requireCheck(result, 'version-latest').title).toContain('more than 6 months ago');
  expect(requireCheck(result, 'uplift-cobadged-version').severity).toBe('fail');
  expect(requireCheck(result, 'v6-deprecated-properties').severity).toBe('warn');
  expect(requireCheck(result, 'v6-deprecated-callbacks').severity).toBe('warn');
  expect(requireCheck(result, 'sdk-multi-init').severity).toBe('warn');
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('pass');
  expect(requireCheck(result, 'callback-actions-pattern').severity).toBe('warn');
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
  expect(requireCheck(result, 'styling-css-custom-props').severity).toBe('notice');
  expect(requireCheck(result, 'styling-css-custom-props').detail).toContain(
    '.adyen-checkout__card'
  );
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
  expect(requireCheck(result, '3p-tag-manager').severity).toBe('notice');
  expect(requireCheck(result, '3p-session-replay').severity).toBe('warn');
  expect(requireCheck(result, '3p-ad-pixels').severity).toBe('warn');
  expect(requireCheck(result, '3p-no-sri').severity).toBe('notice');
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
  expect(result.payload.page.hasNewCardFormDOM).toBe(true);
  expect(requireCheck(result, 'risk-card-holder-name')).toMatchObject({
    severity: 'notice',
    impact: 'manual',
  });
  expect(result.payload.page.scripts).toContainEqual(
    expect.objectContaining({
      src: 'https://consent.cookiebot.com/uc.js',
      blockingMode: 'auto',
    })
  );
  expect(requireCheck(result, '3p-cookiebot-auto-blocking').severity).toBe('warn');
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

  expect(result.payload.page.capturedConfig).toBeNull();
  expect(result.payload.page.pageJsonConfig).toMatchObject({
    countryCode: 'NL',
    environment: 'test',
  });
  expect(requireCheck(result, 'auth-country-code').severity).toBe('notice');
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('skip');
  expect(requireCheck(result, 'sdk-analytics').severity).toBe('skip');
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
  expect(requireCheck(result, 'styling-css-custom-props').severity).toBe('pass');
});

test('Advanced Components with v6 actions handles callbacks but forwards partial state.data', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=advanced-actions'
  );

  expect(requireCheck(result, 'flow-type').title).toContain('Advanced');
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('pass');
  expect(requireCheck(result, 'callback-on-additional-details').severity).toBe('pass');
  expect(requireCheck(result, 'callback-on-error').severity).toBe('pass');
  expect(requireCheck(result, 'callback-actions-pattern').severity).toBe('pass');
  expect(requireCheck(result, 'callback-on-submit-state-data').severity).toBe('warn');
  expect(requireCheck(result, 'callback-on-submit-state-data').detail).toContain(
    'state.data.paymentMethod'
  );
  expect(requireCheck(result, 'callback-on-submit-filtering').severity).toBe('notice');
  expect(requireCheck(result, 'callback-multiple-submissions').severity).toBe('notice');
  expect(requireCheck(result, 'sdk-multi-init').severity).toBe('pass');
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

  expect(result.payload.page.capturedConfig?.options.environment).toBe('live-us');
  expect(requireCheck(result, 'env-region').title).toBe('Region: US.');
  expect(requireCheck(result, 'env-cdn-mismatch').severity).toBe('pass');
  expect(requireCheck(result, 'env-region-mismatch').severity).toBe('warn');
  expect(requireCheck(result, 'sdk-import-method').title).toBe('Import method: CDN.');
  expect(requireCheck(result, 'sdk-bundle-type').severity).toBe('skip');
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

  expect(result.payload.page.capturedConfig?.options.beforeSubmit).toBe('checkout');
  expect(
    result.payload.capturedRequests.some((request) => request.url.includes('variant=paypal'))
  ).toBe(true);
  expect(requireCheck(result, 'callback-on-submit-filtering').severity).toBe('warn');
  expect(requireCheck(result, 'callback-before-submit').severity).toBe('pass');
  expect(requireCheck(result, 'callback-multiple-submissions').severity).toBe('info');
  expect(requireCheck(result, 'callback-custom-pay-button-compatibility').severity).toBe('warn');
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
  expect(requireCheck(result, 'security-csp-present').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-script-src').severity).toBe('warn');
  expect(requireCheck(result, 'security-sri-css').severity).toBe('warn');
  expect(requireCheck(result, 'security-iframe-referrerpolicy').severity).toBe('pass');
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
  expect(requireCheck(result, 'security-api-key-exposed').severity).toBe('fail');
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
  expect(requireCheck(result, 'sdk-flavor').title).toBe('Integration flavor: Custom.');
  expect(requireCheck(result, 'flow-type').title).toContain('Sessions');
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('skip');
  expect(requireCheck(result, 'auth-client-key-rejected').severity).toBe('pass');
});

test('Client key rejected by Adyen client-side endpoints fails without exposing the key', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=client-key-rejected'
  );

  expect(
    result.payload.capturedRequests.some(
      (request) =>
        request.url.startsWith('https://checkoutshopper-test.adyen.com/') &&
        request.statusCode === 401
    )
  ).toBe(true);
  expect(requireCheck(result, 'auth-client-key-rejected').severity).toBe('fail');
  expect(requireCheck(result, 'auth-client-key-rejected').detail).toContain(
    'HTTP 401 from https://checkoutshopper-test.adyen.com'
  );
  expect(requireCheck(result, 'auth-client-key-rejected').detail).not.toContain('test_dummy');
  expect(result.health.tier).toBe('critical');
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
  expect(requireCheck(result, 'sdk-detected').severity).toBe('info');
  expect(requireCheck(result, 'sdk-import-method').title).toBe('Import method: CDN.');
  expect(requireCheck(result, 'version-detected').severity).toBe('info');
  expect(requireCheck(result, 'auth-client-key').severity).toBe('warn');
  expect(requireCheck(result, 'auth-locale').title).toContain('not in the supported');
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
  expect(result.payload.page.capturedConfig?.options).toMatchObject({
    hasSession: true,
    countryCode: 'NL',
    locale: 'en-US',
    onPaymentCompleted: 'checkout',
    onPaymentFailed: 'checkout',
  });
  expect(requireCheck(result, 'flow-type').title).toContain('Sessions');
  expect(requireCheck(result, 'sdk-flavor').title).toContain('Drop-in');
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('skip');
  expect(requireCheck(result, 'callback-on-payment-completed').severity).toBe('pass');
  expect(requireCheck(result, 'callback-on-payment-failed').severity).toBe('pass');
  expect(requireCheck(result, 'sdk-multi-init').severity).toBe('pass');
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

  expect(result.payload.page.capturedConfig?.options).toMatchObject({
    hasSession: true,
    locale: 'en-US',
  });
  expect(result.payload.page.capturedConfig?.options.countryCode).toBeUndefined();
  expect(requireCheck(result, 'flow-type').title).toContain('Sessions');
  expect(requireCheck(result, 'auth-country-code').severity).toBe('warn');
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('skip');
  expect(requireCheck(result, 'callback-on-payment-completed').severity).toBe('fail');
  expect(requireCheck(result, 'callback-on-payment-failed').severity).toBe('fail');
  expect(requireCheck(result, 'risk-df-iframe').severity).toBe('warn');
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
  expect(result.payload.page.capturedConfig?.options).toMatchObject({
    environment: 'test',
    clientKey: 'test_dummy',
    countryCode: 'NL',
    onSubmit: 'checkout',
    onAdditionalDetails: 'checkout',
    onPaymentCompleted: 'checkout',
    onPaymentFailed: 'checkout',
  });
  expect(requireCheck(result, 'sdk-flavor').title).toContain('Components');
  expect(requireCheck(result, 'flow-type').title).toContain('Advanced');
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('pass');
  expect(requireCheck(result, 'callback-on-submit-state-data').severity).toBe('pass');
  expect(requireCheck(result, 'callback-on-additional-details').severity).toBe('pass');
  expect(requireCheck(result, 'callback-actions-pattern').severity).toBe('pass');
  expect(requireCheck(result, 'risk-df-iframe').severity).toBe('pass');
  expect(result.payload.page.hasCardHolderNameDOM).toBe(true);
  expect(requireCheck(result, 'risk-card-holder-name').severity).toBe('pass');
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

  expect(result.payload.page.capturedConfig?.complete).toBe(true);
  expect(result.payload.page.capturedConfig?.options).toMatchObject({
    onSubmit: 'component',
    onAdditionalDetails: 'component',
    onError: 'component',
    onPaymentCompleted: 'component',
    onPaymentFailed: 'component',
  });
  expect(requireCheck(result, 'callback-on-submit').severity).toBe('warn');
  expect(requireCheck(result, 'callback-on-additional-details').severity).toBe('warn');
  expect(requireCheck(result, 'callback-on-error').severity).toBe('warn');
  expect(requireCheck(result, 'callback-on-payment-completed').severity).toBe('warn');
  expect(requireCheck(result, 'callback-on-payment-failed').severity).toBe('warn');
});

test('SPA route change reuses one Drop-in initialization', async ({ context, extensionId }) => {
  const result = await scanFixture(
    context,
    extensionId,
    'dummy-merchant.html?scenario=spa-single-init'
  );

  expect(result.pageUrl).toContain('#checkout');
  expect(result.payload.page.checkoutInitCount).toBe(1);
  expect(requireCheck(result, 'sdk-multi-init').severity).toBe('pass');
  expect(requireCheck(result, 'flow-type').title).toContain('Sessions');
  expect(requireCheck(result, 'sdk-flavor').title).toContain('Drop-in');
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
  expect(requireCheck(result, 'sdk-multi-init').severity).toBe('warn');
  expect(requireCheck(result, 'sdk-multi-init').title).toContain('count: 2');
  expect(requireCheck(result, 'sdk-flavor').title).toContain('Drop-in');
});

test('Documented CDN assets with valid SRI and compatible CSP pass resource checks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-merchant.html?scenario=cdn-sri');

  expect(
    result.payload.page.scripts.some((script) => script.src.includes('/sdk/6.31.0/adyen.js'))
  ).toBe(true);
  expect(requireCheck(result, 'sdk-import-method').title).toBe('Import method: CDN.');
  expect(requireCheck(result, 'security-sri-script').severity).toBe('pass');
  expect(requireCheck(result, 'security-sri-css').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-script-src').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-reporting').severity).toBe('pass');
  expect(requireCheck(result, 'security-csp-connect-src').severity).toBe('warn');
  expect(requireCheck(result, 'security-csp-connect-src').detail).toContain(
    'https://checkoutanalytics-test.adyen.com (checkout analytics)'
  );
  expect(requireCheck(result, 'security-csp-img-src')).toMatchObject({
    severity: 'warn',
    impact: 'low',
  });
  expect(requireCheck(result, 'security-csp-form-action').title).toBe(
    'CSP does not restrict form-action.'
  );
  expect(requireCheck(result, 'env-cdn-mismatch').severity).toBe('pass');
});

test('The same documented CDN URLs without SRI fail integrity checks', async ({
  context,
  extensionId,
}) => {
  const result = await scanFixture(context, extensionId, 'dummy-merchant.html?scenario=cdn-no-sri');

  expect(
    result.payload.page.scripts.some((script) => script.src.includes('/sdk/6.31.0/adyen.js'))
  ).toBe(true);
  expect(requireCheck(result, 'security-sri-script').severity).toBe('fail');
  expect(requireCheck(result, 'security-sri-css').severity).toBe('warn');
  expect(requireCheck(result, 'security-csp-script-src').severity).toBe('pass');
});
