import { describe, it, expect } from 'vitest';
import {
  findCoreOptions,
  extractFieldsFromOptions,
  mergeConfigs,
} from '../../../src/shared/preact-tree-extractor';

function submitHandler(_data: unknown): void {
  // intentionally empty — only the function source text matters
}

function beforeSubmitHandler(data: unknown): unknown {
  return data;
}

function longOnSubmitHandler(): string {
  const longString = 'a]'.repeat(600);
  return longString;
}

describe('findCoreOptions', () => {
  it('returns null for null/undefined node', () => {
    expect(findCoreOptions(null, 0)).toBeNull();
    expect(findCoreOptions(undefined, 0)).toBeNull();
  });

  it('returns null when depth limit exceeded', () => {
    const node = { __c: { props: { core: { options: { clientKey: 'x' } } } } };
    expect(findCoreOptions(node, 16)).toBeNull();
  });

  it('finds core.options on a direct component node', () => {
    const options = { clientKey: 'test_KEY', environment: 'test' };
    const node = { __c: { props: { core: { options } } } };
    expect(findCoreOptions(node, 0)).toBe(options);
  });

  it('finds core.options nested in children array', () => {
    const options = { clientKey: 'test_KEY' };
    const node = {
      __k: [{ __k: null }, { __k: [{ __c: { props: { core: { options } } }, __k: null }] }],
    };
    expect(findCoreOptions(node, 0)).toBe(options);
  });

  it('finds core.options in single-child (non-array) __k', () => {
    const options = { environment: 'live' };
    const node = {
      __k: { __c: { props: { core: { options } } } },
    };
    expect(findCoreOptions(node, 0)).toBe(options);
  });

  it('skips nodes without __c', () => {
    const options = { clientKey: 'test_ABC' };
    const node = {
      __k: [
        { someOther: true },
        { __c: { props: { notCore: true } }, __k: null },
        { __c: { props: { core: { options } } }, __k: null },
      ],
    };
    expect(findCoreOptions(node, 0)).toBe(options);
  });

  it('returns null when no core.options exists anywhere', () => {
    const node = {
      __k: [{ __c: { props: { something: 'else' } }, __k: null }, { __k: [{ __k: null }] }],
    };
    expect(findCoreOptions(node, 0)).toBeNull();
  });
});

describe('extractFieldsFromOptions', () => {
  it('extracts string fields', () => {
    const result = extractFieldsFromOptions({
      clientKey: 'test_KEY123',
      environment: 'test',
      locale: 'en-US',
      countryCode: 'NL',
    });
    expect(result.clientKey).toBe('test_KEY123');
    expect(result.environment).toBe('test');
    expect(result.locale).toBe('en-US');
    expect(result.countryCode).toBe('NL');
  });

  it('ignores non-string values for string fields', () => {
    const result = extractFieldsFromOptions({
      clientKey: 123,
      environment: null,
    });
    expect(result.clientKey).toBeUndefined();
    expect(result.environment).toBeUndefined();
  });

  it('extracts riskEnabled from risk.enabled', () => {
    expect(extractFieldsFromOptions({ risk: { enabled: false } }).riskEnabled).toBe(false);
    expect(extractFieldsFromOptions({ risk: { enabled: true } }).riskEnabled).toBe(true);
    expect(extractFieldsFromOptions({ risk: {} }).riskEnabled).toBe(true);
  });

  it('does not set riskEnabled when risk is absent', () => {
    expect(extractFieldsFromOptions({}).riskEnabled).toBeUndefined();
  });

  it('extracts analyticsEnabled from analytics.enabled', () => {
    expect(extractFieldsFromOptions({ analytics: { enabled: false } }).analyticsEnabled).toBe(
      false
    );
    expect(extractFieldsFromOptions({ analytics: {} }).analyticsEnabled).toBe(true);
  });

  it('detects session presence', () => {
    expect(extractFieldsFromOptions({ session: { id: 's1' } }).hasSession).toBe(true);
    expect(extractFieldsFromOptions({}).hasSession).toBeUndefined();
  });

  it('detects callbacks and marks them as checkout source', () => {
    const result = extractFieldsFromOptions({
      onSubmit: () => {},
      onPaymentCompleted: () => {},
      onError: () => {},
    });
    expect(result.onSubmit).toBe('checkout');
    expect(result.onPaymentCompleted).toBe('checkout');
    expect(result.onError).toBe('checkout');
    expect(result.onPaymentFailed).toBeUndefined();
  });

  it('captures onSubmitSource from function toString', () => {
    const result = extractFieldsFromOptions({ onSubmit: submitHandler });
    expect(result.onSubmitSource).toContain('submitHandler');
  });

  it('captures beforeSubmitSource from function toString', () => {
    const result = extractFieldsFromOptions({ beforeSubmit: beforeSubmitHandler });
    expect(result.beforeSubmitSource).toContain('return data');
  });

  it('truncates long source to 1200 chars', () => {
    const result = extractFieldsFromOptions({ onSubmit: longOnSubmitHandler });
    expect((result.onSubmitSource ?? '').length).toBeLessThanOrEqual(1200);
  });
});

describe('mergeConfigs', () => {
  it('base values take precedence', () => {
    const result = mergeConfigs(
      { clientKey: 'base_KEY', environment: 'test' },
      { clientKey: 'extra_KEY', locale: 'en-US' }
    );
    expect(result.clientKey).toBe('base_KEY');
    expect(result.environment).toBe('test');
    expect(result.locale).toBe('en-US');
  });

  it('fills gaps from extra', () => {
    const result = mergeConfigs({ clientKey: 'key' }, { locale: 'nl-NL', countryCode: 'NL' });
    expect(result.locale).toBe('nl-NL');
    expect(result.countryCode).toBe('NL');
  });

  it('returns base unchanged when extra is empty', () => {
    const base = { clientKey: 'k', environment: 'live' };
    expect(mergeConfigs(base, {})).toEqual(base);
  });
});
