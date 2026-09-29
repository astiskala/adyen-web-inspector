import { describe, expect, it } from 'vitest';
import {
  applyCapturedOptions,
  CALLBACK_SOURCE_LIMIT,
  mergeCheckoutConfigs,
  readCheckoutOptions,
} from '../../../src/shared/checkout-config-schema';

function submitHandler(_data: unknown): void {
  // intentionally empty — only the function source text matters
}

function beforeSubmitHandler(data: unknown): unknown {
  return data;
}

const longOnSubmitHandler = Object.assign((): void => {}, {
  toString: (): string => 'x'.repeat(CALLBACK_SOURCE_LIMIT * 2),
});

describe('readCheckoutOptions', () => {
  it('returns null for values that are not options objects', () => {
    expect(readCheckoutOptions(null, 'checkout')).toBeNull();
    expect(readCheckoutOptions('options', 'checkout')).toBeNull();
    expect(readCheckoutOptions({}, 'checkout')).toEqual({});
  });

  it('copies string options and ignores non-string values', () => {
    expect(
      readCheckoutOptions(
        { clientKey: 'test_KEY123', environment: 'test', locale: 'en-US', countryCode: 'NL' },
        'checkout'
      )
    ).toEqual({
      clientKey: 'test_KEY123',
      environment: 'test',
      locale: 'en-US',
      countryCode: 'NL',
    });
    expect(readCheckoutOptions({ clientKey: 123, environment: null }, 'checkout')).toEqual({});
  });

  it('records risk and analytics settings only when enabled is explicit', () => {
    expect(readCheckoutOptions({ risk: { enabled: false } }, 'checkout')).toEqual({
      riskEnabled: false,
    });
    expect(readCheckoutOptions({ analytics: { enabled: true } }, 'checkout')).toEqual({
      analyticsEnabled: true,
    });
    expect(readCheckoutOptions({ risk: {}, analytics: {} }, 'checkout')).toEqual({});
    expect(readCheckoutOptions({ risk: null, analytics: null }, 'checkout')).toEqual({});
  });

  it('reads the legacy riskEnabled option', () => {
    expect(readCheckoutOptions({ riskEnabled: false }, 'checkout')).toEqual({ riskEnabled: false });
    expect(readCheckoutOptions({ riskEnabled: (): void => {} }, 'checkout')).toEqual({
      riskEnabled: true,
    });
    expect(
      readCheckoutOptions({ risk: { enabled: true }, riskEnabled: false }, 'checkout')
    ).toEqual({ riskEnabled: true });
  });

  it('flags session and installment objects by presence', () => {
    expect(
      readCheckoutOptions({ session: { id: 's1' }, installmentOptions: {} }, 'checkout')
    ).toEqual({ hasSession: true, installmentOptions: true });
    expect(readCheckoutOptions({ session: 'id', installmentOptions: null }, 'checkout')).toEqual(
      {}
    );
  });

  it('copies boolean options only when they are booleans', () => {
    expect(
      readCheckoutOptions(
        { redirectFromTopWhenInIframe: true, setStatusAutomatically: 'yes' },
        'checkout'
      )
    ).toEqual({ redirectFromTopWhenInIframe: true });
  });

  it('records callback placement and callback source', () => {
    const config = readCheckoutOptions(
      {
        onSubmit: submitHandler,
        beforeSubmit: beforeSubmitHandler,
        onPaymentCompleted: (): void => {},
        onValid: true,
        onError: false,
      },
      'component'
    );

    expect(config).toMatchObject({
      onSubmit: 'component',
      beforeSubmit: 'component',
      onPaymentCompleted: 'component',
      onValid: 'component',
    });
    expect(config?.onError).toBeUndefined();
    expect(config?.onSubmitSource).toContain('submitHandler');
    expect(config?.beforeSubmitSource).toContain('return data');
  });

  it('truncates callback source to the shared limit', () => {
    const config = readCheckoutOptions({ onSubmit: longOnSubmitHandler }, 'checkout');
    expect(config?.onSubmitSource).toHaveLength(CALLBACK_SOURCE_LIMIT);
  });

  it.each([
    { risk: {}, analytics: {} },
    { risk: null },
    { risk: { enabled: false }, analytics: { enabled: false }, session: { id: 's1' } },
  ])('maps %j identically for checkout and component placements', (options) => {
    const checkout = readCheckoutOptions(options, 'checkout');
    const component = readCheckoutOptions(options, 'component');
    expect(component).toEqual(checkout);
  });
});

describe('mergeCheckoutConfigs', () => {
  it('keeps earlier values and fills gaps from later configs', () => {
    expect(
      mergeCheckoutConfigs([
        { clientKey: 'base_KEY', environment: 'test' },
        { clientKey: 'extra_KEY', locale: 'en-US' },
        { locale: 'nl-NL', countryCode: 'NL' },
      ])
    ).toEqual({ clientKey: 'base_KEY', environment: 'test', locale: 'en-US', countryCode: 'NL' });
  });

  it('returns null when there is nothing to merge', () => {
    expect(mergeCheckoutConfigs([])).toBeNull();
  });
});

describe('applyCapturedOptions', () => {
  it('lets newer captures win except for callbacks already on AdyenCheckout', () => {
    const current = { clientKey: 'test_OLD', onSubmit: 'checkout', onError: 'component' } as const;

    expect(
      applyCapturedOptions(current, {
        clientKey: 'test_NEW',
        onSubmit: 'component',
        onError: 'component',
        onPaymentCompleted: 'component',
      })
    ).toEqual({
      clientKey: 'test_NEW',
      onSubmit: 'checkout',
      onError: 'component',
      onPaymentCompleted: 'component',
    });
    expect(applyCapturedOptions(null, { locale: 'en-US' })).toEqual({ locale: 'en-US' });
  });
});

function hiddenSourceHandler(_data: unknown): void {
  // intentionally empty — its source is hidden below
}

function hideSource(): never {
  throw new Error('source hidden');
}

describe('readCheckoutOptions callback source', () => {
  it('registers a callback whose source cannot be read, without its source', () => {
    Object.defineProperty(hiddenSourceHandler, 'toString', { value: hideSource });

    const config = readCheckoutOptions({ onSubmit: hiddenSourceHandler }, 'checkout');

    expect(config).toMatchObject({ onSubmit: 'checkout' });
    expect(config).not.toHaveProperty('onSubmitSource');
  });
});
