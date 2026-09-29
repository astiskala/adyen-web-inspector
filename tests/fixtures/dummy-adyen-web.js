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
};
