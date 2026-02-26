import type { JSX } from 'preact';

/**
 * Empty-state view shown when Adyen is detected but no scan has run yet.
 */
export function DetectedReady(): JSX.Element {
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
      <div style={{ fontSize: '28px', marginBottom: '8px' }}>✅</div>
      <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--color-text)' }}>
        Adyen Web SDK detected
      </div>
      <div>Run a scan to inspect implementation quality and security checks.</div>
    </div>
  );
}
