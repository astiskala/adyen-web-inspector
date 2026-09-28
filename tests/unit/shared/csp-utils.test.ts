import { describe, expect, it } from 'vitest';
import { parseCsp, cspAllowsUrl, getEffectiveCspSources } from '../../../src/shared/csp-utils';

interface ParseDirectivesCase {
  readonly name: string;
  readonly header: string;
  readonly expectedDirectives: Record<string, string[]>;
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

  it('uses the first instance of a repeated directive', () => {
    const result = parseCsp("script-src 'self'; script-src https:");
    expect(result.directives['script-src']).toEqual(["'self'"]);
  });
});

describe('effective CSP sources', () => {
  const pageUrl = 'https://merchant.example/checkout';
  const scriptUrl = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk.js';

  it('uses script-src-elem before script-src, then default-src', () => {
    expect(
      cspAllowsUrl(
        parseCsp("default-src https:; script-src 'self'"),
        'script-src',
        scriptUrl,
        pageUrl
      )
    ).toBe(false);
    expect(
      cspAllowsUrl(
        parseCsp("script-src https:; script-src-elem 'self'"),
        'script-src',
        scriptUrl,
        pageUrl
      )
    ).toBe(false);
    expect(cspAllowsUrl(parseCsp('default-src https:'), 'script-src', scriptUrl, pageUrl)).toBe(
      true
    );
  });

  it('matches exact hosts and wildcard subdomains without matching lookalikes', () => {
    expect(
      cspAllowsUrl(parseCsp('script-src https://*.adyen.com'), 'script-src', scriptUrl, pageUrl)
    ).toBe(true);
    expect(
      cspAllowsUrl(parseCsp('script-src https://adyen.com'), 'script-src', scriptUrl, pageUrl)
    ).toBe(false);
    expect(
      cspAllowsUrl(parseCsp('script-src https://notadyen.com'), 'script-src', scriptUrl, pageUrl)
    ).toBe(false);
  });

  it('honors self, scheme sources and none', () => {
    expect(
      cspAllowsUrl(
        parseCsp("script-src 'self'"),
        'script-src',
        'https://merchant.example/app.js',
        pageUrl
      )
    ).toBe(true);
    expect(cspAllowsUrl(parseCsp('script-src https:'), 'script-src', scriptUrl, pageUrl)).toBe(
      true
    );
    expect(cspAllowsUrl(parseCsp("script-src 'none'"), 'script-src', scriptUrl, pageUrl)).toBe(
      false
    );
  });

  it.each([
    ['frame-src', "default-src 'self'; child-src https:", 'child-src'],
    ['frame-src', "default-src 'self'; frame-src *; child-src 'self'", 'frame-src'],
    ['connect-src', "default-src 'self'", 'default-src'],
    ['connect-src', "default-src 'self'; connect-src *", 'connect-src'],
    ['img-src', "default-src 'self'; img-src data:", 'img-src'],
  ] as const)('resolves %s in "%s" to %s', (directive, header, expected) => {
    expect(getEffectiveCspSources(parseCsp(header), directive)?.directive).toBe(expected);
  });

  it('returns null when a directive is unrestricted', () => {
    expect(getEffectiveCspSources(parseCsp("script-src 'self'"), 'connect-src')).toBeNull();
    expect(cspAllowsUrl(parseCsp("script-src 'self'"), 'img-src', scriptUrl, pageUrl)).toBe(true);
  });

  it('does not apply default-src to form-action', () => {
    expect(getEffectiveCspSources(parseCsp("default-src 'none'"), 'form-action')).toBeNull();
    expect(getEffectiveCspSources(parseCsp("form-action 'self'"), 'form-action')).toEqual({
      directive: 'form-action',
      sources: ["'self'"],
    });
  });
});
