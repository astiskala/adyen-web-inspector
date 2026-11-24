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

function isSourceListMatchingUrl(
  sources: readonly string[],
  url: string,
  pageUrl: string
): boolean {
  try {
    const resource = new URL(url, pageUrl);
    const page = new URL(pageUrl);
    return sources.some((source) => isSourceMatchingUrl(source, resource, page));
  } catch {
    return false;
  }
}

/**
Returns true when the policy allows loading the URL for a resource type
other than scripts, which `readScriptAllowance()` reads.
*/
export function isUrlAllowedByCsp(
  csp: ParsedCsp,
  directive: Exclude<CspFetchDirective, 'script-src'>,
  url: string,
  pageUrl: string
): boolean {
  const effective = getEffectiveCspSources(csp, directive);
  return effective === null || isSourceListMatchingUrl(effective.sources, url, pageUrl);
}

/**
Whether a policy lets an external script load: `allowed`, `blocked`, or
`needs-trusted-insertion` under `'strict-dynamic'` when no nonce or hash
allows it, because the script then loads only if a trusted script inserted
it, which the page does not show.
*/
export type ScriptAllowance = 'allowed' | 'blocked' | 'needs-trusted-insertion';

/**
The attributes of a script element that can allow it regardless of its URL.
*/
interface ScriptAttributes {
  readonly nonce?: string;
  readonly integrity?: string;
}

const HASH_SOURCE = /^'(?:sha256|sha384|sha512)-\S+'$/i;
const INTEGRITY_HASH = /^(?:sha256|sha384|sha512)-[^?\s]+/i;

/**
Hash algorithms compare case-insensitively; base64 values do not.
*/
function normalizeHash(expression: string): string {
  const dash = expression.indexOf('-');
  return `${expression.slice(0, dash).toLowerCase()}${expression.slice(dash)}`;
}

/**
The hashes of an integrity attribute, as SRI parses them: tokens with an
unknown algorithm are ignored, and options after `?` are dropped.
*/
function readIntegrityHashes(integrity: string): string[] {
  return integrity
    .split(/\s+/)
    .map((token) => INTEGRITY_HASH.exec(token)?.[0])
    .filter((hash) => hash !== undefined)
    .map(normalizeHash);
}

function readListedHashes(sources: readonly string[]): ReadonlySet<string> {
  return new Set(
    sources
      .filter((source) => HASH_SOURCE.test(source))
      .map((source) => normalizeHash(source.slice(1, -1)))
  );
}

/**
Reads whether the policy lets an external script load, following CSP Level 3
as Chromium implements it: a listed nonce, or an integrity attribute whose
every hash the policy lists, allows the script on any host; otherwise
`'strict-dynamic'` ignores host and scheme sources and allows only scripts a
trusted script inserted.
*/
export function readScriptAllowance(
  csp: ParsedCsp,
  url: string,
  pageUrl: string,
  script: ScriptAttributes = {}
): ScriptAllowance {
  const effective = getEffectiveCspSources(csp, 'script-src');
  if (effective === null) return 'allowed';
  const { sources } = effective;
  if (script.nonce !== undefined && sources.includes(`'nonce-${script.nonce}'`)) return 'allowed';

  const hashes = readIntegrityHashes(script.integrity ?? '');
  const listed = readListedHashes(sources);
  if (hashes.length > 0 && hashes.every((hash) => listed.has(hash))) return 'allowed';

  if (sources.some((source) => source.toLowerCase() === "'strict-dynamic'")) {
    return 'needs-trusted-insertion';
  }
  return isSourceListMatchingUrl(sources, url, pageUrl) ? 'allowed' : 'blocked';
}
