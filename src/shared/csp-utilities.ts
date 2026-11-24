/**
Content Security Policy (CSP) parsing and analysis utilities.
*/

interface ParsedCsp {
  directives: Record<string, string[]>;
}

/**
Parses a CSP header value into lowercased directive names and tokenized values.
*/
export function parseCsp(headerValue: string): ParsedCsp {
  const directives: Record<string, string[]> = {};
  const parts = headerValue.split(';').map((p) => p.trim());
  for (const part of parts) {
    if (part === '') continue;
    const [directive, ...values] = part.split(/\s+/);
    if (
      directive !== undefined &&
      directive !== '' &&
      directives[directive.toLowerCase()] === undefined
    ) {
      directives[directive.toLowerCase()] = values;
    }
  }
  return { directives };
}

const NETWORK_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:']);
const SCHEME_SOURCE = /^[a-z][\d+.a-z-]*:$/;
const HOST_SOURCE = /^(?:([a-z][\d+.a-z-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?(\/.*)?$/i;

/**
CSP scheme matching: a scheme matches itself, and http and ws also match their secure upgrades.
*/
function isSchemeMatching(sourceScheme: string, resourceScheme: string): boolean {
  return (
    sourceScheme === resourceScheme ||
    (sourceScheme === 'http:' && resourceScheme === 'https:') ||
    (sourceScheme === 'ws:' && resourceScheme === 'wss:')
  );
}

function isSourceMatchingUrl(source: string, resource: URL, page: URL): boolean {
  const keyword = source.toLowerCase();
  if (keyword === "'self'") return resource.origin === page.origin;
  if (keyword === '*') {
    return NETWORK_SCHEMES.has(resource.protocol) || resource.protocol === page.protocol;
  }
  return SCHEME_SOURCE.test(keyword)
    ? isSchemeMatching(keyword, resource.protocol)
    : isHostSourceMatchingUrl(source, resource, page);
}

function defaultPort(protocol: string): string {
  return protocol === 'https:' || protocol === 'wss:' ? '443' : '80';
}

/**
A source without a port allows only the scheme's default port; `*` allows any port.
*/
function isPortMatching(port: string | undefined, resource: URL): boolean {
  return port === undefined
    ? resource.port === ''
    : port === '*' || (resource.port || defaultPort(resource.protocol)) === port;
}

/**
A path ending in `/` allows everything below it; any other path must match exactly.
*/
function isPathMatching(path: string | undefined, resource: URL): boolean {
  if (path === undefined) return true;
  return path.endsWith('/') ? resource.pathname.startsWith(path) : resource.pathname === path;
}

/**
Matches a host source such as `https://*.adyen.com:443/path` against a
resource URL, following CSP Level 3: a source without a scheme takes the
page's, hosts and schemes are case-insensitive, and paths are not.
*/
function isHostSourceMatchingUrl(source: string, resource: URL, page: URL): boolean {
  const [, scheme, wildcard, sourceHost, port, path] = HOST_SOURCE.exec(source) ?? [];
  if (sourceHost === undefined) return false;
  const host = sourceHost.toLowerCase();
  const sourceScheme = scheme === undefined ? page.protocol : `${scheme.toLowerCase()}:`;
  const isHostMatches =
    wildcard === '*.' ? resource.hostname.endsWith(`.${host}`) : resource.hostname === host;
  return (
    isSchemeMatching(sourceScheme, resource.protocol) &&
    isHostMatches &&
    isPortMatching(port, resource) &&
    isPathMatching(path, resource)
  );
}

type CspFetchDirective = 'script-src' | 'frame-src' | 'connect-src' | 'img-src' | 'form-action';

// form-action is a navigation directive, so it never falls back to default-src.
const CSP_DIRECTIVE_FALLBACKS: Record<CspFetchDirective, readonly string[]> = {
  'script-src': ['script-src-elem', 'script-src', 'default-src'],
  'frame-src': ['frame-src', 'child-src', 'default-src'],
  'connect-src': ['connect-src', 'default-src'],
  'img-src': ['img-src', 'default-src'],
  'form-action': ['form-action'],
};

interface EffectiveCspSources {
  readonly directive: string;
  readonly sources: readonly string[];
}

/**
Returns the directive that governs a resource type, following CSP fallback
rules, or null when the policy leaves that resource type unrestricted.
*/
export function getEffectiveCspSources(
  csp: ParsedCsp,
  directive: CspFetchDirective
): EffectiveCspSources | null {
  const candidates = CSP_DIRECTIVE_FALLBACKS[directive];
  for (const candidate of candidates) {
    const sources = csp.directives[candidate];
    if (sources !== undefined) return { directive: candidate, sources };
  }
  return null;
}

/**
Returns true when the policy allows loading the URL for the resource type.
A script's `nonce` matches a listed nonce source on any host; under
`'strict-dynamic'`, host and scheme sources no longer allow scripts.
*/
export function isUrlAllowedByCsp(
  csp: ParsedCsp,
  directive: CspFetchDirective,
  url: string,
  pageUrl: string,
  nonce?: string
): boolean {
  const effective = getEffectiveCspSources(csp, directive);
  if (effective === null) return true;
  if (directive === 'script-src') {
    if (nonce !== undefined && effective.sources.includes(`'nonce-${nonce}'`)) return true;
    if (effective.sources.includes("'strict-dynamic'")) return false;
  }

  try {
    const resource = new URL(url, pageUrl);
    const page = new URL(pageUrl);
    return effective.sources.some((source) => isSourceMatchingUrl(source, resource, page));
  } catch {
    return false;
  }
}
