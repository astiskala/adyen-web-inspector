import { describe, expect, it } from 'vitest';
import { parseCsp, cspIncludesDomain } from '../../../src/shared/csp-utils';

describe('parseCsp', () => {
  it('parses a single directive with values', () => {
    const result = parseCsp("default-src 'self'");

    expect(result.directives).toEqual({ 'default-src': ["'self'"] });
  });

  it('parses multiple directives separated by semicolons', () => {
    const result = parseCsp("default-src 'none'; script-src https://example.com");

    expect(result.directives).toEqual({
      'default-src': ["'none'"],
      'script-src': ['https://example.com'],
    });
  });

  it('handles trailing semicolons', () => {
    const result = parseCsp("default-src 'self';");

    expect(result.directives).toEqual({ 'default-src': ["'self'"] });
  });

  it('handles empty parts between semicolons', () => {
    const result = parseCsp("default-src 'self';; script-src https://cdn.example.com");

    expect(result.directives).toEqual({
      'default-src': ["'self'"],
      'script-src': ['https://cdn.example.com'],
    });
  });

  it('parses a directive with no values', () => {
    const result = parseCsp('upgrade-insecure-requests');

    expect(result.directives).toEqual({ 'upgrade-insecure-requests': [] });
  });

  it('lowercases directive names', () => {
    const result = parseCsp("Script-Src 'self'");

    expect(result.directives).toEqual({ 'script-src': ["'self'"] });
  });

  it('returns empty directives for an empty string', () => {
    const result = parseCsp('');

    expect(result.directives).toEqual({});
  });

  it('returns empty directives for whitespace-only input', () => {
    const result = parseCsp('   ');

    expect(result.directives).toEqual({});
  });

  it('preserves the raw header string', () => {
    const header = "default-src 'none'; script-src https://example.com";
    const result = parseCsp(header);

    expect(result.raw).toBe(header);
  });

  it('preserves raw string even for empty input', () => {
    const result = parseCsp('');

    expect(result.raw).toBe('');
  });

  it('handles extra whitespace between tokens', () => {
    const result = parseCsp('script-src   https://a.com    https://b.com');

    expect(result.directives).toEqual({
      'script-src': ['https://a.com', 'https://b.com'],
    });
  });

  it('handles whitespace around semicolons', () => {
    const result = parseCsp("  default-src 'self'  ;  script-src https://cdn.com  ");

    expect(result.directives).toEqual({
      'default-src': ["'self'"],
      'script-src': ['https://cdn.com'],
    });
  });

  it('parses a directive with multiple values', () => {
    const result = parseCsp("script-src 'self' https://a.com https://b.com 'unsafe-inline'");

    expect(result.directives['script-src']).toEqual([
      "'self'",
      'https://a.com',
      'https://b.com',
      "'unsafe-inline'",
    ]);
  });
});

describe('cspIncludesDomain', () => {
  it('matches an exact domain in the directive', () => {
    const csp = parseCsp('script-src checkoutshopper-live.adyen.com');

    expect(cspIncludesDomain(csp, 'script-src', 'checkoutshopper-live.adyen.com')).toBe(true);
  });

  it('matches a subdomain against a parent domain', () => {
    const csp = parseCsp('script-src foo.checkoutshopper-live.adyen.com');

    expect(cspIncludesDomain(csp, 'script-src', 'adyen.com')).toBe(true);
  });

  it('matches a wildcard subdomain entry', () => {
    const csp = parseCsp('script-src *.adyen.com');

    expect(cspIncludesDomain(csp, 'script-src', 'adyen.com')).toBe(true);
  });

  it('matches a domain specified with a scheme', () => {
    const csp = parseCsp('script-src https://checkoutshopper-live.adyen.com');

    expect(cspIncludesDomain(csp, 'script-src', 'checkoutshopper-live.adyen.com')).toBe(true);
  });

  it('matches a domain specified with a port', () => {
    const csp = parseCsp('script-src example.com:443');

    expect(cspIncludesDomain(csp, 'script-src', 'example.com')).toBe(true);
  });

  it('matches a domain specified with a path', () => {
    const csp = parseCsp('script-src example.com/path/to/resource');

    expect(cspIncludesDomain(csp, 'script-src', 'example.com')).toBe(true);
  });

  it('matches a domain with scheme, port, and path combined', () => {
    const csp = parseCsp('script-src https://example.com:8443/scripts');

    expect(cspIncludesDomain(csp, 'script-src', 'example.com')).toBe(true);
  });

  it('ignores CSP keywords (single-quoted values)', () => {
    const csp = parseCsp("script-src 'self' 'unsafe-inline'");

    expect(cspIncludesDomain(csp, 'script-src', 'self')).toBe(false);
    expect(cspIncludesDomain(csp, 'script-src', 'unsafe-inline')).toBe(false);
  });

  it('ignores scheme-only values like https: and data:', () => {
    const csp = parseCsp('script-src https: data:');

    expect(cspIncludesDomain(csp, 'script-src', 'https')).toBe(false);
    expect(cspIncludesDomain(csp, 'script-src', 'data')).toBe(false);
  });

  it('ignores the wildcard * value', () => {
    const csp = parseCsp('script-src *');

    expect(cspIncludesDomain(csp, 'script-src', '*')).toBe(false);
  });

  it('returns false when the directive is not present', () => {
    const csp = parseCsp("default-src 'self'");

    expect(cspIncludesDomain(csp, 'script-src', 'example.com')).toBe(false);
  });

  it('returns false when the directive has no values', () => {
    const csp = parseCsp('upgrade-insecure-requests');

    expect(cspIncludesDomain(csp, 'upgrade-insecure-requests', 'example.com')).toBe(false);
  });

  it('normalizes a domain with a leading wildcard prefix', () => {
    const csp = parseCsp('script-src adyen.com');

    expect(cspIncludesDomain(csp, 'script-src', '*.adyen.com')).toBe(true);
  });

  it('normalizes a domain with a leading dot', () => {
    const csp = parseCsp('script-src adyen.com');

    expect(cspIncludesDomain(csp, 'script-src', '.adyen.com')).toBe(true);
  });

  it('performs case-insensitive domain matching', () => {
    const csp = parseCsp('script-src ADYEN.COM');

    expect(cspIncludesDomain(csp, 'script-src', 'Adyen.Com')).toBe(true);
  });

  it('does not match a partial domain name', () => {
    const csp = parseCsp('script-src notadyen.com');

    expect(cspIncludesDomain(csp, 'script-src', 'adyen.com')).toBe(false);
  });

  it('returns false when no values in the directive match', () => {
    const csp = parseCsp("script-src 'self' https://other.com");

    expect(cspIncludesDomain(csp, 'script-src', 'adyen.com')).toBe(false);
  });

  it('matches among multiple values in a directive', () => {
    const csp = parseCsp("script-src 'self' https://cdn.example.com https://adyen.com");

    expect(cspIncludesDomain(csp, 'script-src', 'adyen.com')).toBe(true);
  });

  it('handles an empty CSP', () => {
    const csp = parseCsp('');

    expect(cspIncludesDomain(csp, 'script-src', 'example.com')).toBe(false);
  });
});
