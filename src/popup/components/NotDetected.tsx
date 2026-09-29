import type { JSX } from 'preact';
import { EmptyState } from './EmptyState.js';

interface NotDetectedProps {
  readonly onAttemptScan: () => void;
  readonly scanning: boolean;
}

/**
 * Empty-state view shown when no Adyen checkout is detected on the page.
 * Offers an "Attempt Scan" escape hatch for cases where detection fails.
 */
export function NotDetected({ onAttemptScan, scanning }: NotDetectedProps): JSX.Element {
  return (
    <EmptyState
      icon="🔍"
      title="Adyen not detected"
      scanAction={{ label: 'Attempt Scan', hint: 'Scan anyway?', scanning, onScan: onAttemptScan }}
    >
      No Adyen Web checkout was found on this page.
    </EmptyState>
  );
}
