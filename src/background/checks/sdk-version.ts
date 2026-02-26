import { compareVersions, parseVersion } from '../../shared/utils.js';
import { createRegistry } from './registry.js';

const RELEASE_NOTES_URL = 'https://docs.adyen.com/online-payments/release-notes/';
const UPGRADE_URL = 'https://docs.adyen.com/online-payments/upgrade-your-integration/';

const STRINGS = {
  VERSION_SKIP_TITLE: 'Version comparison skipped.',
  VERSION_NO_DETECTED_SKIP_REASON: 'Could not detect current SDK version.',
  VERSION_NO_LATEST_SKIP_REASON: 'Could not fetch latest version from npm.',
  VERSION_PARSE_FAIL_SKIP_REASON: 'Could not parse version strings.',

  DETECTED_WARN_TITLE: 'Could not determine the adyen-web SDK version.',
  DETECTED_WARN_DETAIL:
    'Without version detection, version freshness checks cannot run and outdated SDK versions may go unnoticed.',
  DETECTED_WARN_REMEDIATION:
    'Enable the exposeLibraryMetadata option in your AdyenCheckout configuration, or load the SDK from a versioned CDN URL. Without version information, the inspector cannot compare your SDK against the latest release and version-dependent checks will be skipped.',
  DETECTED_WARN_URL:
    'https://docs.adyen.com/online-payments/build-your-integration/#expose-library-metadata',

  PATCH_BEHIND_NOTICE_DETAIL:
    'Consider upgrading to pick up the latest bug fixes and security patches.',
  PATCH_BEHIND_NOTICE_REMEDIATION:
    'Update your adyen-web package to the latest patch version to pick up recent bug fixes and security patches. Patch updates are backward-compatible and low-risk to apply.',
  PATCH_BEHIND_NOTICE_URL: RELEASE_NOTES_URL,

  MINOR_BEHIND_WARN_DETAIL:
    'Consider upgrading to access the latest bug fixes, improvements, and payment methods.',
  MINOR_BEHIND_WARN_REMEDIATION:
    'Update your adyen-web package to the latest minor version within your current major version. Minor releases include bug fixes, new payment methods, and performance improvements that benefit shopper conversion.',
  MINOR_BEHIND_WARN_URL: UPGRADE_URL,

  MAJOR_BEHIND_WARN_DETAIL:
    'Consider upgrading to access the latest supported major version and improvements.',
  MAJOR_BEHIND_WARN_REMEDIATION:
    'Update your adyen-web package to the latest major version. Major releases may include breaking changes — review the release notes and migration guide before upgrading in a staging environment.',
  MAJOR_BEHIND_WARN_URL: RELEASE_NOTES_URL,
} as const;

const CATEGORY = 'version-lifecycle' as const;

export const SDK_VERSION_CHECKS = createRegistry(CATEGORY)
  .add('version-detected', (payload, { info, warn }) => {
    const detected = payload.versionInfo.detected;
    if (detected === null || detected === '') {
      return warn(
        STRINGS.DETECTED_WARN_TITLE,
        STRINGS.DETECTED_WARN_DETAIL,
        STRINGS.DETECTED_WARN_REMEDIATION,
        STRINGS.DETECTED_WARN_URL
      );
    }
    return info(`Detected adyen-web version: ${detected}.`);
  })
  .add('version-latest', (payload, { pass, skip, warn, notice }) => {
    const { detected, latest } = payload.versionInfo;
    if (detected === null || detected === '') {
      return skip(STRINGS.VERSION_SKIP_TITLE, STRINGS.VERSION_NO_DETECTED_SKIP_REASON);
    }
    if (latest === null || latest === '') {
      return skip(STRINGS.VERSION_SKIP_TITLE, STRINGS.VERSION_NO_LATEST_SKIP_REASON);
    }

    const parsedDetected = parseVersion(detected);
    const parsedLatest = parseVersion(latest);
    if (!parsedDetected || !parsedLatest) {
      return skip(STRINGS.VERSION_SKIP_TITLE, STRINGS.VERSION_PARSE_FAIL_SKIP_REASON);
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
        STRINGS.PATCH_BEHIND_NOTICE_DETAIL,
        STRINGS.PATCH_BEHIND_NOTICE_REMEDIATION,
        STRINGS.PATCH_BEHIND_NOTICE_URL
      );
    }

    if (parsedLatest.major === parsedDetected.major) {
      return warn(
        `Version ${detected} is behind latest minor version (${latest}).`,
        STRINGS.MINOR_BEHIND_WARN_DETAIL,
        STRINGS.MINOR_BEHIND_WARN_REMEDIATION,
        STRINGS.MINOR_BEHIND_WARN_URL
      );
    }

    return warn(
      `Version ${detected} is behind latest major version (${latest}).`,
      STRINGS.MAJOR_BEHIND_WARN_DETAIL,
      STRINGS.MAJOR_BEHIND_WARN_REMEDIATION,
      STRINGS.MAJOR_BEHIND_WARN_URL
    );
  })
  .getChecks();
