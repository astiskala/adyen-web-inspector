import type { JSX } from 'preact';
import { MIN_SUPPORTED_MAJOR_VERSION } from '../../shared/constants.js';
import { EmptyState } from './EmptyState.js';

const UPGRADE_LINK = {
  href: 'https://docs.adyen.com/online-payments/upgrade-your-integration/',
  label: 'Upgrade your integration →',
} as const;

interface VersionOutdatedProps {
  readonly version: string;
}

/**
 * Warning state shown when the detected SDK major version is below support policy.
 */
export function VersionOutdated({ version }: VersionOutdatedProps): JSX.Element {
  return (
    <EmptyState icon="⚠️" title="Adyen Web Version Outdated" tone="warning" link={UPGRADE_LINK}>
      This page uses Adyen Web <strong>v{version}</strong>, which is no longer actively supported.
      Version {MIN_SUPPORTED_MAJOR_VERSION}+ is required for new features, security updates, and
      compliance.
    </EmptyState>
  );
}
