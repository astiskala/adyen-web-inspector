/**
 * Check registry — exports all check modules.
 */

import type { Check } from '../../shared/types.js';
import { SDK_IDENTITY_CHECKS } from './sdk-identity.js';
import { SDK_VERSION_CHECKS } from './sdk-version.js';
import { ENVIRONMENT_CHECKS } from './environment.js';
import { AUTH_CHECKS } from './auth.js';
import { CALLBACK_CHECKS } from './callbacks.js';
import { RISK_CHECKS } from './risk-module.js';
import { SECURITY_CHECKS } from './security.js';
import { CSP_CHECKS } from './security-csp.js';
import { THIRD_PARTY_CHECKS } from './third-party-scripts.js';

export const ALL_CHECKS: Check[] = [
  ...SDK_IDENTITY_CHECKS,
  ...SDK_VERSION_CHECKS,
  ...ENVIRONMENT_CHECKS,
  ...AUTH_CHECKS,
  ...CALLBACK_CHECKS,
  ...RISK_CHECKS,
  ...SECURITY_CHECKS,
  ...CSP_CHECKS,
  ...THIRD_PARTY_CHECKS,
];
