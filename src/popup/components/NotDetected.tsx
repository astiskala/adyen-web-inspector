import type { JSX } from 'preact';

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
    <div
      style={{
        padding: '24px 12px',
        textAlign: 'center',
        color: 'var(--color-text-secondary)',
        fontSize: '12px',
        lineHeight: '1.6',
      }}
    >
      <div style={{ fontSize: '28px', marginBottom: '8px' }}>🔍</div>
      <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--color-text)' }}>
        Adyen not detected
      </div>
      <div>No Adyen Web checkout was found on this page.</div>
      <div style={{ marginTop: '12px' }}>
        <div style={{ marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
          Scan anyway?
        </div>
        <button
          class={`btn ${scanning ? '' : 'btnPrimary'}`}
          onClick={onAttemptScan}
          disabled={scanning}
          style={{ minWidth: '120px' }}
        >
          {scanning ? 'Scanning…' : 'Attempt Scan'}
        </button>
      </div>
    </div>
  );
}
