import type { JSX } from 'preact';
import { MIN_SUPPORTED_MAJOR_VERSION } from '~shared/constants';

interface VersionOutdatedProps {
  readonly version: string;
}

/**
 * Warning state shown when the detected SDK major version is below support policy.
 */
export function VersionOutdated({ version }: VersionOutdatedProps): JSX.Element {
  return (
    <div
      style={{
        padding: '24px 12px',
        textAlign: 'center',
        fontSize: '12px',
        lineHeight: '1.6',
      }}
    >
      <div style={{ fontSize: '28px', marginBottom: '8px' }}>⚠️</div>
      <div
        style={{
          fontWeight: 600,
          marginBottom: '6px',
          color: 'var(--color-amber)',
          fontSize: '13px',
        }}
      >
        Adyen Web Version Outdated
      </div>
      <div style={{ color: 'var(--color-text-secondary)', margin: '5px 5px 10px' }}>
        This page uses Adyen Web <strong style={{ color: 'var(--color-text)' }}>v{version}</strong>,
        which is no longer actively supported. Version {MIN_SUPPORTED_MAJOR_VERSION}+ is required
        for new features, security updates, and compliance.
      </div>
      <a
        href="https://docs.adyen.com/online-payments/upgrade-your-integration/"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--color-blue)',
          textDecoration: 'none',
          fontSize: '11px',
        }}
      >
        Upgrade your integration →
      </a>
    </div>
  );
}
