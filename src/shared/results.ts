/**
 * Check result factory functions and remediation formatting.
 */

import type { CheckImpact, CheckResult, Severity } from './types.js';

export const ADYEN_WEB_BEST_PRACTICES_DOC =
  'https://docs.adyen.com/online-payments/web-best-practices/';

/** Impact buckets in priority order, used to group and sort issues. */
export const ISSUE_IMPACT_ORDER: readonly CheckImpact[] = ['high', 'medium', 'low', 'manual'];

/** Display labels for impact groups, shared by the popup, DevTools panel, and reports. */
export const IMPACT_LABELS: Readonly<Record<CheckImpact, string>> = {
  high: 'High impact',
  medium: 'Medium impact',
  low: 'Low impact',
  manual: 'Manual verification',
};

/** Returns true when a check result is an issue (fail, warn, or notice). */
export function isIssue(check: CheckResult): boolean {
  return check.severity === 'fail' || check.severity === 'warn' || check.severity === 'notice';
}

/**
 * Returns the impact an issue severity carries unless its check overrides it,
 * or undefined for severities that are not issues.
 */
export function getDefaultImpact(severity: Severity): CheckImpact | undefined {
  if (severity === 'fail') return 'high';
  if (severity === 'warn') return 'medium';
  if (severity === 'notice') return 'manual';
  return undefined;
}

/**
 * Maps a check result to the normalised impact bucket used for prioritisation.
 */
export function getImpactLevel(check: CheckResult): CheckImpact | 'none' {
  const defaultImpact = getDefaultImpact(check.severity);
  if (defaultImpact === undefined) return 'none';
  return check.impact ?? defaultImpact;
}

/**
 * Returns a UI-friendly impact label for a check result.
 */
export function getImpactLabel(check: CheckResult): string {
  const impactLevel = getImpactLevel(check);
  if (impactLevel !== 'none') return IMPACT_LABELS[impactLevel];
  if (check.severity === 'pass') return 'No impact';
  if (check.severity === 'skip') return 'Not applicable';
  return 'Informational';
}

/**
 * Returns the best docs URL for a check result.
 * When preferAdyenDocs is true, explicit check docs are preserved and checks
 * without docs fall back to the general Adyen best-practices page.
 */
export function getRecommendedDocsUrl(check: CheckResult, preferAdyenDocs: boolean): string | null {
  if (check.docsUrl !== undefined) {
    return check.docsUrl;
  }
  if (preferAdyenDocs) {
    return ADYEN_WEB_BEST_PRACTICES_DOC;
  }
  return null;
}

function formatFriendlyRemediation(text: string): string {
  if (text.startsWith('AdyenCheckout(')) {
    return `Update your AdyenCheckout configuration. Example: ${text}`;
  }
  if (text.startsWith('Content-Security-Policy:')) {
    return `Update your Content-Security-Policy header on the checkout response. Example: ${text}`;
  }
  if (/^[A-Za-z-]+:\s+/.test(text)) {
    return `Set this response header on the checkout page: ${text}`;
  }
  if (text.startsWith('<script') || text.startsWith('<link') || text.startsWith('<iframe')) {
    return `Update your markup to match this secure example: ${text}`;
  }
  return text;
}

interface RemediationOptions {
  readonly friendly?: boolean;
}

/**
 * Returns remediation text for a check, with optional friendlier phrasing.
 */
export function getRemediationText(check: CheckResult, options: RemediationOptions = {}): string {
  const baseText = check.remediation;
  if (baseText !== undefined) {
    return options.friendly === true ? formatFriendlyRemediation(baseText) : baseText;
  }

  if (check.severity === 'notice') {
    const impactLevel = getImpactLevel(check);
    if (impactLevel === 'low') {
      return options.friendly === true
        ? 'Review this recommended improvement, apply the change, then rerun the scan.'
        : 'Review this recommendation and align your integration with Adyen best practices.';
    }
    return options.friendly === true
      ? 'Review this item manually in your site config and network headers before going live.'
      : 'Validate this area manually based on your page headers and Adyen setup.';
  }
  if (check.severity === 'fail' || check.severity === 'warn') {
    return options.friendly === true
      ? 'Follow the linked Adyen guidance, apply the configuration change, then rerun the scan.'
      : 'Review this check and align your integration with Adyen best practices.';
  }
  return 'No remediation required.';
}
