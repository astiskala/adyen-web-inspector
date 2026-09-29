/**
 * Version lifecycle checks (`version-lifecycle`) — detected SDK version, release freshness, and
 * the Adyen Uplift co-badged card minimum.
 */

import type { SdkVersionSource, VersionInfo } from '../../shared/types.js';
import { compareVersions, parseVersion } from '../../shared/utils.js';
import { createRegistry } from './registry.js';

const RELEASE_NOTES_URL = 'https://docs.adyen.com/online-payments/release-notes/';
const UPGRADE_URL = 'https://docs.adyen.com/online-payments/upgrade-your-integration/';
const UPLIFT_REQUIREMENTS_URL = 'https://docs.adyen.com/uplift/uplift-requirements/';
const UPLIFT_COBADGED_MINIMUM_VERSION = '6.16.0';
const RELEASE_AGE_LIMIT_MONTHS = 6;

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
  // DETECTED_INFO_TITLE stays inline (dynamic: uses the detected version)
  DETECTED_FROM_METADATA_DETAIL: 'Read from AdyenWebMetadata exposed by the SDK.',
  DETECTED_FROM_ANALYTICS_DETAIL: 'Read from Adyen checkout analytics data.',
  DETECTED_FROM_SCRIPT_URL_DETAIL: 'Read from an Adyen CDN script URL.',
  DETECTED_FROM_REQUEST_URL_DETAIL: 'Read from an Adyen CDN request URL.',
  DETECTED_FROM_BUNDLE_DETAIL:
    'Read from same-origin bundle source; this heuristic can match a version string that is not the running SDK.',

  PATCH_BEHIND_NOTICE_DETAIL:
    'Consider upgrading to pick up the latest bug fixes and security patches.',
  PATCH_BEHIND_NOTICE_REMEDIATION:
    'Update your adyen-web package to the latest patch version to pick up recent bug fixes and security patches. Patch updates are backward-compatible and low-risk to apply.',
  PATCH_BEHIND_NOTICE_URL: RELEASE_NOTES_URL,

  RECENT_MINOR_BEHIND_NOTICE_REMEDIATION:
    'Plan an update to the latest adyen-web minor version. Minor releases within the same major version add fixes, payment method updates, and improvements without breaking changes.',
  STALE_RELEASE_WARN_DETAIL: `Releases older than ${RELEASE_AGE_LIMIT_MONTHS} months miss the fixes, payment method changes, and card scheme updates published since, and fall further behind every month.`,
  STALE_RELEASE_WARN_REMEDIATION: `Update your adyen-web package to the latest version, and schedule SDK updates at least every ${RELEASE_AGE_LIMIT_MONTHS} months. Review the release notes for changes between your version and the latest release.`,

  MINOR_BEHIND_WARN_DETAIL:
    'Consider upgrading to access the latest bug fixes, improvements, and payment methods.',
  MINOR_BEHIND_WARN_REMEDIATION:
    'Update your adyen-web package to the latest minor version within your current major version. Minor releases include bug fixes, new payment methods, and performance improvements that benefit shopper conversion.',
  MINOR_BEHIND_WARN_URL: UPGRADE_URL,

  MAJOR_BEHIND_WARN_DETAIL:
    'Consider upgrading to access the latest supported major version and improvements.',
  MAJOR_BEHIND_WARN_REMEDIATION:
    'Update your adyen-web package to the latest major version. Major releases may include breaking changes. Review the release notes and migration guide before upgrading in a staging environment.',
  MAJOR_BEHIND_WARN_URL: RELEASE_NOTES_URL,

  UPLIFT_VERSION_SKIP_TITLE: 'Adyen Uplift co-badged card version check skipped.',
  UPLIFT_VERSION_SKIP_REASON: 'Could not determine the current SDK version.',
  UPLIFT_VERSION_NO_CHECKOUT_SKIP_REASON:
    'No active Drop-in or Components checkout could be verified.',
  UPLIFT_VERSION_PASS_TITLE: 'SDK version supports the Adyen Uplift co-badged card requirement.',
  UPLIFT_VERSION_FAIL_TITLE:
    'SDK version does not support the Adyen Uplift co-badged card requirement.',
  UPLIFT_VERSION_FAIL_DETAIL:
    'Adyen Uplift requires Web Drop-in or Components v6.16.0 or later to support co-badged cards.',
  UPLIFT_VERSION_FAIL_REMEDIATION:
    'Upgrade @adyen/adyen-web to v6.16.0 or later. Adyen recommends v6.18.1 or later for the documented co-badged card capability.',
} as const;

const CATEGORY = 'version-lifecycle' as const;

const VERSION_SOURCE_DETAILS: Readonly<Record<SdkVersionSource, string>> = {
  metadata: STRINGS.DETECTED_FROM_METADATA_DETAIL,
  analytics: STRINGS.DETECTED_FROM_ANALYTICS_DETAIL,
  'script-url': STRINGS.DETECTED_FROM_SCRIPT_URL_DETAIL,
  'request-url': STRINGS.DETECTED_FROM_REQUEST_URL_DETAIL,
  bundle: STRINGS.DETECTED_FROM_BUNDLE_DETAIL,
};

