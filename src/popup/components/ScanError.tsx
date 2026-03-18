import type { JSX } from 'preact';

interface ScanErrorProps {
  readonly onRetry: () => void;
  readonly scanning: boolean;
}

/**
 * Friendly error state shown when a scan fails (e.g. timeout).
 */
export function ScanError({ onRetry, scanning }: ScanErrorProps): JSX.Element {
  return (
    <div
      style={{
        padding: '24px 12px',
        textAlign: 'center',
        color: 'var(--color-text-secondary)',
        fontSize: '12px',
        lineHeight: '1.6',
      }}
    >
      <div style={{ fontSize: '28px', marginBottom: '8px' }}>⚠️</div>
      <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--color-text)' }}>
        Scan failed
      </div>
      <div>
        Something went wrong while scanning this page. Try reloading the page and scanning again.
      </div>
      <div style={{ marginTop: '12px' }}>
        <button
          class={`btn ${scanning ? '' : 'btnPrimary'}`}
          onClick={onRetry}
          disabled={scanning}
          style={{ minWidth: '120px' }}
        >
          {scanning ? 'Scanning…' : 'Try Again'}
        </button>
      </div>
    </div>
  );
}
