if (
  new globalThis.URLSearchParams(globalThis.location.search).get('scenario') !==
  'cdn-without-metadata'
) {
  globalThis.AdyenWebMetadata = { version: '6.31.0', bundleType: 'esm' };
}

globalThis.AdyenCheckout = async function AdyenCheckout(options) {
  return {
    options,
    create(type, componentOptions = {}) {
      return {
        mount(selector) {
          const container = globalThis.document.querySelector(selector);
          const component = globalThis.document.createElement('div');
          component.className = `adyen-checkout__${type}`;
          component.textContent = `Dummy ${type} component`;
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
