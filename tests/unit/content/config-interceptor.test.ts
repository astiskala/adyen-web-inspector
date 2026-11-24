import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { PAGE_GLOBALS } from '../../../src/shared/constants';
import type { CheckoutCapture, InferenceSignal } from '../../../src/shared/types';

const CAPTURE_KEY = PAGE_GLOBALS.checkoutCapture;
const INSTALLED_KEY = PAGE_GLOBALS.interceptorInstalled;
const NATIVE_JSON_PARSE = JSON.parse;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Restored onto Element.prototype, its own receiver.
const NATIVE_ATTACH_SHADOW = Element.prototype.attachShadow;

type CapturedConfig = Record<string, unknown>;
type CheckoutFactory = (config: unknown) => Promise<unknown>;

function getCapture(): CheckoutCapture | undefined {
  return (globalThis as unknown as Record<string, unknown>)[CAPTURE_KEY] as
    CheckoutCapture | undefined;
}

function getCapturedConfig(): CapturedConfig | undefined {
  return getCapture()?.captured?.options as CapturedConfig | undefined;
}

function isCaptureComplete(): boolean | undefined {
  return getCapture()?.captured?.complete;
}

function getInferredConfig(signal: InferenceSignal = 'adyen-request'): CapturedConfig | undefined {
  return getCapture()?.inferred[signal] as CapturedConfig | undefined;
}

/**
Removes the listeners and observers earlier interceptor copies installed, so only the current copy reacts.
*/
const cleanups: (() => void)[] = [];

function resetGlobals(): void {
  for (const cleanup of cleanups.splice(0)) cleanup();
  const g = globalThis as unknown as Record<string, unknown>;
  Reflect.deleteProperty(g, CAPTURE_KEY);
  Reflect.deleteProperty(g, INSTALLED_KEY);
  Reflect.deleteProperty(g, 'AdyenCheckout');
  Reflect.deleteProperty(g, 'AdyenWeb');
  Reflect.deleteProperty(g, 'define');
  JSON.parse = NATIVE_JSON_PARSE;
  Element.prototype.attachShadow = NATIVE_ATTACH_SHADOW;
  Reflect.deleteProperty(g, PAGE_GLOBALS.closedShadowRoots);
  vi.stubGlobal('fetch', undefined);
  vi.stubGlobal('XMLHttpRequest', undefined);
}

/**
The XMLHttpRequest.open the interceptor wraps.
*/
const nativeOpen = vi.fn();

async function loadInterceptor(): Promise<void> {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));

  nativeOpen.mockReset();
  vi.stubGlobal('XMLHttpRequest', vi.fn());
  XMLHttpRequest.prototype.open = nativeOpen;

  const addListener = vi.spyOn(document, 'addEventListener');
  const observe = vi.spyOn(MutationObserver.prototype, 'observe');
  await import('../../../src/content/config-interceptor.js');
  for (const [type, listener, options] of addListener.mock.calls) {
    cleanups.push(() => {
      document.removeEventListener(type, listener, options);
    });
  }
  for (const observer of observe.mock.contexts) {
    cleanups.push(() => {
      (observer as MutationObserver).disconnect();
    });
  }
  addListener.mockRestore();
  observe.mockRestore();
}

/**
Defines an SDK global as a CDN script would, then fires that script's load event.
*/
function loadSdkScript(name: 'AdyenCheckout' | 'AdyenWeb', value: unknown): void {
  Reflect.set(globalThis, name, value);
  const script = document.createElement('script');
  document.head.append(script);
  script.dispatchEvent(new Event('load'));
  script.remove();
}

class Card {
  readonly options: unknown;
  constructor(_checkout: unknown, options: unknown) {
    this.options = options;
  }
}

function Dropin(_checkout: unknown, options: unknown): { options: unknown } {
  return { options };
}

function installAdyenCheckoutFactory(factory: CheckoutFactory): void {
  loadSdkScript('AdyenCheckout', factory);
}

function callAdyenCheckout(config: unknown): Promise<unknown> {
  const checkout = (globalThis as unknown as Record<string, unknown>)['AdyenCheckout'];
  if (typeof checkout !== 'function') {
    throw new TypeError('AdyenCheckout factory was not installed');
  }
  return (checkout as CheckoutFactory)(config);
}

