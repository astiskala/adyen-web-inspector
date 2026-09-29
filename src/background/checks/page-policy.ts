/**
 * Page policy — the checkout document's response headers as checks read them:
 * the evidence for each header, and the Content-Security-Policy it enforces.
 * Headers can be unavailable, and then a missing header is unknown rather
 * than absent. Every enforced policy applies, so a resource is allowed only
 * when all of them allow it.
 */

import type { ScanPayload } from '../../shared/types.js';
import { cspAllowsUrl, getEffectiveCspSources, parseCsp } from '../../shared/utils.js';

type CspDirective = Parameters<typeof getEffectiveCspSources>[1];
type GoverningSources = NonNullable<ReturnType<typeof getEffectiveCspSources>>;

/** Evidence for one response header of the checkout document. */
export type DocumentHeaderEvidence =
  | { readonly state: 'unavailable' }
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly value: string };

interface EnforcedPagePolicy {
  readonly status: 'enforced';
  /** Returns true when every enforced policy allows the URL for the directive. */
  allows: (directive: CspDirective, url: string) => boolean;
  /** Governing sources per policy, following fallbacks; null where a policy leaves it unrestricted. */
  governing: (directive: CspDirective) => readonly (GoverningSources | null)[];
  /** Returns the first governing source list that allows neither `*` nor `https:`. */
  restrictive: (directive: CspDirective) => GoverningSources | undefined;
  /** Returns true when any enforced policy declares the directive by name. */
  declares: (directive: string) => boolean;
}

/** The checkout document's policy: headers unavailable, no policy, or enforced policies. */
export type PagePolicy =
  { readonly status: 'unavailable' } | { readonly status: 'absent' } | EnforcedPagePolicy;

/** Every value of a header, case-insensitively; null when the headers are unavailable. */
function headerValues(payload: ScanPayload, name: string): string[] | null {
  const { documentHeaders } = payload;
  if (documentHeaders.status === 'unavailable') return null;
  const lower = name.toLowerCase();
  return documentHeaders.headers
    .filter((header) => header.name.toLowerCase() === lower)
    .map((header) => header.value);
}

/** Reads one response header of the checkout document; the first value wins when repeated. */
export function readDocumentHeader(payload: ScanPayload, name: string): DocumentHeaderEvidence {
  const values = headerValues(payload, name);
  if (values === null) return { state: 'unavailable' };
  const [value] = values;
  return value === undefined ? { state: 'absent' } : { state: 'present', value };
}

function allowsAnySource(governing: GoverningSources): boolean {
  return governing.sources.includes('*') || governing.sources.includes('https:');
}

/** Reads the enforced Content-Security-Policy from the checkout document headers. */
export function readPagePolicy(payload: ScanPayload): PagePolicy {
  const values = headerValues(payload, 'content-security-policy');
  if (values === null) return { status: 'unavailable' };

  const policies = values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .map(parseCsp);
  if (policies.length === 0) return { status: 'absent' };

  const governing = (directive: CspDirective): (GoverningSources | null)[] =>
    policies.map((policy) => getEffectiveCspSources(policy, directive));

  return {
    status: 'enforced',
    allows: (directive, url) =>
      policies.every((policy) => cspAllowsUrl(policy, directive, url, payload.pageUrl)),
    governing,
    restrictive: (directive) =>
      governing(directive).find(
        (sources): sources is GoverningSources => sources !== null && !allowsAnySource(sources)
      ),
    declares: (directive) => policies.some((policy) => policy.directives[directive] !== undefined),
  };
}
