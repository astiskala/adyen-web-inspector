/**
 * Cross-module constants and helpers shared across multiple check files.
 */

import type { ImplementationAttributes } from '../../shared/types.js';

/** The Adyen docs integration tab for the scan: Drop-in, or Components for every other flavor. */
export function docsIntegration(attributes: ImplementationAttributes): 'Drop-in' | 'Components' {
  return attributes.flavor.value === 'Drop-in' ? 'Drop-in' : 'Components';
}

export const SKIP_REASONS = {
  CHECKOUT_CONFIG_NOT_DETECTED: 'Checkout config not detected.',
  HEADERS_UNAVAILABLE: 'Document response headers could not be captured.',
} as const;

export const COMMON_DETAILS = {
  PCI_COMPLIANCE_NOTICE: 'This is required to maintain PCI compliance.',
} as const;
