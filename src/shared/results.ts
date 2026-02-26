/**
 * Check result factory functions and remediation formatting.
 */

import type { CheckId, CheckResult } from './types.js';
import {
  ADYEN_WEB_BEST_PRACTICES_DOC,
  WARNING_PRIORITY_BY_ID,
  type WarningPriority,
} from './check-config.js';

export type IssueImpactLevel = 'high' | 'medium' | 'low' | 'manual';

function getWarningPriority(checkId: CheckId): WarningPriority {
  return WARNING_PRIORITY_BY_ID[checkId] ?? 'medium';
}

/**
 * Maps a check result to the normalised impact bucket used for prioritisation.
 */
export function getImpactLevel(check: CheckResult): IssueImpactLevel | 'none' {
  if (check.severity === 'fail') {
    return 'high';
  }
  if (check.severity === 'warn') {
    const priority = getWarningPriority(check.id);
    if (priority === 'high') return 'high';
    if (priority === 'low') return 'low';
    return 'medium';
  }
  if (check.severity === 'notice') {
    return 'manual';
  }
  return 'none';
}

/**
 * Returns a UI-friendly impact label for a check result.
 */
export function getImpactLabel(check: CheckResult): string {
  const impactLevel = getImpactLevel(check);
  if (impactLevel === 'high') return 'High impact';
  if (impactLevel === 'medium') return 'Medium impact';
  if (impactLevel === 'low') return 'Low impact';
  if (impactLevel === 'manual') return 'Manual verification needed';
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
