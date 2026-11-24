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

// Mirrors the v6 class hierarchy: statics such as txVariants are inherited from UIElement.
class UIElement {
  static type = undefined;
  static txVariants = [];

  constructor(checkout, options = {}) {
    this.checkout = checkout;
    this.options = options;
  }

  mount(selector) {
    return this.checkout.create(this.constructor.type, this.options).mount(selector);
  }
}

class Card extends UIElement {
  static type = 'card';
}

class PayPal extends UIElement {
  static type = 'paypal';
}

class Dropin extends UIElement {
  static type = 'dropin';

  // Like v6, Drop-in registers the component classes it is given by reading their statics.
  constructor(checkout, options = {}) {
    super(checkout, options);
    for (const component of options.paymentMethodComponents ?? []) {
      for (const type of [component.type, ...component.txVariants]) {
        if (typeof type !== 'string') throw new TypeError('Invalid payment method component');
      }
    }
  }
}

const components = { card: Card, paypal: PayPal };

// The v6 UMD bundle assigns its namespace once, fully populated.
globalThis.AdyenWeb ||= {};
globalThis.AdyenWeb = {
  AdyenCheckout: globalThis.AdyenCheckout,
  createComponent(type, checkout, options) {
    return new components[type](checkout, { type, ...options });
  },
  Dropin,
  Card,
  PayPal,
};
