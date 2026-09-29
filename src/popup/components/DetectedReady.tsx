import type { JSX } from 'preact';
import { EmptyState } from './EmptyState.js';

/**
 * Empty-state view shown when Adyen is detected but no scan has run yet.
 */
export function DetectedReady(): JSX.Element {
  return (
    <EmptyState icon="✅" title="Adyen Web SDK detected">
      Run a scan to inspect implementation quality and security checks.
    </EmptyState>
  );
}
