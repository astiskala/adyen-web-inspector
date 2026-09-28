/**
 * Page policy — the Content-Security-Policy enforced on the checkout document.
 * Every enforced policy applies, so a resource is allowed only when all of
 * them allow it.
 */

import type { ScanPayload } from '../../shared/types.js';
import {
  cspAllowsUrl,
  getAllHeaders,
  getEffectiveCspSources,
  parseCsp,
} from '../../shared/utils.js';

type CspDirective = Parameters<typeof getEffectiveCspSources>[1];
type GoverningSources = NonNullable<ReturnType<typeof getEffectiveCspSources>>;

interface EnforcedPagePolicy {
  readonly status: 'enforced';
  /** Returns true when every enforced policy allows the URL for the directive. */
  allows(directive: CspDirective, url: string): boolean;
  /** Governing sources per policy, following fallbacks; null where a policy leaves it unrestricted. */
  governing(directive: CspDirective): readonly (GoverningSources | null)[];
  /** Returns the first governing source list that allows neither `*` nor `https:`. */
  restrictive(directive: CspDirective): GoverningSources | undefined;
  /** Returns true when any enforced policy declares the directive by name. */
  declares(directive: string): boolean;
}

/** The checkout document's policy: headers unavailable, no policy, or enforced policies. */
export type PagePolicy =
  { readonly status: 'unavailable' } | { readonly status: 'absent' } | EnforcedPagePolicy;

function allowsAnySource(governing: GoverningSources): boolean {
  return governing.sources.includes('*') || governing.sources.includes('https:');
}

/** Reads the enforced Content-Security-Policy from the checkout document headers. */
export function readPagePolicy(payload: ScanPayload): PagePolicy {
  if (!payload.mainDocumentHeadersAvailable) return { status: 'unavailable' };

  const policies = getAllHeaders(payload, 'content-security-policy')
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
