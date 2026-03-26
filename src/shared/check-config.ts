/**
 * Per-check metadata: impact weights and the shared Adyen best-practices doc URL.
 */
import type { CheckId } from './types.js';

export type WarningPriority = 'high' | 'medium' | 'low';

export const ADYEN_WEB_BEST_PRACTICES_DOC =
  'https://docs.adyen.com/online-payments/web-best-practices/';

/**
 * Override the impact level of warn-severity checks.
 * Defaults to 'medium' for any check not listed here.
 */
export const WARNING_PRIORITY_BY_ID: Partial<Record<CheckId, WarningPriority>> = {
  'security-sri-css': 'high',
  'risk-df-iframe': 'high',
  'risk-module-not-disabled': 'high',
  'security-csp-present': 'medium',
  'security-csp-script-src': 'medium',
  'security-csp-frame-src': 'medium',
  'security-csp-frame-ancestors': 'medium',
  'auth-client-key': 'medium',
  'auth-locale': 'medium',
  'callback-on-payment-completed': 'medium',
  'callback-on-payment-failed': 'medium',
  'callback-actions-pattern': 'medium',
  'callback-on-submit-filtering': 'medium',
  'sdk-analytics': 'medium',
  'sdk-bundle-type': 'medium',
  'version-detected': 'medium',
  'version-latest': 'medium',
  '3p-ad-pixels': 'medium',
  'env-not-iframe': 'medium',
};

/**
 * Notice-severity checks that should render as low impact.
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
