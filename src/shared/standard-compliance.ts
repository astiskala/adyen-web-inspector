/**
 * Standard Drop-in frontend assessment.
 *
 * This only evaluates the criteria visible to a browser extension. It does
 * not claim compliance with the complete Standard integration checklist.
 */

import type { ScanPayload, StandardCompliance } from './types.js';
import { detectIntegrationFlow, resolveIntegrationFlavor } from './implementation-attributes.js';
import { compareVersions, parseVersion } from './utils.js';

const MINIMUM_STANDARD_DROPIN_VERSION = '6.30.0';

/** Evaluates the browser-visible requirements for Adyen Standard Drop-in. */
export function computeStandardCompliance(payload: ScanPayload): StandardCompliance {
  const reasons: string[] = [];

  const detectedVersion = parseVersion(payload.versionInfo.detected ?? '');
  const minimumVersion = parseVersion(MINIMUM_STANDARD_DROPIN_VERSION);
  if (detectedVersion === null || minimumVersion === null) {
    reasons.push(`Web Drop-in ${MINIMUM_STANDARD_DROPIN_VERSION} or later could not be verified.`);
  } else if (compareVersions(detectedVersion, minimumVersion) < 0) {
    reasons.push(`Web Drop-in ${MINIMUM_STANDARD_DROPIN_VERSION} or later is required.`);
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
