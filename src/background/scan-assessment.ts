import type {
  CapturedHeader,
  CapturedRequest,
  CheckoutPage,
  ScanPayload,
  ScanResult,
} from '../shared/types.js';
import { calculateHealthScore } from '../shared/utils.js';
import { readImplementationAttributes } from '../shared/implementation-attributes.js';
import { withRequestDerivedLocale } from '../shared/scan-evidence.js';
import { detectSdkPresence } from '../shared/sdk-presence.js';
import { resolveVersionInfo } from '../shared/sdk-version.js';
import { computeStandardCompliance } from '../shared/standard-compliance.js';
import { ALL_CHECKS } from './checks/index.js';
import type { CollectedNetwork } from './scan-browser.js';

interface ScanEvidence {
  readonly tabId: number;
  readonly page: CheckoutPage;
  readonly collected: CollectedNetwork;
  readonly mainDocumentHeaders: CapturedHeader[];
  readonly latestVersion: string | null;
  /** Publish timestamps from npm, keyed by version. */
  readonly releaseDates?: Readonly<Record<string, string>>;
  readonly scannedAt: string;
}

function mergeCapturedRequests(
  primary: CapturedRequest[],
  secondary: CapturedRequest[]
): CapturedRequest[] {
  const seen = new Set<string>();
  const merged: CapturedRequest[] = [];

  for (const req of [...primary, ...secondary]) {
    if (!req.url) continue;
    const key = `${req.type}:${req.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(req);
    }
  }

  return merged;
}

function buildFallbackRequests(pageData: CheckoutPage): CapturedRequest[] {
  const requests: CapturedRequest[] = [
    { url: pageData.pageUrl, type: 'main_frame', responseHeaders: [], statusCode: 0 },
  ];

  for (const s of pageData.scripts) {
    requests.push({ url: s.src, type: 'script', responseHeaders: [], statusCode: 0 });
  }

  for (const l of pageData.links) {
    const type = l.rel.toLowerCase().includes('stylesheet') ? 'stylesheet' : 'other';
    requests.push({ url: l.href, type, responseHeaders: [], statusCode: 0 });
  }

  for (const o of pageData.observedRequests ?? []) {
    const type = o.initiatorType === 'script' ? 'script' : 'other';
    requests.push({ url: o.url, type, responseHeaders: [], statusCode: o.responseStatus ?? 0 });
  }

  return requests;
}

/**
 * Builds the scan payload from collected evidence and runs every check against
 * it. Same-origin bundles are fetched only when no stronger version signal exists.
 */
export async function assessScan(
  evidence: ScanEvidence,
  fetchScriptText: (url: string) => Promise<string | null>
): Promise<ScanResult> {
  const {
    tabId,
    page: pageData,
    collected,
    mainDocumentHeaders,
    latestVersion,
    releaseDates,
    scannedAt,
  } = evidence;
  const capturedRequests = mergeCapturedRequests(
    collected.capturedRequests,
    buildFallbackRequests(pageData)
  );
  const versionInfo = await resolveVersionInfo(
    {
      page: pageData,
      analyticsData: collected.analyticsData,
      capturedRequests,
      latest: latestVersion,
      ...(releaseDates === undefined ? {} : { releaseDates }),
    },
    fetchScriptText
  );

  const payload: ScanPayload = {
    tabId,
    pageUrl: pageData.pageUrl,
    page: withRequestDerivedLocale(pageData, capturedRequests),
    mainDocumentHeaders,
    mainDocumentHeadersAvailable:
      mainDocumentHeaders.length > 0 ||
      collected.capturedRequests.some(
        (request) => request.type === 'main_frame' && request.statusCode > 0
      ),
    capturedRequests,
    versionInfo,
    analyticsData: collected.analyticsData,
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