interface ReleaseAge {
  readonly releasedOn: string;
  readonly stale: boolean;
}

/** Classifies the detected release against the scan time; null when either date is unknown. */
function getReleaseAge(releasedAt: string | undefined, scannedAt: string): ReleaseAge | null {
  if (releasedAt === undefined) return null;
  const released = new Date(releasedAt);
  const scanned = new Date(scannedAt);
  if (Number.isNaN(released.getTime()) || Number.isNaN(scanned.getTime())) return null;
  const limit = new Date(released);
  limit.setUTCMonth(limit.getUTCMonth() + RELEASE_AGE_LIMIT_MONTHS);
  return {
    releasedOn: released.toISOString().slice(0, 10),
    stale: scanned.getTime() > limit.getTime(),
  };
}

type ParsedVersion = NonNullable<ReturnType<typeof parseVersion>>;

interface ComparableVersions {
  readonly detected: string;
  readonly latest: string;
  readonly parsedDetected: ParsedVersion;
  readonly parsedLatest: ParsedVersion;
}

/** Reads the detected and latest versions for comparison, or why they cannot be compared. */
function readComparableVersions({
  detected,
  latest,
}: VersionInfo): ComparableVersions | { readonly skipReason: string } {
  if (detected === null || detected === '') {
    return { skipReason: STRINGS.VERSION_NO_DETECTED_SKIP_REASON };
  }
  if (latest === null || latest === '') {
    return { skipReason: STRINGS.VERSION_NO_LATEST_SKIP_REASON };
  }
  const parsedDetected = parseVersion(detected);
  const parsedLatest = parseVersion(latest);
  if (!parsedDetected || !parsedLatest) {
    return { skipReason: STRINGS.VERSION_PARSE_FAIL_SKIP_REASON };
  }
  return { detected, latest, parsedDetected, parsedLatest };
}

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
    const source = payload.versionInfo.source;
    return info(
      `Detected adyen-web version: ${detected}.`,
      source === undefined ? undefined : VERSION_SOURCE_DETAILS[source]
    );
  })
  .add(
    'version-latest',
    (payload, { pass, skip, warn, notice }) => {
      const versions = readComparableVersions(payload.versionInfo);
      if ('skipReason' in versions) return skip(STRINGS.VERSION_SKIP_TITLE, versions.skipReason);
      const { detected, latest, parsedDetected, parsedLatest } = versions;

      const diff = compareVersions(parsedLatest, parsedDetected);
      if (diff <= 0) {
        return pass(`Running the latest version (${detected}).`);
      }

      const releaseAge = getReleaseAge(payload.versionInfo.detectedReleasedAt, payload.scannedAt);
      if (releaseAge?.stale === true) {
        return warn(
          `Version ${detected} was released on ${releaseAge.releasedOn}, more than ${RELEASE_AGE_LIMIT_MONTHS} months ago (latest: ${latest}).`,
          STRINGS.STALE_RELEASE_WARN_DETAIL,
          STRINGS.STALE_RELEASE_WARN_REMEDIATION,
          RELEASE_NOTES_URL
        );
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

      if (parsedLatest.major === parsedDetected.major && releaseAge?.stale === false) {
        return notice(
          `Version ${detected} is behind latest minor version (${latest}) but was released within the last ${RELEASE_AGE_LIMIT_MONTHS} months.`,
          STRINGS.MINOR_BEHIND_WARN_DETAIL,
          STRINGS.RECENT_MINOR_BEHIND_NOTICE_REMEDIATION,
          STRINGS.MINOR_BEHIND_WARN_URL
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
    },
    { noticeImpact: 'low' }
  )
  .add('uplift-cobadged-version', (payload, { attributes, fail, pass, skip }) => {
    const flavor = attributes.flavor.value;
    if (!attributes.checkoutActivity || (flavor !== 'Drop-in' && flavor !== 'Components')) {
      return skip(
        STRINGS.UPLIFT_VERSION_SKIP_TITLE,
        STRINGS.UPLIFT_VERSION_NO_CHECKOUT_SKIP_REASON
      );
    }

    const detected = parseVersion(payload.versionInfo.detected ?? '');
    const minimum = parseVersion(UPLIFT_COBADGED_MINIMUM_VERSION);

    if (detected === null || minimum === null) {
      return skip(STRINGS.UPLIFT_VERSION_SKIP_TITLE, STRINGS.UPLIFT_VERSION_SKIP_REASON);
    }

    if (compareVersions(detected, minimum) < 0) {
      return fail(
        STRINGS.UPLIFT_VERSION_FAIL_TITLE,
        STRINGS.UPLIFT_VERSION_FAIL_DETAIL,
        STRINGS.UPLIFT_VERSION_FAIL_REMEDIATION,
        UPLIFT_REQUIREMENTS_URL
      );
    }

    return pass(STRINGS.UPLIFT_VERSION_PASS_TITLE);
  })
  .getChecks();
