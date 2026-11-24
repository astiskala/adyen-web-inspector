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

function isSourceMatchingUrl(source: string, resource: URL, page: URL): boolean {
  if (source === "'self'") return resource.origin === page.origin;
  if (source === '*') return resource.protocol === 'https:' || resource.protocol === 'http:';
  return source === 'https:' || source === 'http:'
    ? resource.protocol === source
    : isHostSourceMatchingUrl(source, resource);
}

/**
Matches a host source such as `https://*.adyen.com:443/path` against a resource URL.
*/
function isHostSourceMatchingUrl(source: string, resource: URL): boolean {
  const match = /^(?:(https?):\/\/)?(\*\.)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(source.toLowerCase());
  const host = match?.[3];
  if (match === null || host === undefined) return false;

  const [, scheme, wildcard, , port, path] = match;
  if (scheme !== undefined && resource.protocol !== `${scheme}:`) return false;
  const isHostMatches =
    wildcard === '*.' ? resource.hostname.endsWith(`.${host}`) : resource.hostname === host;
  if (!isHostMatches) return false;
  if (
    port !== undefined &&
    (resource.port || (resource.protocol === 'https:' ? '443' : '80')) !== port
  ) {
    return false;
  }
  return path === undefined || resource.pathname.startsWith(path);
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
