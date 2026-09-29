import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { PAGE_GLOBALS } from '../../../src/shared/constants';
import type { CheckoutCapture, InferenceSignal } from '../../../src/shared/types';

const CAPTURE_KEY = PAGE_GLOBALS.checkoutCapture;
const INSTALLED_KEY = PAGE_GLOBALS.interceptorInstalled;

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

function resetGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  Reflect.deleteProperty(g, CAPTURE_KEY);
  Reflect.deleteProperty(g, INSTALLED_KEY);
  Reflect.deleteProperty(g, 'AdyenCheckout');
  Reflect.deleteProperty(g, 'AdyenWeb');
  // @ts-expect-error - testing environment cleanup
  globalThis.fetch = undefined;
  // @ts-expect-error - testing environment cleanup
  globalThis.XMLHttpRequest = undefined;
}

async function loadInterceptor(): Promise<void> {
  vi.resetModules();
  globalThis.fetch = vi.fn().mockResolvedValue({});

  // Create a proper XHR mock
  const openMock = vi.fn();
  globalThis.XMLHttpRequest = vi.fn() as unknown as typeof XMLHttpRequest;
  globalThis.XMLHttpRequest.prototype.open = openMock;

  await import('../../../src/content/config-interceptor.js');
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
  (globalThis as unknown as Record<string, unknown>)['AdyenCheckout'] = factory;
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

  describe('Global property traps', () => {
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
        create: (_type: unknown, _cfg?: unknown) => ({}),
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
      g['AdyenWeb'] = {
        AdyenCheckout: async (): Promise<unknown> => ({
          create: (): void => {},
          options: { clientKey: 'test_NS' },
        }),
        Card,
        Dropin,
        version: '6.31.0',
      };
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

  describe('checkout factory edge cases', () => {
    it('stores non-function AdyenCheckout values and does not wrap a factory twice', async () => {
      const g = globalThis as unknown as Record<string, unknown>;
      g['AdyenCheckout'] = { notAFactory: true };
      expect(g['AdyenCheckout']).toEqual({ notAFactory: true });

      installAdyenCheckoutFactory(async () => null);
      const wrapped = g['AdyenCheckout'];
      g['AdyenCheckout'] = wrapped;
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

describe('config-interceptor installation and edge cases', () => {
  const g = globalThis as unknown as Record<string, unknown>;

  beforeEach(async () => {
    resetGlobals();
    await loadInterceptor();
  });

  afterAll(() => {
    resetGlobals();
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

    expect(getCapture()).toBeUndefined();
  });

  it('keeps component statics and ignores constructors called without options', () => {
    class StaticCard {
      static readonly type = 'card';
      readonly checkout: unknown;
      constructor(checkout: unknown) {
        this.checkout = checkout;
      }
    }
    g['AdyenWeb'] = { Card: StaticCard };
    const namespace = g['AdyenWeb'] as { Card: typeof StaticCard };

    const card = new namespace.Card({});

    expect(namespace.Card.type).toBe('card');
    expect(card).toBeInstanceOf(StaticCard);
    expect(getCapture()).toBeUndefined();
  });

  it('stores AdyenWeb values that are not namespaces', () => {
    g['AdyenWeb'] = undefined;

    expect(g['AdyenWeb']).toBeUndefined();
  });

  it('captures options passed to a synchronous factory without inspecting its result', () => {
    const instance = { create: (): void => {}, options: { clientKey: 'test_SYNC' } };
    g['AdyenCheckout'] = (): unknown => instance;

    (g['AdyenCheckout'] as (config: unknown) => unknown)({ countryCode: 'NL' });

    expect(getCapturedConfig()).toEqual({ countryCode: 'NL' });
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
