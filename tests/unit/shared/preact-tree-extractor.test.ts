import { describe, it, expect } from 'vitest';
import { findCoreOptions } from '../../../src/shared/preact-tree-extractor';

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
