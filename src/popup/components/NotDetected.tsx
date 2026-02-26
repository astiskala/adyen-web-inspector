import type { JSX } from 'preact';

/**
 * Empty-state view shown when no Adyen checkout is detected on the page.
 */
export function NotDetected(): JSX.Element {
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
    </div>
  );
}
