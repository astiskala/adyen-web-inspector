import type { JSX } from 'preact';
import { EmptyState } from './EmptyState.js';

interface ScanErrorProps {
  readonly onRetry: () => void;
  readonly scanning: boolean;
}

/**
 * Friendly error state shown when a scan fails, such as after a timeout.
 */
export function ScanError({ onRetry, scanning }: ScanErrorProps): JSX.Element {
  return (
    <EmptyState
      icon="⚠️"
      title="Scan failed"
      scanAction={{ label: 'Try Again', scanning, onScan: onRetry }}
    >
      Something went wrong while scanning this page. Try reloading the page and scanning again.
    </EmptyState>
  );
}
