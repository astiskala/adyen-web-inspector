const scenario = new globalThis.URLSearchParams(globalThis.location.search).get('scenario');
const baseConfig = {
  environment: 'test',
  clientKey: 'test_dummy',
  countryCode: 'NL',
  locale: 'en-US',
  onPaymentCompleted() {},
  onPaymentFailed() {},
  onError() {},
};

async function mountCheckout(options, type) {
  const checkout = await globalThis.AdyenCheckout(options);
  checkout.create(type).mount('#checkout');
}

function addStyle(rules) {
  const style = globalThis.document.createElement('style');
  style.textContent = rules;
  globalThis.document.head.append(style);
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const script = globalThis.document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    globalThis.document.head.append(script);
  });
}

async function runScenario() {
  if (scenario === 'sessions-dropin') {
    await mountCheckout(
      { ...baseConfig, session: { id: 'dummy-session', sessionData: 'dummy' } },
      'dropin'
    );
    const fingerprint = globalThis.document.createElement('iframe');
    fingerprint.name = 'dfIframe';
    fingerprint.src = 'about:blank';
    globalThis.document.body.append(fingerprint);
  } else if (scenario === 'sessions-server') {
    const session = await globalThis
      .fetch('/api/sessions', { method: 'POST' })
      .then((response) => response.json());
    const checkout = await globalThis.AdyenWeb.AdyenCheckout({ ...baseConfig, session });
    new globalThis.AdyenWeb.Dropin(checkout, { showPayButton: true }).mount('#checkout');
  } else if (scenario === 'sessions-server-incomplete') {
    const session = await globalThis
      .fetch('/api/sessions', { method: 'POST' })
      .then((response) => response.json());
    const checkout = await globalThis.AdyenWeb.AdyenCheckout({
      environment: 'test',
      clientKey: 'test_dummy',
      locale: 'en-US',
      session,
      onError() {},
    });
    new globalThis.AdyenWeb.Dropin(checkout).mount('#checkout');
  } else if (scenario === 'advanced-server-card') {
    const paymentMethodsResponse = await globalThis
      .fetch('/api/paymentMethods', { method: 'POST' })
      .then((response) => response.json());
    const checkout = await globalThis.AdyenWeb.AdyenCheckout({
      ...baseConfig,
      paymentMethodsResponse,
      amount: { value: 1000, currency: 'EUR' },
      async onSubmit(state, _component, actions) {
        try {
          const response = await globalThis.fetch('/api/payments', {
            method: 'POST',
            body: globalThis.JSON.stringify(state.data),
          });
          actions.resolve(await response.json());
        } catch {
          actions.reject();
        }
      },
      async onAdditionalDetails(state, _component, actions) {
        try {
          const response = await globalThis.fetch('/api/payments/details', {
            method: 'POST',
            body: globalThis.JSON.stringify(state.data),
          });
          actions.resolve(await response.json());
        } catch {
          actions.reject();
        }
      },
    });
    new globalThis.AdyenWeb.Card(checkout, { hasHolderName: true }).mount('#checkout');
    const fingerprint = globalThis.document.createElement('iframe');
    fingerprint.name = 'dfIframe';
    fingerprint.src = 'about:blank';
    globalThis.document.body.append(fingerprint);
  } else if (scenario === 'component-callbacks') {
    const checkout = await globalThis.AdyenWeb.AdyenCheckout({
      environment: 'test',
      clientKey: 'test_dummy',
      countryCode: 'NL',
      locale: 'en-US',
    });
    new globalThis.AdyenWeb.Card(checkout, {
      onSubmit(_state, _component, actions) {
        actions.resolve({ resultCode: 'Authorised' });
      },
      onAdditionalDetails() {},
      onError() {},
      onPaymentCompleted() {},
      onPaymentFailed() {},
    }).mount('#checkout');
  } else if (scenario === 'spa-single-init') {
    const checkout = await globalThis.AdyenWeb.AdyenCheckout({
      ...baseConfig,
      session: { id: 'dummy-session', sessionData: 'dummy' },
    });
    new globalThis.AdyenWeb.Dropin(checkout).mount('#checkout');
    globalThis.history.pushState({}, '', '#checkout');
  } else if (scenario === 'spa-double-init') {
    const config = {
      ...baseConfig,
      session: { id: 'dummy-session', sessionData: 'dummy' },
    };
    const first = await globalThis.AdyenWeb.AdyenCheckout(config);
    new globalThis.AdyenWeb.Dropin(first).mount('#checkout');
    globalThis.history.pushState({}, '', '#checkout');
    const second = await globalThis.AdyenWeb.AdyenCheckout(config);
    new globalThis.AdyenWeb.Dropin(second).mount('#checkout');
  } else if (scenario === 'advanced-components') {
    await mountCheckout(
      {
        environment: 'test',
        clientKey: 'test_dummy',
        analytics: { enabled: false },
        risk: { enabled: false },
      },
      'card'
    );
  } else if (scenario === 'environment-mismatch') {
    await mountCheckout({ ...baseConfig, environment: 'live' }, 'dropin');
    await loadExternalScript(
      'https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/sdk/6.31.0/adyen.js'
    );
    await globalThis.fetch('https://checkout-live.adyen.com/v71/paymentMethods');
  } else if (scenario === 'regional-cdn') {
    await mountCheckout({ ...baseConfig, environment: 'live-us', clientKey: 'live_dummy' }, 'card');
    await loadExternalScript(
      'https://checkoutshopper-live-eu.cdn.adyen.com/checkoutshopper/sdk/6.31.0/adyen.js'
    );
  } else if (scenario === 'cdn-without-metadata') {
    await mountCheckout({ ...baseConfig, clientKey: 'pub.v2.dummy', locale: 'xx-ZZ' }, 'card');
    await loadExternalScript(
      'https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/sdk/6.31.0/adyen.js'
    );
  } else if (scenario === 'sdk-only') {
    globalThis.document.querySelector('#checkout').textContent = 'SDK loaded, checkout not mounted';
  } else if (scenario === 'secure-headers') {
    await mountCheckout(
      { ...baseConfig, session: { id: 'dummy-session', sessionData: 'dummy' } },
      'dropin'
    );
  } else if (scenario === 'csp-resources') {
    await mountCheckout(baseConfig, 'dropin');
    const script = globalThis.document.createElement('script');
    script.src = 'https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/sdk/6.31.0/adyen.js';
    globalThis.document.head.append(script);
    const stylesheet = globalThis.document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href =
      'https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/sdk/6.31.0/adyen.css';
    globalThis.document.head.append(stylesheet);
    const iframe = globalThis.document.createElement('iframe');
    iframe.name = 'adyen-card';
    iframe.src = 'https://checkoutshopper-test.adyenpayments.com/dfp/dfp.html';
    iframe.srcdoc = '';
    iframe.referrerPolicy = 'no-referrer';
    iframe.loading = 'lazy';
    iframe.style.display = 'none';
    globalThis.document.body.append(iframe);
  } else if (scenario === 'cdn-sri' || scenario === 'cdn-no-sri') {
    await mountCheckout({ ...baseConfig, session: { id: 'dummy-session' } }, 'dropin');
    const script = globalThis.document.createElement('script');
    script.src = 'https://checkoutshopper-test.cdn.adyen.com/sdk/6.31.0/adyen.js';
    const stylesheet = globalThis.document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href =
      'https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/sdk/6.31.0/adyen.css';
    if (scenario === 'cdn-sri') {
      const integrity = 'sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb';
      script.integrity = integrity;
      script.crossOrigin = 'anonymous';
      stylesheet.integrity = integrity;
      stylesheet.crossOrigin = 'anonymous';
    }
    await Promise.all(
      [script, stylesheet].map(
        (resource) =>
          new Promise((resolve, reject) => {
            resource.onload = resolve;
            resource.onerror = reject;
            globalThis.document.head.append(resource);
          })
      )
    );
  } else if (scenario === 'legacy-v6') {
    globalThis.AdyenWebMetadata.version = '6.10.0';
    const options = {
      ...baseConfig,
      onSubmit(_state, component) {
        component.setStatus('success');
      },
      onAdditionalDetails() {},
      onValid() {},
      setStatusAutomatically: true,
    };
    await mountCheckout(options, 'card');
    await globalThis.AdyenCheckout(options);
  } else if (scenario === 'styling-overrides') {
    await mountCheckout(baseConfig, 'card');
    addStyle(
      '.adyen-checkout__card { color: red; } :root { --adyen-sdk-color-label-primary: blue; }'
    );
  } else if (scenario === 'styling-custom') {
    await mountCheckout(baseConfig, 'card');
    addStyle(':root { --adyen-sdk-color-label-primary: blue; }');
  } else if (scenario === 'third-party') {
    await mountCheckout(baseConfig, 'dropin');
    const urls = [
      'https://www.googletagmanager.com/gtm.js?id=GTM-DUMMY',
      'https://script.hotjar.com/dummy.js',
      'https://connect.facebook.net/en_US/fbevents.js',
    ];
    await Promise.all(urls.map(loadExternalScript));
  } else if (scenario === 'inferred-only') {
    globalThis.JSON.parse('{"environment":"test","countryCode":"NL"}');
  } else if (scenario === 'advanced-actions') {
    await mountCheckout(
      {
        ...baseConfig,
        onSubmit(_state, _component, actions) {
          actions.resolve({ resultCode: 'Authorised' });
        },
        onAdditionalDetails() {},
      },
      'card'
    );
  } else if (scenario === 'custom-pay-button') {
    const button = globalThis.document.createElement('button');
    button.id = 'pay-button';
    button.textContent = 'Pay';
    globalThis.document.querySelector('#checkout').append(button);
    await mountCheckout(
      {
        ...baseConfig,
        onSubmit(state, _component, actions) {
          if (state.data.paymentMethod.type === 'paypal') {
            actions.resolve({ resultCode: 'Authorised' });
          }
        },
        beforeSubmit() {
          const payButton = globalThis.document.querySelector('#pay-button');
          payButton.disabled = true;
        },
      },
      'card'
    );
    await globalThis.fetch('https://checkout-test.adyen.com/v71/paymentMethods?variant=paypal');
  } else if (scenario === 'exposed-decoy') {
    await mountCheckout(baseConfig, 'card');
    const decoy = `AQ${'A'.repeat(24)}==-${'B'.repeat(24)}=-${'C'.repeat(24)}`;
    const script = globalThis.document.createElement('script');
    script.type = 'application/json';
    script.textContent = globalThis.JSON.stringify({ syntheticDecoy: decoy });
    globalThis.document.body.append(script);
  } else {
    throw new Error(`Unknown dummy integration: ${scenario}`);
  }
  globalThis.document.documentElement.dataset.fixtureReady = 'true';
}

runScenario();
