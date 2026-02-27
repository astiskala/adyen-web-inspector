import { describe, expect, it } from 'vitest';
import { parseCsp, cspIncludesDomain } from '../../../src/shared/csp-utils';

interface ParseDirectivesCase {
  readonly name: string;
  readonly header: string;
  readonly expectedDirectives: Record<string, string[]>;
}

interface DomainMatchCase {
  readonly name: string;
  readonly header: string;
  readonly directive: string;
  readonly domain: string;
  readonly expected: boolean;
}

const PARSE_DIRECTIVES_CASES: readonly ParseDirectivesCase[] = [
  {
    name: 'parses a single directive with values',
    header: "default-src 'self'",
    expectedDirectives: { 'default-src': ["'self'"] },
  },
  {
    name: 'parses multiple directives separated by semicolons',
    header: "default-src 'none'; script-src https://example.com",
    expectedDirectives: {
      'default-src': ["'none'"],
      'script-src': ['https://example.com'],
    },
  },
  {
    name: 'handles trailing semicolons',
    header: "default-src 'self';",
    expectedDirectives: { 'default-src': ["'self'"] },
  },
  {
    name: 'handles empty parts between semicolons',
    header: "default-src 'self';; script-src https://cdn.example.com",
    expectedDirectives: {
      'default-src': ["'self'"],
      'script-src': ['https://cdn.example.com'],
    },
  },
  {
    name: 'parses a directive with no values',
    header: 'upgrade-insecure-requests',
    expectedDirectives: { 'upgrade-insecure-requests': [] },
  },
  {
    name: 'lowercases directive names',
    header: "Script-Src 'self'",
    expectedDirectives: { 'script-src': ["'self'"] },
  },
  {
    name: 'returns empty directives for an empty string',
    header: '',
    expectedDirectives: {},
  },
  {
    name: 'returns empty directives for whitespace-only input',
    header: '   ',
    expectedDirectives: {},
  },
  {
    name: 'handles extra whitespace between tokens',
    header: 'script-src   https://a.com    https://b.com',
    expectedDirectives: {
      'script-src': ['https://a.com', 'https://b.com'],
    },
  },
  {
    name: 'handles whitespace around semicolons',
    header: "  default-src 'self'  ;  script-src https://cdn.com  ",
    expectedDirectives: {
      'default-src': ["'self'"],
      'script-src': ['https://cdn.com'],
    },
  },
  {
    name: 'parses a directive with multiple values',
    header: "script-src 'self' https://a.com https://b.com 'unsafe-inline'",
    expectedDirectives: {
      'script-src': ["'self'", 'https://a.com', 'https://b.com', "'unsafe-inline'"],
    },
  },
];

const DOMAIN_MATCH_CASES: readonly DomainMatchCase[] = [
  {
    name: 'matches an exact domain in the directive',
    header: 'script-src checkoutshopper-live.adyen.com',
    directive: 'script-src',
    domain: 'checkoutshopper-live.adyen.com',
    expected: true,
  },
  {
    name: 'matches a subdomain against a parent domain',
    header: 'script-src foo.checkoutshopper-live.adyen.com',
    directive: 'script-src',
    domain: 'adyen.com',
    expected: true,
  },
  {
    name: 'matches a wildcard subdomain entry',
    header: 'script-src *.adyen.com',
    directive: 'script-src',
    domain: 'adyen.com',
    expected: true,
  },
  {
    name: 'matches a domain specified with a scheme',
    header: 'script-src https://checkoutshopper-live.adyen.com',
    directive: 'script-src',
    domain: 'checkoutshopper-live.adyen.com',
    expected: true,
  },
  {
    name: 'matches a domain specified with a port',
    header: 'script-src example.com:443',
    directive: 'script-src',
    domain: 'example.com',
    expected: true,
  },
  {
    name: 'matches a domain specified with a path',
    header: 'script-src example.com/path/to/resource',
    directive: 'script-src',
    domain: 'example.com',
    expected: true,
  },
  {
    name: 'matches a domain with scheme, port, and path combined',
    header: 'script-src https://example.com:8443/scripts',
    directive: 'script-src',
    domain: 'example.com',
    expected: true,
  },
  {
    name: 'ignores CSP keyword self',
    header: "script-src 'self' 'unsafe-inline'",
    directive: 'script-src',
    domain: 'self',
    expected: false,
  },
  {
    name: 'ignores CSP keyword unsafe-inline',
    header: "script-src 'self' 'unsafe-inline'",
    directive: 'script-src',
    domain: 'unsafe-inline',
    expected: false,
  },
  {
    name: 'ignores scheme-only value https:',
    header: 'script-src https: data:',
    directive: 'script-src',
    domain: 'https',
    expected: false,
  },
  {
    name: 'ignores scheme-only value data:',
    header: 'script-src https: data:',
    directive: 'script-src',
    domain: 'data',
    expected: false,
  },
  {
    name: 'ignores wildcard star value',
    header: 'script-src *',
    directive: 'script-src',
    domain: '*',
    expected: false,
  },
  {
    name: 'returns false when the directive is not present',
    header: "default-src 'self'",
    directive: 'script-src',
    domain: 'example.com',
    expected: false,
  },
  {
    name: 'returns false when directive has no values',
    header: 'upgrade-insecure-requests',
    directive: 'upgrade-insecure-requests',
    domain: 'example.com',
    expected: false,
  },
  {
    name: 'normalizes domains with wildcard prefix',
    header: 'script-src adyen.com',
    directive: 'script-src',
    domain: '*.adyen.com',
    expected: true,
  },
  {
    name: 'normalizes domains with leading dot',
    header: 'script-src adyen.com',
    directive: 'script-src',
    domain: '.adyen.com',
    expected: true,
  },
  {
    name: 'performs case-insensitive matching',
    header: 'script-src ADYEN.COM',
    directive: 'script-src',
    domain: 'Adyen.Com',
    expected: true,
  },
  {
    name: 'does not match partial domain names',
    header: 'script-src notadyen.com',
    directive: 'script-src',
    domain: 'adyen.com',
    expected: false,
  },
  {
    name: 'returns false when no values match',
    header: "script-src 'self' https://other.com",
    directive: 'script-src',
    domain: 'adyen.com',
    expected: false,
  },
  {
    name: 'matches among multiple values in a directive',
    header: "script-src 'self' https://cdn.example.com https://adyen.com",
    directive: 'script-src',
    domain: 'adyen.com',
    expected: true,
  },
  {
    name: 'handles an empty CSP',
    header: '',
    directive: 'script-src',
    domain: 'example.com',
    expected: false,
  },
];

describe('parseCsp', () => {
  for (const testCase of PARSE_DIRECTIVES_CASES) {
    it(testCase.name, () => {
      const result = parseCsp(testCase.header);
      expect(result.directives).toEqual(testCase.expectedDirectives);
    });
  }

  it('preserves the raw header string', () => {
    const header = "default-src 'none'; script-src https://example.com";
    const result = parseCsp(header);
    expect(result.raw).toBe(header);
  });

  it('preserves raw string for empty input', () => {
    const result = parseCsp('');
    expect(result.raw).toBe('');
  });
});

describe('cspIncludesDomain', () => {
  for (const testCase of DOMAIN_MATCH_CASES) {
    it(testCase.name, () => {
      const csp = parseCsp(testCase.header);
      expect(cspIncludesDomain(csp, testCase.directive, testCase.domain)).toBe(testCase.expected);
    });
  }
});
