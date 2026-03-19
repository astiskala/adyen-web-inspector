/**
 * Standard Integration Compliance — derives a binary compliance status
 * from check results and scan payload signals.
 */

import type { CheckResult, ScanPayload, StandardCompliance } from './types.js';
import { detectIntegrationFlow, resolveIntegrationFlavor } from './implementation-attributes.js';

/**
 * Computes whether the integration meets the Adyen standard integration criteria:
 * 1. Running the exact latest SDK version
 * 2. Using Sessions flow
 * 3. Using Drop-in
 */
export function computeStandardCompliance(
  checks: readonly CheckResult[],
  payload: ScanPayload
): StandardCompliance {
  const reasons: string[] = [];

  const versionCheck = checks.find((c) => c.id === 'version-latest');
  if (versionCheck?.severity !== 'pass') {
    reasons.push('Not using the latest SDK version.');
  }

  const flow = detectIntegrationFlow(payload);
  if (flow !== 'sessions') {
    reasons.push('Not using Sessions flow.');
  }

  const { flavor } = resolveIntegrationFlavor(payload);
  if (flavor !== 'Drop-in') {
    reasons.push('Not using Drop-in.');
  }

  return {
    compliant: reasons.length === 0,
    reasons,
  };
}
