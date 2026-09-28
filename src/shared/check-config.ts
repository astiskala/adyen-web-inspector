/**
 * Legacy impact fallbacks and the shared Adyen best-practices doc URL.
 */
import type { CheckId } from './types.js';

export type WarningPriority = 'high' | 'medium' | 'low';

export const ADYEN_WEB_BEST_PRACTICES_DOC =
  'https://docs.adyen.com/online-payments/web-best-practices/';

/**
 * Fallback impact for warn-severity checks in stored results created before checks carried impact.
 * Defaults to 'medium' for any check not listed here.
 */
export const WARNING_PRIORITY_BY_ID: Partial<Record<CheckId, WarningPriority>> = {
  'security-sri-css': 'high',
  'risk-df-iframe': 'high',
  'risk-module-not-disabled': 'high',
};

/**
 * Fallback low-impact notice IDs for stored results without an impact value.
 * Any notice not listed here falls back to manual review by default because
 * the finding depends on human or PCI/compliance verification.
 */
export const LOW_IMPACT_NOTICE_IDS: ReadonlySet<CheckId> = new Set([
  'sdk-bundle-type',
  'version-latest',
  'security-referrer-policy',
  'security-x-content-type',
  'security-xss-protection',
  'security-hsts',
  'styling-css-custom-props',
]);
