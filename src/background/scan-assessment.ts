import type { CheckoutPage, ScanPayload, ScanResult } from '../shared/types.js';
import { calculateHealthScore } from '../shared/utils.js';
import { readImplementationAttributes } from '../shared/implementation-attributes.js';
import { withRequestDerivedLocale } from '../shared/scan-evidence.js';
import { detectSdkPresence } from '../shared/sdk-presence.js';
import { resolveVersionInfo } from '../shared/sdk-version.js';
import { computeStandardCompliance } from '../shared/standard-compliance.js';
import type { CapturedTraffic } from './captured-traffic.js';
import { ALL_CHECKS } from './checks/index.js';

interface ScanEvidence {
  readonly tabId: number;
  readonly page: CheckoutPage;
  readonly traffic: CapturedTraffic;
  readonly latestVersion: string | null;
  /** Publish timestamps from npm, keyed by version. */
  readonly releaseDates?: Readonly<Record<string, string>>;
  readonly scannedAt: string;
}

/**
 * Builds the scan payload from collected evidence and runs every check against
 * it. Same-origin bundles are fetched only when no stronger version signal exists.
 */
export async function assessScan(
  evidence: ScanEvidence,
  fetchScriptText: (url: string) => Promise<string | null>
): Promise<ScanResult> {
  const { tabId, page, traffic, latestVersion, releaseDates, scannedAt } = evidence;
  const { capturedRequests, analyticsData, documentHeaders } = traffic;
  const versionInfo = await resolveVersionInfo(
    {
      page,
      analyticsData,
      capturedRequests,
      latest: latestVersion,
      ...(releaseDates === undefined ? {} : { releaseDates }),
    },
    fetchScriptText
  );

  const payload: ScanPayload = {
    tabId,
    pageUrl: page.pageUrl,
    page: withRequestDerivedLocale(page, capturedRequests),
    documentHeaders,
    capturedRequests,
    versionInfo,
    analyticsData,
    scannedAt,
  };
  const attributes = readImplementationAttributes(payload);
  const checks = ALL_CHECKS.map((check) => check.run(payload));

  return {
    tabId,
    pageUrl: payload.pageUrl,
    scannedAt: payload.scannedAt,
    sdkPresence: detectSdkPresence(payload.page),
    attributes,
    checks,
    health: calculateHealthScore(checks),
    standardCompliance: computeStandardCompliance(versionInfo.detected, attributes),
    payload,
  };
}
