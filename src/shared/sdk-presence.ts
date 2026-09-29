/**
 * SDK presence — whether Adyen Web is loaded on the inspected page. Presence
 * is distinct from checkout activity: a loaded SDK does not mean checkout is
 * mounted or in use.
 */

import { isAdyenCheckoutResource } from './adyen-endpoint.js';
import type { PageExtractResult, SdkPresence } from './types.js';

type PresenceEvidence = Pick<PageExtractResult, 'adyenMetadata' | 'scripts'>;

const ADYEN_SCRIPT_HINT_PATTERN = /checkoutshopper-|@adyen|adyen/i;

/** Detects SDK presence from Adyen Web metadata or an Adyen-hosted checkout script. */
export function detectSdkPresence(page: PresenceEvidence): SdkPresence {
  if (page.adyenMetadata !== null) return { detected: true, source: 'metadata' };
  if (page.scripts.some((script) => isAdyenCheckoutResource(script.src))) {
    return { detected: true, source: 'adyen-script' };
  }
  return { detected: false, source: 'none' };
}

/**
 * Returns true when any script URL mentions Adyen, including bundles hosted
 * elsewhere. This is a hint that the SDK may still be loading, not presence.
 */
export function hasAdyenScriptHint(page: Pick<PageExtractResult, 'scripts'>): boolean {
  return page.scripts.some((script) => ADYEN_SCRIPT_HINT_PATTERN.test(script.src));
}
