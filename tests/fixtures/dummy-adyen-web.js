if (
  new globalThis.URLSearchParams(globalThis.location.search).get('scenario') !==
  'cdn-without-metadata'
) {
  globalThis.AdyenWebMetadata = { version: '6.31.0', bundleType: 'esm' };
}

function renderElement(className, textContent) {
  const element = globalThis.document.createElement('div');
  element.className = className;
  if (textContent !== undefined) element.textContent = textContent;
  return element;
}

// Mirrors the v6 Card component wrapper and new-card form classes.
function renderCard(componentOptions) {
  const card = renderElement('adyen-checkout__card-input');
  const form = renderElement('adyen-checkout__card__form', 'Dummy card component');
  if (componentOptions.hasHolderName === true) {
    form.append(renderElement('adyen-checkout__field adyen-checkout__card__holderName'));
  }
  card.append(form);
  return card;
}

// Mirrors Adyen Web v6 analytics: a mounted component reports a `rendered` info event with the
// showPayButton it rendered with, inherited from AdyenCheckout unless the component sets its own.
// Only scenarios that enable analytics explicitly send it, so other scenarios see no extra traffic.
function reportRendered(checkoutOptions, type, componentOptions) {
  if (checkoutOptions.analytics?.enabled !== true) return;
  const showPayButton = componentOptions.showPayButton ?? checkoutOptions.showPayButton ?? true;
  const component = type === 'card' ? 'scheme' : type;
  globalThis
    .fetch(
      'https://checkoutanalytics-test.adyen.com/checkoutanalytics/v3/analytics/dummy-attempt?clientKey=test_dummy',
      {
        method: 'POST',
        body: globalThis.JSON.stringify({
          channel: 'Web',
          platform: 'Web',
          info: [{ type: 'rendered', component, configData: { showPayButton } }],
          errors: [],
          logs: [],
        }),
      }
    )
    .catch(() => {});
}

globalThis.AdyenCheckout = async function AdyenCheckout(options) {
  return {
    options,
    create(type, componentOptions = {}) {
      return {
        mount(selector) {
          const container = globalThis.document.querySelector(selector);
          const component =
            type === 'card'
              ? renderCard(componentOptions)
              : renderElement(`adyen-checkout__${type}`, `Dummy ${type} component`);
          container.append(component);
          reportRendered(options, type, componentOptions);
          return { element: component, options: componentOptions };
        },
      };
    },
  };
};

function makeComponent(type) {
  return class {
    constructor(checkout, options = {}) {
      this.checkout = checkout;
      this.options = options;
    }

    mount(selector) {
      return this.checkout.create(type, this.options).mount(selector);
    }
  };
}

globalThis.AdyenWeb = {
  AdyenCheckout: globalThis.AdyenCheckout,
  Dropin: makeComponent('dropin'),
  Card: makeComponent('card'),
  PayPal: makeComponent('paypal'),
};
