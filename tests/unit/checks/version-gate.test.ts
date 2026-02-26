import { describe, it, expect } from 'vitest';
import { parseVersion } from '../../../src/shared/utils';
import { MIN_SUPPORTED_MAJOR_VERSION } from '../../../src/shared/constants';

function requireParsedVersion(version: string): NonNullable<ReturnType<typeof parseVersion>> {
  const parsed = parseVersion(version);
  expect(parsed).not.toBeNull();
  if (parsed === null) {
    throw new Error(`Expected parseVersion("${version}") to return a value.`);
  }
  return parsed;
}

describe('version gate — pre-v6 detection', () => {
  it('blocks v5 versions', () => {
    const parsed = requireParsedVersion('5.1.0');
    expect(parsed.major).toBeLessThan(MIN_SUPPORTED_MAJOR_VERSION);
  });

  it('blocks v4 versions', () => {
    const parsed = requireParsedVersion('4.7.3');
    expect(parsed.major).toBeLessThan(MIN_SUPPORTED_MAJOR_VERSION);
  });

  it('blocks v3 versions', () => {
    const parsed = requireParsedVersion('3.0.0');
    expect(parsed.major).toBeLessThan(MIN_SUPPORTED_MAJOR_VERSION);
  });

  it('allows v6 versions', () => {
    const parsed = requireParsedVersion('6.0.0');
    expect(parsed.major).toBeGreaterThanOrEqual(MIN_SUPPORTED_MAJOR_VERSION);
  });

  it('allows v6 latest', () => {
    const parsed = requireParsedVersion('6.31.1');
    expect(parsed.major).toBeGreaterThanOrEqual(MIN_SUPPORTED_MAJOR_VERSION);
  });

  it('allows future v7 versions', () => {
    const parsed = requireParsedVersion('7.0.0');
    expect(parsed.major).toBeGreaterThanOrEqual(MIN_SUPPORTED_MAJOR_VERSION);
  });

  it('returns null for invalid version strings', () => {
    expect(parseVersion('invalid')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('MIN_SUPPORTED_MAJOR_VERSION is 6', () => {
    expect(MIN_SUPPORTED_MAJOR_VERSION).toBe(6);
  });
});