describe('config-interceptor', () => {
  beforeEach(async () => {
    resetGlobals();
    await loadInterceptor();
  });

  afterAll(() => {
    resetGlobals();
  });

  describe('SDK globals', () => {
    it('captures full config from a resolved Adyen Core instance', async () => {
      const fakeCheckout = {
        create: (): void => {},
        options: {
          clientKey: 'test_PROMISE123',
          environment: 'test',
          locale: 'en-US',
          countryCode: 'NL',
        },
      };

      installAdyenCheckoutFactory(async () => fakeCheckout);
      await callAdyenCheckout({});

      const config = getCapturedConfig();
      expect(getCapture()?.initCount).toBe(1);
      expect(config).toBeDefined();
      expect(config?.['clientKey']).toBe('test_PROMISE123');
      expect(config?.['environment']).toBe('test');
      expect(config?.['locale']).toBe('en-US');
      expect(config?.['countryCode']).toBe('NL');
      expect(isCaptureComplete()).toBe(true);
    });

    it('records a directly observed empty checkout options object', async () => {
      installAdyenCheckoutFactory(async () => ({
        create: (): void => {},
        options: {},
      }));
      await callAdyenCheckout({});

      expect(getCapturedConfig()).toEqual({});
      expect(isCaptureComplete()).toBe(true);
    });

    it('captures config from _options property', async () => {
      const fakeCheckout = {
        create: (): void => {},
        _options: {
          clientKey: 'live_OPTS456',
          environment: 'live',
          locale: 'nl-NL',
        },
      };

      installAdyenCheckoutFactory(async () => fakeCheckout);
      await callAdyenCheckout({});

      const config = getCapturedConfig();
      expect(config).toBeDefined();
      expect(config?.['clientKey']).toBe('live_OPTS456');
      expect(config?.['environment']).toBe('live');
      expect(config?.['locale']).toBe('nl-NL');
    });

    it('captures callbacks from the checkout config', async () => {
      const fakeCheckout = {
        create: (): void => {},
        options: {
          clientKey: 'test_CB',
          environment: 'test',
          countryCode: 'SG',
          onSubmit: (): void => {},
          onError: (): void => {},
        },
      };

      installAdyenCheckoutFactory(async () => fakeCheckout);
      await callAdyenCheckout({});

      const config = getCapturedConfig();
      expect(config).toBeDefined();
      expect(config?.['countryCode']).toBe('SG');
      expect(config?.['onSubmit']).toBe('checkout');
      expect(config?.['onError']).toBe('checkout');
    });

    it('captures nested risk configuration', async () => {
      const fakeCheckout = {
        create: (): void => {},
        options: {
          clientKey: 'test_RISK',
          environment: 'test',
          risk: { enabled: false },
        },
      };

      installAdyenCheckoutFactory(async () => fakeCheckout);
      await callAdyenCheckout({});

      expect(getCapturedConfig()?.['riskEnabled']).toBe(false);
    });

    it('captures redirectFromTopWhenInIframe from the checkout config', async () => {
      installAdyenCheckoutFactory(async () => ({
        create: (): void => {},
        options: { clientKey: 'test_TOP', redirectFromTopWhenInIframe: true },
      }));
      await callAdyenCheckout({});

      expect(getCapturedConfig()?.['redirectFromTopWhenInIframe']).toBe(true);
    });

    it('wraps create on the captured instance for component config', async () => {
      const fakeCheckout: Record<string, unknown> = {
        create: (_type: unknown, _config?: unknown) => ({}),
        options: { clientKey: 'test_WRAP', environment: 'test' },
      };

      installAdyenCheckoutFactory(async () => fakeCheckout);
      await callAdyenCheckout({});

      (fakeCheckout['create'] as (t: string, c: Record<string, unknown>) => unknown)('card', {
        countryCode: 'NL',
        locale: 'nl-NL',
      });

      const config = getCapturedConfig();
      expect(config?.['clientKey']).toBe('test_WRAP');
      expect(config?.['countryCode']).toBe('NL');
      expect(config?.['locale']).toBe('nl-NL');
    });
  });

  describe('AdyenWeb namespace', () => {
    it('wraps the checkout factory and component constructors it exposes', async () => {
      const g = globalThis as unknown as Record<string, unknown>;
      loadSdkScript('AdyenWeb', {
        AdyenCheckout: async (): Promise<unknown> => ({
          create: (): void => {},
          options: { clientKey: 'test_NS' },
        }),
        Card,
        Dropin,
        version: '6.31.0',
      });
      const namespace = g['AdyenWeb'] as Record<string, unknown>;

      await (namespace['AdyenCheckout'] as CheckoutFactory)({ countryCode: 'NL' });
      const card = new (namespace['Card'] as typeof Card)({}, { locale: 'nl-NL' });
      const dropin = (namespace['Dropin'] as typeof Dropin)({}, { onSubmit: (): void => {} });

      expect(card).toBeInstanceOf(Card);
      expect(card.options).toEqual({ locale: 'nl-NL' });
      expect(dropin.options).toHaveProperty('onSubmit');
      expect(namespace['Card']).not.toBe(Card);
      expect(namespace['version']).toBe('6.31.0');
      expect(getCapturedConfig()).toMatchObject({
        countryCode: 'NL',
        clientKey: 'test_NS',
        locale: 'nl-NL',
        onSubmit: 'component',
      });
    });
  });

  describe('Network interception', () => {
    it.each([
      {
        label: 'fetch URL (live)',
        url: 'https://checkoutshopper-live.adyen.com/checkoutshopper/v1/sdk-identity',
        environment: 'live',
      },
      {
        label: 'fetch URL (test)',
        url: 'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sdk-identity',
        environment: 'test',
      },
      {
        label: 'adyenpayments.com URL (live-in)',
        url: 'https://checkout-live-in.adyenpayments.com/checkout/v1/sdk-identity',
        environment: 'live-in',
      },
      {
        label: 'regional live URL (live-us)',
        url: 'https://checkout-live-us.adyen.com/checkout/v1/sdk-identity',
        environment: 'live-us',
      },
    ])('captures environment from $label', async ({ url, environment }) => {
      await globalThis.fetch(url);
      const config = getInferredConfig();
      expect(config?.['environment']).toBe(environment);
    });

    it('captures clientKey from fetch query parameters', async () => {
      await globalThis.fetch(
        'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sdk-identity?clientKey=test_NET123'
      );
      const config = getInferredConfig();
      expect(config?.['clientKey']).toBe('test_NET123');
    });

    it('captures locale from translation file URL', async () => {
      await globalThis.fetch(
        'https://checkoutshopper-live-in.cdn.adyen.com/checkoutshopper/sdk/6.30.0/translations/en-US.json'
      );
      const config = getInferredConfig();
      expect(config?.['locale']).toBe('en-US');
    });

    it('captures from XMLHttpRequest.open', () => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        'GET',
        'https://checkoutshopper-live.adyen.com/checkoutshopper/v1/sdk-identity?clientKey=live_XHR456'
      );
      const config = getInferredConfig();
      expect(config?.['environment']).toBe('live');
      expect(config?.['clientKey']).toBe('live_XHR456');
    });

    it('reads URL and Request inputs, and leaves the record alone for other hosts', async () => {
      await globalThis.fetch(new URL('https://checkoutshopper-test.adyen.com/v1/x?locale=nl-NL'));
      await globalThis.fetch(
        new Request('https://checkoutshopper-test.adyen.com/v1/x?countryCode=NL')
      );
      new XMLHttpRequest().open('GET', new URL('https://checkoutshopper-test.adyen.com/v1/x'));
      const before = getCapture();
      await globalThis.fetch('https://merchant.example/api/config?clientKey=test_K');

      expect(getInferredConfig()).toEqual({
        environment: 'test',
        locale: 'nl-NL',
        countryCode: 'NL',
      });
      expect(getCapture()).toBe(before);
    });
  });

  describe('Adyen checkout analytics bodies', () => {
    const ANALYTICS_URL =
      'https://checkoutanalytics-test.adyen.com/checkoutanalytics/v3/analytics/attempt-1?clientKey=test_K';
    const renderedPayPal = JSON.stringify({
      channel: 'Web',
      info: [{ type: 'rendered', component: 'paypal', configData: { showPayButton: false } }],
    });

    it('records SDK fields and component events from analytics requests only', async () => {
      await globalThis.fetch(ANALYTICS_URL, { method: 'POST', body: renderedPayPal });
      await globalThis.fetch('https://merchant.example/log', {
        method: 'POST',
        body: JSON.stringify({ info: [{ type: 'rendered', component: 'klarna' }] }),
      });

      expect(getCapture()?.analytics).toEqual({
        sdk: { channel: 'Web' },
        rendered: [{ type: 'paypal', showPayButton: false }],
        paymentMethods: ['paypal'],
      });
    });

    it('ignores bodies it cannot read synchronously, and does not read them as page JSON', async () => {
      await globalThis.fetch(ANALYTICS_URL, { method: 'POST', body: 'not json' });
      await globalThis.fetch(ANALYTICS_URL, { method: 'POST', body: new Blob([renderedPayPal]) });
      await globalThis.fetch(new Request(ANALYTICS_URL, { method: 'POST', body: renderedPayPal }));
      await globalThis.fetch(ANALYTICS_URL, {
        method: 'POST',
        body: JSON.stringify({ version: '6.0.0', locale: 'nl-NL', countryCode: 'NL' }),
      });

      expect(getCapture()?.analytics).toEqual({
        sdk: { version: '6.0.0', locale: 'nl-NL' },
        rendered: [],
        paymentMethods: [],
      });
      expect(getInferredConfig('page-json')).toBeUndefined();
    });
  });

  describe('checkout factory edge cases', () => {
    it('leaves non-function AdyenCheckout values alone and does not wrap a factory twice', async () => {
      const g = globalThis as unknown as Record<string, unknown>;
      loadSdkScript('AdyenCheckout', { notAFactory: true });
      expect(g['AdyenCheckout']).toEqual({ notAFactory: true });

      installAdyenCheckoutFactory(async () => null);
      const wrapped = g['AdyenCheckout'];
      loadSdkScript('AdyenCheckout', wrapped);
      expect(g['AdyenCheckout']).toBe(wrapped);
    });

    it('ignores factory results that are not checkout instances, and captures an instance once', async () => {
      const instance = { create: (): void => {}, options: { clientKey: 'test_ONCE' } };
      const results: unknown[] = ['not an object', { create: (): void => {} }, instance, instance];
      installAdyenCheckoutFactory(async () => results.shift());

      await callAdyenCheckout([]);
      await callAdyenCheckout([]);
      expect(getCapture()?.captured).toBeNull();

      await callAdyenCheckout([]);
      const afterFirst = getCapture();
      await callAdyenCheckout([]);

      expect(getCapturedConfig()).toEqual({ clientKey: 'test_ONCE' });
      expect(getCapture()?.captured).toEqual(afterFirst?.captured);
      expect(getCapture()?.initCount).toBe(4);
    });
  });

  describe('JSON.parse interception', () => {
    it('keeps parsed bootstrap fields separate from directly captured checkout options', async () => {
      JSON.parse('{"countryCode":"NL"}');
      installAdyenCheckoutFactory(async () => ({
        create: (): void => {},
        options: { clientKey: 'test_DIRECT' },
      }));
      await callAdyenCheckout({});

      expect(getCapturedConfig()).toEqual({ clientKey: 'test_DIRECT' });
      expect(getInferredConfig('page-json')).toEqual({ countryCode: 'NL' });
      expect(getInferredConfig('adyen-request')).toBeUndefined();
      expect(isCaptureComplete()).toBe(true);
    });

    it('records a parsed bootstrap object as inferred from page JSON', () => {
      const raw = JSON.stringify({
        clientKey: 'test_JSON789',
        environment: 'test',
        locale: 'en-GB',
      });
      JSON.parse(raw);
      const config = getInferredConfig('page-json');
      expect(config?.['clientKey']).toBe('test_JSON789');
      expect(config?.['environment']).toBe('test');
      expect(config?.['locale']).toBe('en-GB');
      expect(getCapturedConfig()).toBeUndefined();
      expect(isCaptureComplete()).toBeUndefined();
    });
  });

  describe('idempotency', () => {
    it('does not break when the interceptor is loaded twice', async () => {
      await import('../../../src/content/config-interceptor.js');
      installAdyenCheckoutFactory(async () => ({
        create: (): void => {},
        options: { clientKey: 'test_IDEM', environment: 'test' },
      }));

      await callAdyenCheckout({});

      const config = getCapturedConfig();
      expect(config).toBeDefined();
      expect(config?.['clientKey']).toBe('test_IDEM');
    });
  });
});

