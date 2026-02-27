import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const CONFIG_KEY = '__adyenWebInspectorCapturedConfig';
const INSTALLED_KEY = CONFIG_KEY + '__installed';

type CapturedConfig = Record<string, unknown>;
type CheckoutFactory = (config: unknown) => Promise<unknown>;

function getCapturedConfig(): CapturedConfig | undefined {
  return (globalThis as unknown as Record<string, unknown>)[CONFIG_KEY] as
    | CapturedConfig
    | undefined;
}

function resetGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  Reflect.deleteProperty(g, CONFIG_KEY);
  Reflect.deleteProperty(g, INSTALLED_KEY);
  Reflect.deleteProperty(g, 'AdyenCheckout');
  Reflect.deleteProperty(g, 'AdyenWeb');
}

async function loadInterceptor(): Promise<void> {
  vi.resetModules();
  await import('../../../src/content/config-interceptor.js');
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

  describe('factory promise resolution hook', () => {
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
      expect(config).toBeDefined();
      expect(config?.['clientKey']).toBe('test_PROMISE123');
      expect(config?.['environment']).toBe('test');
      expect(config?.['locale']).toBe('en-US');
      expect(config?.['countryCode']).toBe('NL');
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

    it('does not capture non-Adyen promise resolutions', async () => {
      await Promise.resolve({ foo: 'bar' }).then((v) => v);
      await Promise.resolve(42).then((v) => v);
      await Promise.resolve('hello').then((v) => v);
      await Promise.resolve(null).then((v) => v);
      expect(getCapturedConfig()).toBeUndefined();
    });

    it('captures config from v6.31+ ESM instances (no create, has modules)', async () => {
      const fakeCheckout = {
        modules: {},
        paymentMethodsResponse: {},
        loadingContext: 'https://checkoutshopper-test.adyen.com/',
        options: {
          clientKey: 'test_ESM631',
          environment: 'test',
          countryCode: 'SG',
          onPaymentCompleted: (): void => {},
          onError: (): void => {},
        },
      };

      installAdyenCheckoutFactory(async () => fakeCheckout);
      await callAdyenCheckout({});

      const config = getCapturedConfig();
      expect(config).toBeDefined();
      expect(config?.['clientKey']).toBe('test_ESM631');
      expect(config?.['environment']).toBe('test');
      expect(config?.['countryCode']).toBe('SG');
      expect(config?.['onPaymentCompleted']).toBe('checkout');
    });

    it('does not capture plain config objects without instance markers', async () => {
      installAdyenCheckoutFactory(async () => ({ options: { clientKey: 'test_NO' } }));
      await callAdyenCheckout({});
      expect(getCapturedConfig()).toBeUndefined();
    });

    it('does not capture objects without clientKey', async () => {
      installAdyenCheckoutFactory(async () => ({
        create: (): void => {},
        options: { environment: 'test' },
      }));
      await callAdyenCheckout({});
      expect(getCapturedConfig()).toBeUndefined();
    });

    it('preserves original then return values', async () => {
      installAdyenCheckoutFactory(async () => 42);
      const result = await callAdyenCheckout({}).then((v) => (v as number) * 2);
      expect(result).toBe(84);
    });

    it('preserves chained promise behaviour', async () => {
      installAdyenCheckoutFactory(async () => 1);
      const result = await callAdyenCheckout({})
        .then((v) => (v as number) + 1)
        .then((v) => v * 3);
      expect(result).toBe(6);
    });

    it('preserves rejection handling', async () => {
      installAdyenCheckoutFactory(async () => {
        throw new Error('test');
      });
      let caught = false;
      await callAdyenCheckout({}).then(
        () => {},
        () => {
          caught = true;
        }
      );
      expect(caught).toBe(true);
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

    it('passes through when onFulfilled is null', async () => {
      installAdyenCheckoutFactory(async () => 42);
      const result = await callAdyenCheckout({}).then(null, null);
      expect(result).toBe(42);
    });
  });

  describe('fallback prototype interception', () => {
    it('captures config from a private factory resolution via Promise.prototype.then', async () => {
      const fakeCheckout = {
        create: (): void => {},
        options: {
          clientKey: 'test_BUNDLED',
          environment: 'test',
        },
      };

      // Simulate a private factory that is NOT exposed on window
      const privateFactory = async (): Promise<unknown> => fakeCheckout;

      // Call it — the interceptor's Promise.prototype.then hook should catch the result
      await privateFactory().then((v) => v);

      const config = getCapturedConfig();
      expect(config).toBeDefined();
      expect(config?.['clientKey']).toBe('test_BUNDLED');
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
