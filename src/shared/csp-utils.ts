/**
 * Content Security Policy (CSP) parsing and analysis utilities.
 */

interface ParsedCsp {
  directives: Record<string, string[]>;
  raw: string;
}

/**
 * Parses a CSP header value into lowercased directive names and tokenized values.
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
  return { directives, raw: headerValue };
}

function normalizeCspDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
}

function extractCspSourceHost(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized === '*' ||
    normalized.endsWith(':') ||
    normalized.codePointAt(0) === 39
  ) {
    return null;
  }

  const withoutScheme = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const hostAndPath = withoutScheme.split('/')[0] ?? '';
  const hostWithWildcard = hostAndPath.split(':')[0] ?? '';
  if (!hostWithWildcard) {
    return null;
  }

  return hostWithWildcard.replace(/^\*\./, '');
}

/**
 * Returns true when a directive includes the given domain or one of its subdomains.
 * CSP keywords and scheme-only values are ignored.
 */
export function cspIncludesDomain(csp: ParsedCsp, directive: string, domain: string): boolean {
  const normalizedDomain = normalizeCspDomain(domain);
  const values = csp.directives[directive] ?? [];
  return values.some((value) => {
    const host = extractCspSourceHost(value);
    if (host === null) {
      return false;
    }

    return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
  });
}

function sourceMatchesUrl(source: string, resource: URL, page: URL): boolean {
  if (source === "'self'") return resource.origin === page.origin;
  if (source === '*') return resource.protocol === 'https:' || resource.protocol === 'http:';
  if (source === 'https:' || source === 'http:') return resource.protocol === source;

  const match = /^(?:(https?):\/\/)?(\*\.)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(source.toLowerCase());
  if (!match) return false;

  const [, scheme, wildcard, host, port, path] = match;
  if (scheme !== undefined && resource.protocol !== `${scheme}:`) return false;
  if (host === undefined) return false;
  const hostMatches =
    wildcard === '*.' ? resource.hostname.endsWith(`.${host}`) : resource.hostname === host;
  if (!hostMatches) return false;
  if (
    port !== undefined &&
    (resource.port || (resource.protocol === 'https:' ? '443' : '80')) !== port
  ) {
    return false;
  }
  return path === undefined || resource.pathname.startsWith(path);
}

export const cspAllowsUrl = (
  csp: ParsedCsp,
  directive: 'script-src' | 'frame-src',
  url: string,
  pageUrl: string
): boolean => {
  const candidates =
    directive === 'script-src'
      ? ['script-src-elem', 'script-src', 'default-src']
      : ['frame-src', 'child-src', 'default-src'];
  const effective = candidates.find((candidate) => csp.directives[candidate] !== undefined);
  if (effective === undefined) return true;

  try {
    const resource = new URL(url, pageUrl);
    const page = new URL(pageUrl);
    return (csp.directives[effective] ?? []).some((source) =>
      sourceMatchesUrl(source, resource, page)
    );
  } catch {
    return false;
  }
};