/**
Shaped like Adyen Web v6 UMD classes: statics such as txVariants live on the base class.
*/
class UIElement {
  static readonly type: string | undefined = undefined;
  static readonly txVariants: readonly string[] = [];
  readonly options: Record<string, unknown>;
  constructor(_checkout: unknown, options: Record<string, unknown> = {}) {
    this.options = options;
  }
}

class SdkCard extends UIElement {
  static override readonly type = 'scheme';
}

class SdkDropin extends UIElement {
  readonly registered: string[];
  constructor(checkout: unknown, options: { paymentMethodComponents?: (typeof UIElement)[] } = {}) {
    super(checkout, options);
    // Drop-in registers the classes it is given by reading their statics, as Adyen Web v6 does.
    this.registered = (options.paymentMethodComponents ?? []).flatMap((component) =>
      [component.type, ...component.txVariants].filter((type) => type !== undefined)
    );
  }
}

describe('config-interceptor with SDK-shaped classes', () => {
  const g = globalThis as unknown as Record<string, unknown>;

  beforeEach(async () => {
    resetGlobals();
    await loadInterceptor();
  });

  afterAll(() => {
    resetGlobals();
  });

  function installNamespace(namespace: Record<string, unknown>): Record<string, unknown> {
    loadSdkScript('AdyenWeb', namespace);
    return g['AdyenWeb'] as Record<string, unknown>;
  }

  it('keeps inherited statics, so Drop-in can register wrapped components', () => {
    const namespace = installNamespace({ Card: SdkCard, Dropin: SdkDropin });
    const WrappedCard = namespace['Card'] as typeof SdkCard;
    const WrappedDropin = namespace['Dropin'] as typeof SdkDropin;

    const dropin = new WrappedDropin({}, { paymentMethodComponents: [WrappedCard] });

    expect(WrappedCard.txVariants).toEqual([]);
    expect(dropin.registered).toEqual(['scheme']);
    expect(dropin).toBeInstanceOf(SdkDropin);
    expect(getCapture()).toBeUndefined();
  });

  it('constructs merchant subclasses of wrapped components with their own prototype', () => {
    const namespace = installNamespace({ Card: SdkCard });
    const WrappedCard = namespace['Card'] as typeof SdkCard;
    class MerchantCard extends WrappedCard {
      label(): string {
        return 'merchant';
      }
    }

    const card = new MerchantCard({}, { locale: 'nl-NL' });

    expect(card.label()).toBe('merchant');
    expect(card).toBeInstanceOf(WrappedCard);
    expect(getCapturedConfig()).toEqual({ locale: 'nl-NL' });
  });

  it('captures the options passed to createComponent', () => {
    const namespace = installNamespace({
      createComponent: (type: string, checkout: unknown, options: Record<string, unknown>) =>
        new SdkCard(checkout, { type, ...options }),
    });
    const createComponent = namespace['createComponent'] as (
      type: string,
      checkout: unknown,
      options?: unknown
    ) => SdkCard;

    const component = createComponent('paypal', { options: { session: {} } }, { locale: 'nl-NL' });
    createComponent('card', {});

    expect(component.options).toEqual({ type: 'paypal', locale: 'nl-NL' });
    expect(getCapturedConfig()).toEqual({ locale: 'nl-NL' });
    expect(isCaptureComplete()).toBe(false);
  });

  it('wraps a checkout class constructed with new, and reads the instance it builds', () => {
    class LegacyCheckout {
      readonly options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this.options = { ...options, locale: 'en-US' };
      }
      create(_type: string, _options?: unknown): Record<string, unknown> {
        return {};
      }
    }
    loadSdkScript('AdyenCheckout', LegacyCheckout);
    const Checkout = g['AdyenCheckout'] as typeof LegacyCheckout;

    const checkout = new Checkout({ clientKey: 'test_V4' });
    checkout.create('card', { countryCode: 'NL' });

    expect(checkout).toBeInstanceOf(LegacyCheckout);
    expect(getCapture()?.initCount).toBe(1);
    expect(getCapturedConfig()).toEqual({
      clientKey: 'test_V4',
      locale: 'en-US',
      countryCode: 'NL',
    });
  });

  it('lets XMLHttpRequest.open errors reach the page', () => {
    nativeOpen.mockImplementation(() => {
      throw new SyntaxError('Invalid URL');
    });

    expect(() => {
      new XMLHttpRequest().open('GET', 'http://[bad');
    }).toThrow('Invalid URL');
  });
});

