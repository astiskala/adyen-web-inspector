import { describe, expect, it } from 'vitest';
import {
  parseCsp,
  isUrlAllowedByCsp,
  getEffectiveCspSources,
  readScriptAllowance,
} from '../../../src/shared/csp-utilities';

/**
True when the policy lets the script load without further conditions.
*/
function isScriptAllowed(
  csp: ReturnType<typeof parseCsp>,
  url: string,
  pageUrl: string,
  nonce?: string
): boolean {
  return readScriptAllowance(csp, url, pageUrl, nonce === undefined ? {} : { nonce }) === 'allowed';
}

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
    header: ' '.repeat(3),
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

  it('uses the first instance of a repeated directive', () => {
    const result = parseCsp("script-src 'self'; script-src https:");
    expect(result.directives['script-src']).toEqual(["'self'"]);
  });
});

describe('effective CSP sources', () => {
  const pageUrl = 'https://merchant.example/checkout';
  const scriptUrl = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.31.0/adyen.js';

  it('uses script-src-elem before script-src, then default-src', () => {
    expect(
      isScriptAllowed(parseCsp("default-src https:; script-src 'self'"), scriptUrl, pageUrl)
    ).toBe(false);
    expect(
      isScriptAllowed(parseCsp("script-src https:; script-src-elem 'self'"), scriptUrl, pageUrl)
    ).toBe(false);
    expect(isScriptAllowed(parseCsp('default-src https:'), scriptUrl, pageUrl)).toBe(true);
  });

  it('matches exact hosts and wildcard subdomains without matching lookalikes', () => {
    expect(isScriptAllowed(parseCsp('script-src https://*.adyen.com'), scriptUrl, pageUrl)).toBe(
      true
    );
    expect(isScriptAllowed(parseCsp('script-src https://adyen.com'), scriptUrl, pageUrl)).toBe(
      false
    );
    expect(isScriptAllowed(parseCsp('script-src https://notadyen.com'), scriptUrl, pageUrl)).toBe(
      false
    );
  });

  it.each(['https://evil-adyen.com/adyen.js', 'https://adyen.com/adyen.js'])(
    'does not let *.adyen.com allow %s, which is not a subdomain',
    (url) => {
      expect(isScriptAllowed(parseCsp('script-src https://*.adyen.com'), url, pageUrl)).toBe(false);
    }
  );

  it('honors self, scheme sources and none', () => {
    expect(
      isScriptAllowed(parseCsp("script-src 'self'"), 'https://merchant.example/app.js', pageUrl)
    ).toBe(true);
    expect(isScriptAllowed(parseCsp('script-src https:'), scriptUrl, pageUrl)).toBe(true);
    expect(isScriptAllowed(parseCsp("script-src 'none'"), scriptUrl, pageUrl)).toBe(false);
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

  it.each([
    ['https://checkoutshopper-test.adyen.com:443', true],
    ['https://checkoutshopper-test.adyen.com:8443', false],
    // CSP Level 3 lets an http source match its https upgrade.
    ['http://checkoutshopper-test.adyen.com', true],
    ['checkoutshopper-test.adyen.com/checkoutshopper/', true],
    ['checkoutshopper-test.adyen.com/other/', false],
    ['*', true],
    ['data:', false],
    ['HTTPS://CHECKOUTSHOPPER-TEST.ADYEN.COM', true],
    ["'SELF'", false],
    ['https://checkoutshopper-test.adyen.com:*', true],
    // A path without a trailing slash must match exactly, so a shared prefix is not enough.
    ['https://checkoutshopper-test.adyen.com/checkoutshopper', false],
    ['https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.31.0/adyen.js', true],
    ['https://checkoutshopper-test.adyen.com/checkoutshopper/SDK/', false],
    // Malformed tokens allow nothing.
    ['https://', false],
    ['checkoutshopper-test.adyen.com:https', false],
  ])('matches the source %s against an HTTPS script: %s', (source, allowed) => {
    expect(isScriptAllowed(parseCsp(`script-src ${source}`), scriptUrl, pageUrl)).toBe(allowed);
  });

  it('matches explicit ports on plain HTTP resources', () => {
    expect(
      isUrlAllowedByCsp(
        parseCsp('img-src http://assets.example:80'),
        'img-src',
        'http://assets.example/logo.svg',
        'http://merchant.example/'
      )
    ).toBe(true);
  });

  it.each([
    ['https://shop.example/app.js', 'http://shop.example/', true],
    ['wss://shop.example/socket', 'https://shop.example/', true],
    ['ws://shop.example/socket', 'http://shop.example/', true],
    ['ws://shop.example/socket', 'https://shop.example/', false],
    ['http://shop.example/app.js', 'https://shop.example/', false],
    ['https://shop.example:8443/app.js', 'http://shop.example/', false],
    ['https://cdn.shop.example/app.js', 'http://shop.example/', false],
  ])("lets 'self' match %s from %s as CSP Level 3 does: %s", (url, page, allowed) => {
    expect(isUrlAllowedByCsp(parseCsp("connect-src 'self'"), 'connect-src', url, page)).toBe(
      allowed
    );
  });

  it('allows only the default port when a source names none', () => {
    const policy = parseCsp('connect-src https://api.example');

    expect(isUrlAllowedByCsp(policy, 'connect-src', 'https://api.example/x', pageUrl)).toBe(true);
    expect(isUrlAllowedByCsp(policy, 'connect-src', 'https://api.example:8443/x', pageUrl)).toBe(
      false
    );
  });

  it('gives a schemeless source the page scheme, upgrading http pages to https', () => {
    const policy = parseCsp('img-src assets.example');

    expect(isUrlAllowedByCsp(policy, 'img-src', 'http://assets.example/a.png', pageUrl)).toBe(
      false
    );
    expect(
      isUrlAllowedByCsp(policy, 'img-src', 'https://assets.example/a.png', 'http://shop.example/')
    ).toBe(true);
  });

  it('reads 443 as the default port of secure WebSocket URLs', () => {
    const policy = parseCsp('connect-src wss://live.example:443');

    expect(isUrlAllowedByCsp(policy, 'connect-src', 'wss://live.example/socket', pageUrl)).toBe(
      true
    );
  });

  it('matches scheme sources beyond http and https, with secure upgrades', () => {
    expect(
      isUrlAllowedByCsp(parseCsp('img-src data:'), 'img-src', 'data:image/png;base64,AA', pageUrl)
    ).toBe(true);
    expect(
      isUrlAllowedByCsp(parseCsp('connect-src ws:'), 'connect-src', 'wss://live.example/', pageUrl)
    ).toBe(true);
    expect(
      isUrlAllowedByCsp(parseCsp('connect-src *'), 'connect-src', 'wss://live.example/', pageUrl)
    ).toBe(true);
  });

  it('rejects resources when the page URL cannot be parsed', () => {
    expect(isScriptAllowed(parseCsp("script-src 'self'"), scriptUrl, 'not a url')).toBe(false);
  });

  it('returns null when a directive is unrestricted', () => {
    expect(getEffectiveCspSources(parseCsp("script-src 'self'"), 'connect-src')).toBeNull();
    expect(isUrlAllowedByCsp(parseCsp("script-src 'self'"), 'img-src', scriptUrl, pageUrl)).toBe(
      true
    );
  });

  it('does not apply default-src to form-action', () => {
    expect(getEffectiveCspSources(parseCsp("default-src 'none'"), 'form-action')).toBeNull();
    expect(getEffectiveCspSources(parseCsp("form-action 'self'"), 'form-action')).toEqual({
      directive: 'form-action',
      sources: ["'self'"],
    });
  });
});

describe('isUrlAllowedByCsp wildcard sources', () => {
  it('lets a bare * source allow http and https resources only', () => {
    const policy = parseCsp('img-src *');
    const page = 'https://merchant.example/checkout';

    expect(isUrlAllowedByCsp(policy, 'img-src', 'http://cdn.example/a.png', page)).toBe(true);
    expect(isUrlAllowedByCsp(policy, 'img-src', 'data:image/png;base64,AAAA', page)).toBe(false);
  });
});

describe('readScriptAllowance nonces', () => {
  const page = 'https://merchant.example/checkout';
  const sdk = 'https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk/6.48.1/adyen.js';

  it('allows a script whose nonce the policy lists, from any host', () => {
    const policy = parseCsp("script-src 'self' 'nonce-r4nd0m'");

    expect(isScriptAllowed(policy, sdk, page, 'r4nd0m')).toBe(true);
    expect(isScriptAllowed(policy, sdk, page, 'other')).toBe(false);
    expect(isScriptAllowed(policy, sdk, page)).toBe(false);
  });

  it.each([
    "script-src 'nonce-r4nd0m' 'strict-dynamic' https://checkoutshopper-live.cdn.adyen.com",
    "default-src 'nonce-r4nd0m' 'strict-dynamic' https: 'self'",
  ])('ignores host and scheme sources under strict-dynamic: %s', (header) => {
    const policy = parseCsp(header);

    expect(isScriptAllowed(policy, sdk, page, 'r4nd0m')).toBe(true);
    expect(isScriptAllowed(policy, sdk, page)).toBe(false);
  });

  it('applies strict-dynamic to scripts only', () => {
    const policy = parseCsp("default-src 'strict-dynamic' https://*.adyen.com");

    expect(isUrlAllowedByCsp(policy, 'connect-src', sdk, page)).toBe(true);
  });
});

describe('readScriptAllowance', () => {
  const page = 'https://merchant.example/checkout';
  const sdk = 'https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk/6.48.1/adyen.js';
  const hash384 = 'sha384-ABCdef+/123=';
  const hash512 = 'sha512-XYZ789=';

  it('allows an external script whose every integrity hash the policy lists, on any host', () => {
    const policy = parseCsp(`script-src 'self' '${hash384}' 'SHA512-XYZ789='`);

    expect(readScriptAllowance(policy, sdk, page, { integrity: hash384 })).toBe('allowed');
    expect(readScriptAllowance(policy, sdk, page, { integrity: `${hash384} ${hash512}` })).toBe(
      'allowed'
    );
    expect(readScriptAllowance(policy, sdk, page, { integrity: `${hash384}?ct=x` })).toBe(
      'allowed'
    );
  });

  it('blocks when any integrity hash is unlisted, or a base64 value differs only in case', () => {
    const policy = parseCsp(`script-src '${hash384}'`);

    expect(readScriptAllowance(policy, sdk, page, { integrity: `${hash384} ${hash512}` })).toBe(
      'blocked'
    );
    expect(readScriptAllowance(policy, sdk, page, { integrity: 'sha384-abcdef+/123=' })).toBe(
      'blocked'
    );
    expect(readScriptAllowance(policy, sdk, page, { integrity: 'md5-ABCdef+/123=' })).toBe(
      'blocked'
    );
    expect(readScriptAllowance(policy, sdk, page)).toBe('blocked');
  });

  it("lets a listed hash allow the script under 'strict-dynamic'", () => {
    const policy = parseCsp(`script-src '${hash384}' 'strict-dynamic'`);

    expect(readScriptAllowance(policy, sdk, page, { integrity: hash384 })).toBe('allowed');
  });

  it.each([
    "script-src 'nonce-r4nd0m' 'strict-dynamic' https://checkoutshopper-live.cdn.adyen.com",
    "script-src 'nonce-r4nd0m' 'STRICT-DYNAMIC'",
  ])(
    "leaves a script without a nonce or hash to trusted insertion under 'strict-dynamic': %s",
    (header) => {
      expect(readScriptAllowance(parseCsp(header), sdk, page)).toBe('needs-trusted-insertion');
    }
  );

  it('allows scripts when the policy does not restrict them', () => {
    expect(readScriptAllowance(parseCsp("img-src 'self'"), sdk, page)).toBe('allowed');
  });
});
