import { compareVersions, parseVersion } from '../../shared/utils.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'version-lifecycle' as const;

export const SDK_VERSION_CHECKS = createRegistry(CATEGORY)
  .add('version-detected', (payload, { info, warn }) => {
    const detected = payload.versionInfo.detected;
    if (detected === null || detected === '') {
      return warn(
        'Could not determine the adyen-web SDK version.',
        'Without version detection, version freshness checks cannot run and outdated SDK versions may go unnoticed.',
        'Enable the exposeLibraryMetadata option in your AdyenCheckout configuration, or load the SDK from a versioned CDN URL. Without version information, the inspector cannot compare your SDK against the latest release and version-dependent checks will be skipped.',
        'https://docs.adyen.com/online-payments/build-your-integration/#expose-library-metadata'
      );
    }
    return info(`Detected adyen-web version: ${detected}.`);
  })
  .add('version-latest', (payload, { pass, skip, warn, notice }) => {
    const { detected, latest } = payload.versionInfo;
    if (detected === null || detected === '') {
      return skip('Version comparison skipped — detected version unknown.');
    }
    if (latest === null || latest === '') {
      return skip('Version comparison skipped — could not fetch latest version from npm.');
    }

    const parsedDetected = parseVersion(detected);
    const parsedLatest = parseVersion(latest);
    if (!parsedDetected || !parsedLatest) {
      return skip('Version comparison skipped — could not parse version strings.');
    }

    const diff = compareVersions(parsedLatest, parsedDetected);
    if (diff <= 0) {
      return pass(`Running the latest version (${detected}).`);
    }

    if (
      parsedLatest.major === parsedDetected.major &&
      parsedLatest.minor === parsedDetected.minor
    ) {
      return notice(
        `Version ${detected} is behind latest patch (${latest}).`,
        'Consider upgrading to pick up the latest bug fixes and security patches.',
        'Update your adyen-web package to the latest patch version to pick up recent bug fixes and security patches. Patch updates are backward-compatible and low-risk to apply.',
        'https://docs.adyen.com/online-payments/release-notes/'
      );
    }

    if (parsedLatest.major === parsedDetected.major) {
      return warn(
        `Version ${detected} is behind latest minor version (${latest}).`,
        'Consider upgrading to access the latest bug fixes, improvements, and payment methods.',
        'Update your adyen-web package to the latest minor version within your current major version. Minor releases include bug fixes, new payment methods, and performance improvements that benefit shopper conversion.',
        'https://docs.adyen.com/online-payments/upgrade-your-integration/'
      );
    }

    return warn(
      `Version ${detected} is behind latest major version (${latest}).`,
      'Consider upgrading to access the latest supported major version and improvements.',
      'Update your adyen-web package to the latest major version. Major releases may include breaking changes — review the release notes and migration guide before upgrading in a staging environment.',
      'https://docs.adyen.com/online-payments/release-notes/'
    );
  })
  .getChecks();