async function nullFactory(): Promise<unknown> {
  return null;
}

type AmdDefine = ((...parameters: unknown[]) => void) & {
  amd: object;
  modules: unknown[];
  factories: unknown[];
};

/**
A RequireJS-shaped define that runs each factory at once, giving 'exports' an exports object.
*/
function installAmdLoader(): AmdDefine {
  const modules: unknown[] = [];
  const factories: unknown[] = [];
  function define(...parameters: unknown[]): void {
    const factory = parameters.at(-1);
    factories.push(factory);
    if (typeof factory !== 'function') {
      modules.push(factory);
      return;
    }
    const dependencies = parameters.find((parameter) => Array.isArray(parameter)) as
      string[] | undefined;
    const exports: Record<string, unknown> = {};
    const result: unknown = Reflect.apply(
      factory,
      undefined,
      (dependencies ?? []).map((name) => (name === 'exports' ? exports : name))
    );
    modules.push(result ?? exports);
  }
  Reflect.set(
    globalThis,
    'define',
    Object.assign(define, { amd: { jQuery: true }, modules, factories })
  );
  return Reflect.get(globalThis, 'define') as AmdDefine;
}

function cartModule(): string {
  return 'cart';
}

async function AdyenCheckout(): Promise<unknown> {
  return null;
}

