import type { CheckoutPage, ScanPayload, ScanResult } from '../shared/types.js';
import { calculateHealthScore } from '../shared/health.js';
import { withRequestDerivedLocale } from '../shared/scan-evidence.js';
import { resolveVersionInfo } from '../shared/sdk-version.js';
import { computeStandardCompliance } from '../shared/standard-compliance.js';
import type { CapturedTraffic } from './captured-traffic.js';
import { ALL_CHECKS, runChecks } from './checks/index.js';

interface ScanEvidence {
  readonly tabId: number;
  readonly page: CheckoutPage;
  readonly traffic: CapturedTraffic;
  readonly latestVersion: string | null;
  /**
  Publish timestamps from npm, keyed by version.
  */
  readonly releaseDates?: Readonly<Record<string, string>>;
  readonly scannedAt: string;
}

/**
Builds the scan payload from collected evidence and runs every check against
it. Same-origin bundles are fetched only when no stronger version signal exists.
*/
export async function assessScan(
  evidence: ScanEvidence,
  fetchScriptText: (url: string) => Promise<string | null>
): Promise<ScanResult> {
  const { tabId, page, traffic, latestVersion, releaseDates, scannedAt } = evidence;
  const { capturedRequests, analytics, documentHeaders } = traffic;
  const versionInfo = await resolveVersionInfo(
    {
      page,
      analytics,
      capturedRequests,
      latest: latestVersion,
      ...(releaseDates !== undefined && { releaseDates }),
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
    analytics,
    scannedAt,
  };
  const { conclusions, results: checks } = runChecks(payload, ALL_CHECKS);

  return {
    tabId,
    pageUrl: payload.pageUrl,
    scannedAt: payload.scannedAt,
    ...conclusions,
    checks,
    health: calculateHealthScore(checks),
    standardCompliance: computeStandardCompliance(versionInfo.detected, conclusions.attributes),
    payload,
  };
}
