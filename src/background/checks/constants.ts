/**
 * Common skip reasons and titles for check runners.
 */

export const SKIP_REASONS = {
  CHECKOUT_CONFIG_NOT_DETECTED: 'Checkout config not detected.',
  NO_CSP_HEADER: 'No Content-Security-Policy header present.',
  SDK_NOT_ACTIVE: 'SDK not active on this page.',
  ADYEN_WEB_METADATA_NOT_AVAILABLE: 'AdyenWebMetadata not available.',
  NOT_A_LIVE_ENVIRONMENT: 'Not a live environment.',
  NOT_REQUIRED_FOR_TEST: 'Not required for test environment.',
  TEST_ENVIRONMENT: 'Environment is test, which uses a global endpoint.',
  CLIENT_KEY_NOT_DETECTED: 'Client key not detected.',
  NO_ADYEN_CDN_SCRIPTS: 'No Adyen CDN script tags found.',
  NO_ADYEN_CDN_STYLESHEETS: 'No Adyen CDN stylesheets found.',
  CONFIGURED_ENVIRONMENT_UNKNOWN: 'Configured environment unknown.',
  NO_ADYEN_CDN_REQUESTS: 'No Adyen CDN requests detected.',
  UNABLE_TO_DETERMINE_ENVIRONMENT: 'Unable to determine environment.',
} as const;

export const SKIP_TITLES = {
  CDN_ENVIRONMENT_CHECK_SKIPPED: 'CDN environment check skipped.',
  KEY_ENVIRONMENT_MISMATCH_CHECK_SKIPPED: 'Key-environment mismatch check skipped.',
  HTTPS_CHECK_SKIPPED: 'HTTPS check skipped.',
} as const;

export const COMMON_DETAILS = {
  PCI_COMPLIANCE_NOTICE: 'This is required to maintain PCI compliance.',
} as const;
