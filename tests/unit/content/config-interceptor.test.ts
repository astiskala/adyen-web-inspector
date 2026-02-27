import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const CONFIG_KEY = '__adyenWebInspectorCapturedConfig';
const INSTALLED_KEY = CONFIG_KEY + '__installed';

type CapturedConfig = Record<string, unknown>;

// Save pristine prototype before any interceptor loads.
const pristineThen = Promise.prototype.then;

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

function restorePrototypes(): void {
  (Promise.prototype as unknown as Record<string, unknown>)['then'] = pristineThen;
}

async function loadInterceptor(): Promise<void> {
  vi.resetModules();
  await import('../../../src/content/config-interceptor.js');
}

describe('config-interceptor', () => {
  beforeEach(async () => {
    restorePrototypes();
    resetGlobals();
    await loadInterceptor();
  });

  afterAll(() => {
    restorePrototypes();
    resetGlobals();
  });

  // -------------------------------------------------------------------------
  // Promise.prototype.then interception
  // -------------------------------------------------------------------------

  describe('Promise.prototype.then interception', () => {
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

      await Promise.resolve(fakeCheckout).then((v) => v);

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

      await Promise.resolve(fakeCheckout).then((v) => v);

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

      await Promise.resolve(fakeCheckout).then((v) => v);

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

      await Promise.resolve(fakeCheckout).then((v) => v);

      const config = getCapturedConfig();
      expect(config).toBeDefined();
      expect(config?.['clientKey']).toBe('test_ESM631');
      expect(config?.['environment']).toBe('test');
      expect(config?.['countryCode']).toBe('SG');
      expect(config?.['onPaymentCompleted']).toBe('checkout');
    });

    it('does not capture plain config objects without instance markers', async () => {
      await Promise.resolve({ options: { clientKey: 'test_NO' } }).then((v) => v);
      expect(getCapturedConfig()).toBeUndefined();
    });

    it('does not capture objects without clientKey', async () => {
      await Promise.resolve({
        create: (): void => {},
        options: { environment: 'test' },
      }).then((v) => v);
      expect(getCapturedConfig()).toBeUndefined();
    });

    it('preserves original then return values', async () => {
      const result = await Promise.resolve(42).then((v) => v * 2);
      expect(result).toBe(84);
    });

    it('preserves chained promise behaviour', async () => {
      const result = await Promise.resolve(1)
        .then((v) => v + 1)
        .then((v) => v * 3);
      expect(result).toBe(6);
    });

    it('preserves rejection handling', async () => {
      let caught = false;
      await Promise.reject(new Error('test')).then(
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

      await Promise.resolve(fakeCheckout).then((v) => v);

      // The interceptor should have wrapped .create() on the instance.
      // Call it with component-level config.
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
      const result = await Promise.resolve(42).then(null, null);
      expect(result).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // Re-injection guard
  // -------------------------------------------------------------------------

  describe('idempotency', () => {
    it('does not break when the interceptor is loaded twice', async () => {
      // First load already happened in beforeEach. Load again without clearing the guard.
      await import('../../../src/content/config-interceptor.js');

      const fakeCheckout = {
        create: (): void => {},
        options: { clientKey: 'test_IDEM', environment: 'test' },
      };

      await Promise.resolve(fakeCheckout).then((v) => v);

      const config = getCapturedConfig();
      expect(config).toBeDefined();
      expect(config?.['clientKey']).toBe('test_IDEM');
    });
  });
});
