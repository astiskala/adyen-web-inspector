/**
Check registry — every registered check, and the one way to run checks:
the Scan's conclusions are drawn once from the payload and shared by all.
*/

import { readImplementationAttributes } from '../../shared/implementation-attributes.js';
import { detectSdkPresence } from '../../shared/sdk-presence.js';
import type { Check, CheckResult, ScanConclusions, ScanPayload } from '../../shared/types.js';
import { SDK_IDENTITY_CHECKS } from './sdk-identity.js';
import { SDK_VERSION_CHECKS } from './sdk-version.js';
import { ENVIRONMENT_CHECKS } from './environment.js';
import { AUTH_CHECKS } from './auth.js';
import { CALLBACK_CHECKS } from './callbacks.js';
import { RISK_CHECKS } from './risk-module.js';
import { SECURITY_CHECKS } from './security.js';
import { CSP_CHECKS } from './security-csp.js';
import { THIRD_PARTY_CHECKS } from './third-party-scripts.js';
import { STYLING_CHECKS } from './styling.js';
import { V6_DEPRECATION_CHECKS } from './v6-deprecations.js';

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
  ...STYLING_CHECKS,
  ...V6_DEPRECATION_CHECKS,
];

interface CheckRun {
  readonly conclusions: ScanConclusions;
  readonly results: CheckResult[];
}

/**
Concludes SDK presence and the implementation attributes from the payload
once, then runs each check with that same record.
*/
export function runChecks(payload: ScanPayload, checks: readonly Check[]): CheckRun {
  const conclusions: ScanConclusions = {
    sdkPresence: detectSdkPresence(payload.page),
    attributes: readImplementationAttributes(payload),
  };
  return { conclusions, results: checks.map((check) => check.run(payload, conclusions)) };
}
