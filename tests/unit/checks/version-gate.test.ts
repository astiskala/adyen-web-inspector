import { describe, it, expect } from 'vitest';
import { meetsMinimumVersion } from '../../../src/shared/utilities';
import { MIN_SUPPORTED_VERSION } from '../../../src/shared/constants';

describe('version gate — minimum supported version', () => {
  it.each(['5.1.0', '5.99.99', '3.0.0'])('blocks v%s', (version) => {
    expect(meetsMinimumVersion(version, MIN_SUPPORTED_VERSION)).toBe('unmet');
  });

  it.each(['6.0.0', '6.31.1', '7.0.0', '6.0.0-beta.1'])('allows v%s', (version) => {
    expect(meetsMinimumVersion(version, MIN_SUPPORTED_VERSION)).toBe('met');
  });

  it.each([null, undefined, '', 'invalid', '6.0'])('cannot tell for %s', (version) => {
    expect(meetsMinimumVersion(version, MIN_SUPPORTED_VERSION)).toBe('unknown');
  });

  it('cannot tell against an unreadable minimum', () => {
    expect(meetsMinimumVersion('6.0.0', 'latest')).toBe('unknown');
  });

  it('compares minor and patch versions within a major', () => {
    expect(meetsMinimumVersion('6.29.9', '6.30.0')).toBe('unmet');
    expect(meetsMinimumVersion('6.30.0', '6.30.0')).toBe('met');
    expect(meetsMinimumVersion('6.30.1', '6.30.0')).toBe('met');
  });
});
