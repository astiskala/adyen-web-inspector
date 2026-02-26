/**
 * Cross-module constants shared across multiple check files.
 */

export const SKIP_REASONS = {
  CHECKOUT_CONFIG_NOT_DETECTED: 'Checkout config not detected.',
} as const;

export const COMMON_DETAILS = {
  PCI_COMPLIANCE_NOTICE: 'This is required to maintain PCI compliance.',
} as const;
