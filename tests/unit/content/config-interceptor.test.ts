import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const CONFIG_KEY = '__adyenWebInspectorCapturedConfig';
const INSTALLED_KEY = `${CONFIG_KEY}__installed`;

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
  // @ts-expect-error - testing environment cleanup
  globalThis.fetch = undefined;
  // @ts-expect-error - testing environment cleanup
  globalThis.XMLHttpRequest = undefined;
}

async function loadInterceptor(): Promise<void> {
  vi.resetModules();
  globalThis.fetch = vi.fn().mockResolvedValue({} as Response);

  // Create a proper XHR mock
  const openMock = vi.fn();
  // @ts-expect-error - mock XHR
  globalThis.XMLHttpRequest = function (): void {};
  globalThis.XMLHttpRequest.prototype.open = openMock;

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

  describe('Network interception', () => {
    it('captures environment from fetch URL (live)', async () => {
      await globalThis.fetch(
        'https://checkoutshopper-live.adyen.com/checkoutshopper/v1/sdk-identity'
      );
      const config = getCapturedConfig();
      expect(config?.['environment']).toBe('live');
    });

    it('captures environment from fetch URL (test)', async () => {
      await globalThis.fetch(
        'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sdk-identity'
      );
      const config = getCapturedConfig();
      expect(config?.['environment']).toBe('test');
    });

    it('captures clientKey from fetch query parameters', async () => {
      await globalThis.fetch(
        'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sdk-identity?clientKey=test_NET123'
      );
      const config = getCapturedConfig();
      expect(config?.['clientKey']).toBe('test_NET123');
    });

    it('captures from XMLHttpRequest.open', () => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        'GET',
        'https://checkoutshopper-live.adyen.com/checkoutshopper/v1/sdk-identity?clientKey=live_XHR456'
      );
      const config = getCapturedConfig();
      expect(config?.['environment']).toBe('live');
      expect(config?.['clientKey']).toBe('live_XHR456');
    });
  });

  describe('JSON.parse interception', () => {
    it('captures config from a large bootstrap object', () => {
      const raw = JSON.stringify({
        clientKey: 'test_JSON789',
        environment: 'test',
        locale: 'en-GB',
      });
      JSON.parse(raw);
      const config = getCapturedConfig();
      expect(config?.['clientKey']).toBe('test_JSON789');
      expect(config?.['environment']).toBe('test');
      expect(config?.['locale']).toBe('en-GB');
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