function requireSugar(require: unknown): unknown {
  return require;
}

function returnNullFactory(): typeof nullFactory {
  return nullFactory;
}

function returnCartModule(): typeof cartModule {
  return cartModule;
}

function returnNamedCheckout(): typeof AdyenCheckout {
  return AdyenCheckout;
}

describe('config-interceptor installation and edge cases', () => {
  const g = globalThis as unknown as Record<string, unknown>;

  beforeEach(async () => {
    resetGlobals();
    await loadInterceptor();
  });

  afterAll(() => {
    resetGlobals();
  });

  it('leaves SDK globals undefined until a script defines them', () => {
    expect(typeof g['AdyenCheckout']).toBe('undefined');
    expect(g['AdyenWeb']).toBeUndefined();
  });

  it('captures a bundle that defines the SDK and calls it in the same script', async () => {
    g['AdyenCheckout'] = async (): Promise<unknown> => null;
    await callAdyenCheckout({ countryCode: 'BE' });

    expect(getCapturedConfig()).toEqual({ countryCode: 'BE' });
  });

  it('wraps an SDK global that replaced the trap once its script has loaded', async () => {
    Object.defineProperty(globalThis, 'AdyenCheckout', {
      value: async (): Promise<unknown> => null,
      writable: true,
      configurable: true,
    });
    const script = document.createElement('script');
    document.head.append(script);
    script.dispatchEvent(new Event('load'));

    await callAdyenCheckout({ locale: 'it-IT' });
    expect(getCapturedConfig()).toEqual({ locale: 'it-IT' });
  });

  it('leaves an SDK global the page made read-only unwrapped and working', async () => {
    const factory = nullFactory;
    Object.defineProperty(globalThis, 'AdyenCheckout', {
      value: factory,
      writable: false,
      configurable: true,
    });
    const script = document.createElement('script');
    document.head.append(script);
    script.dispatchEvent(new Event('load'));

    expect(g['AdyenCheckout']).toBe(factory);
    await callAdyenCheckout({ locale: 'it-IT' });
    expect(getCapture()).toBeUndefined();
  });

  it('wraps the SDK before the loading script runs its own onload handler', async () => {
    let calledWith: unknown;
    const script = document.createElement('script');
    script.addEventListener('load', () => {
      calledWith = g['AdyenCheckout'];
      void callAdyenCheckout({ locale: 'nl-NL' });
    });
    document.head.append(script);
    const factory = async (): Promise<unknown> => null;
    g['AdyenCheckout'] = factory;

    script.dispatchEvent(new Event('load'));
    await Promise.resolve();

    expect(calledWith).not.toBe(factory);
    expect(getCapturedConfig()).toEqual({ locale: 'nl-NL' });
  });

  it('wraps an SDK an inline script declared before the parser inserts the next script', async () => {
    // A top-level declaration replaces the trap with a plain data property.
    Object.defineProperty(globalThis, 'AdyenCheckout', {
      value: async (): Promise<unknown> => null,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    document.body.append(document.createElement('script'));
    // Mutation callbacks run in the microtask checkpoint the parser performs before each script.
    await Promise.resolve();

    await callAdyenCheckout({ countryCode: 'NL' });
    expect(getCapturedConfig()).toEqual({ countryCode: 'NL' });
  });

  it('stops observing the parser at DOMContentLoaded but still wraps lazily loaded SDK scripts', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const defineDirectly = (): void => {
      Object.defineProperty(globalThis, 'AdyenCheckout', {
        value: async (): Promise<unknown> => null,
        writable: true,
        configurable: true,
      });
    };
    defineDirectly();
    document.body.append(document.createElement('div'));
    await Promise.resolve();
    await callAdyenCheckout({ locale: 'en-US' });
    expect(getCapture()).toBeUndefined();

    defineDirectly();
    const script = document.createElement('script');
    document.head.append(script);
    script.dispatchEvent(new Event('load'));
    await callAdyenCheckout({ locale: 'fr-FR' });
    expect(getCapturedConfig()).toEqual({ locale: 'fr-FR' });
  });

  it('wraps SDK globals already defined when the interceptor starts, as in a late frame', async () => {
    resetGlobals();
    g['AdyenCheckout'] = async (): Promise<unknown> => null;
    await loadInterceptor();

    await callAdyenCheckout({ locale: 'de-DE' });
    expect(getCapturedConfig()).toEqual({ locale: 'de-DE' });
  });

  it('records closed shadow roots by host and leaves attachShadow working', () => {
    const closedHost = document.createElement('div');
    const openHost = document.createElement('div');
    const closed = closedHost.attachShadow({ mode: 'closed' });
    const open = openHost.attachShadow({ mode: 'open' });

    const roots = g[PAGE_GLOBALS.closedShadowRoots] as WeakMap<Element, ShadowRoot>;
    expect(roots.get(closedHost)).toBe(closed);
    expect(roots.has(openHost)).toBe(false);
    expect(openHost.shadowRoot).toBe(open);
    expect(() => closedHost.attachShadow({ mode: 'open' })).toThrow();
  });

  it('captures a v6 UMD build that RequireJS defines through an exports object', async () => {
    const define = installAmdLoader();
    expect(define.amd).toEqual({ jQuery: true });

    define(['exports'], (exports: Record<string, unknown>) => {
      exports['AdyenCheckout'] = nullFactory;
      exports['Card'] = Card;
    });
    const namespace = define.modules[0] as Record<string, unknown>;

    await (namespace['AdyenCheckout'] as CheckoutFactory)({ countryCode: 'NL' });
    expect(namespace['Card']).not.toBe(Card);
    expect(getCapturedConfig()).toEqual({ countryCode: 'NL' });
  });

  it('captures a v5 UMD build whose AMD factory returns AdyenCheckout', async () => {
    const define = installAmdLoader();
    const script = document.createElement('script');
    script.src = 'https://shop.example/static/frontend/Magento/luma/Adyen_Payment/js/adyen.js';
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    try {
      define(returnNullFactory);
    } finally {
      Reflect.deleteProperty(document, 'currentScript');
    }
    define(() => ({ AdyenCheckout: 'not a factory' }));

    await (define.modules[0] as CheckoutFactory)({ locale: 'nl-NL' });
    expect(getCapturedConfig()).toEqual({ locale: 'nl-NL' });
  });

  it('recognises an AdyenCheckout factory module by name, and leaves other modules alone', async () => {
    const define = installAmdLoader();
    define([], returnCartModule);
    define([], returnNamedCheckout);
    define(requireSugar);

    expect(define.modules[0]).toBe(cartModule);
    // RequireJS reads a sugar factory's source for require() calls, so it must reach define as is.
    expect(define.factories[2]).toBe(requireSugar);
    await (define.modules[1] as CheckoutFactory)({ locale: 'en-GB' });
    expect(getCapturedConfig()).toEqual({ locale: 'en-GB' });
  });

  it('captures an AMD module that returns an Adyen Web namespace', async () => {
    const define = installAmdLoader();
    define(['jquery'], (jquery: unknown) => ({ AdyenCheckout: nullFactory, jquery }));
    const namespace = define.modules[0] as Record<string, unknown>;

    expect(namespace['jquery']).toBe('jquery');
    await (namespace['AdyenCheckout'] as CheckoutFactory)({ countryCode: 'DE' });
    expect(getCapturedConfig()).toEqual({ countryCode: 'DE' });
  });

  it('passes define calls without a factory function through', () => {
    const define = installAmdLoader();
    define('config', { mode: 'test' });

    expect(define.modules).toEqual([{ mode: 'test' }]);
  });

  it('records checkout Resource Timing entries past the browser buffer, up to a limit', async () => {
    resetGlobals();
    const observe = vi.fn();
    let callback: ((list: { getEntries: () => object[] }) => void) | undefined;
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        observe = observe;
        constructor(observer: typeof callback) {
          callback = observer;
        }
      }
    );
    const deliver = (entries: object[]): void => {
      callback?.({ getEntries: () => entries });
    };
    await loadInterceptor();
    const sessions = { name: 'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sessions' };

    deliver([{ name: 'https://pixel.example/p.gif' }, sessions]);
    deliver(Array.from({ length: 600 }, () => sessions));

    expect(observe).toHaveBeenCalledWith({ type: 'resource', buffered: true });
    const recorded = g[PAGE_GLOBALS.observedResources] as object[];
    expect(recorded).toHaveLength(500);
    expect(recorded[0]).toBe(sessions);
    vi.unstubAllGlobals();
  });

  it('leaves page APIs alone when another copy is already installed', async () => {
    resetGlobals();
    g[INSTALLED_KEY] = true;
    await loadInterceptor();

    expect(vi.isMockFunction(globalThis.fetch)).toBe(true);
  });

  it('returns parsed values unchanged, even when inspecting them throws', () => {
    const hostile = new Proxy(
      {},
      {
        get: (): never => {
          throw new Error('trap');
        },
      }
    );

    expect(JSON.parse('42')).toBe(42);
    expect(JSON.parse('{}', () => hostile)).toBe(hostile);
    expect(getCapture()).toBeUndefined();
  });

  it('passes other fetch inputs through without reading them', async () => {
    const input = { toString: (): string => 'https://checkoutshopper-test.adyen.com/v1/x' };

    await globalThis.fetch(input as unknown as string);
    new XMLHttpRequest().open('GET', input as unknown as string);

    expect(getCapture()).toBeUndefined();
    expect(nativeOpen).toHaveBeenCalledWith('GET', input);
  });

  it('keeps component statics and ignores constructors called without options', () => {
    class StaticCard {
      static readonly type = 'card';
      readonly checkout: unknown;
      constructor(checkout: unknown) {
        this.checkout = checkout;
      }
    }
    loadSdkScript('AdyenWeb', { Card: StaticCard });
    const namespace = g['AdyenWeb'] as { Card: typeof StaticCard };

    const card = new namespace.Card({});

    expect(namespace.Card.type).toBe('card');
    expect(card).toBeInstanceOf(StaticCard);
    expect(getCapture()).toBeUndefined();
  });

  it('leaves AdyenWeb values that are not namespaces alone', () => {
    loadSdkScript('AdyenWeb', undefined);

    expect(g['AdyenWeb']).toBeUndefined();
  });

  it('reads the instance a synchronous factory returns', () => {
    const instance = { create: (): void => {}, options: { clientKey: 'test_SYNC' } };
    loadSdkScript('AdyenCheckout', (): unknown => instance);

    (g['AdyenCheckout'] as (config: unknown) => unknown)({ countryCode: 'NL' });

    expect(getCapturedConfig()).toEqual({ countryCode: 'NL', clientKey: 'test_SYNC' });
  });

  it('leaves read-only namespaces, such as module namespace objects, unwrapped', () => {
    const namespace = Object.freeze({ Card: SdkCard });
    loadSdkScript('AdyenWeb', namespace);

    expect(g['AdyenWeb']).toBe(namespace);
    expect(namespace.Card).toBe(SdkCard);
  });

  it('keeps a rejecting factory rejecting for its caller', async () => {
    installAdyenCheckoutFactory(async () => {
      throw new Error('init failed');
    });

    await expect(callAdyenCheckout({ locale: 'nl-NL' })).rejects.toThrow('init failed');
    expect(getCapturedConfig()).toEqual({ locale: 'nl-NL' });
  });

  it('ignores instance create calls without component options', async () => {
    const instance: Record<string, unknown> = {
      create: (type: string) => ({ type }),
      options: { clientKey: 'test_ONE' },
    };
    installAdyenCheckoutFactory(async () => instance);
    await callAdyenCheckout({});
    const before = getCapture();

    (instance['create'] as (type: string) => unknown)('card');

    expect(getCapture()).toBe(before);
  });
});
