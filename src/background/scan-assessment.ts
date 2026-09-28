import type {
  CapturedHeader,
  CapturedRequest,
  PageExtractResult,
  ScanPayload,
  ScanResult,
} from '../shared/types.js';
import { calculateHealthScore, extractLocaleFromUrl } from '../shared/utils.js';
import { computeStandardCompliance } from '../shared/standard-compliance.js';
import type { HeaderCollector } from './header-collector.js';
import { extractVersionFromRequests, extractVersionFromScripts } from './payload-builder.js';
import { ALL_CHECKS } from './checks/index.js';

interface ScanEvidence {
  readonly tabId: number;
  readonly page: PageExtractResult;
  readonly collected: ReturnType<HeaderCollector['getResult']>;
  readonly mainDocumentHeaders: CapturedHeader[];
  readonly latestVersion: string | null;
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

function buildFallbackRequests(pageData: PageExtractResult): CapturedRequest[] {
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
    requests.push({ url: o.url, type, responseHeaders: [], statusCode: 0 });
  }

  return requests;
}

export const assessScan = async (
  evidence: ScanEvidence,
  probeBundleVersion: (pageUrl: string, scriptUrls: string[]) => Promise<string | null>
): Promise<ScanResult> => {
  const {
    tabId,
    page: pageData,
    collected,
    mainDocumentHeaders,
    latestVersion,
    scannedAt,
  } = evidence;
  const capturedRequests = mergeCapturedRequests(
    collected.capturedRequests,
    buildFallbackRequests(pageData)
  );
  const scriptUrls = pageData.scripts.map((script) => script.src);
  const knownVersion =
    pageData.adyenMetadata?.version ??
    collected.analyticsData?.version ??
    extractVersionFromScripts(scriptUrls) ??
    extractVersionFromRequests(capturedRequests);
  const detectedVersion = knownVersion ?? (await probeBundleVersion(pageData.pageUrl, scriptUrls));

  // Enforce locale inference from captured requests if not already present
  const currentLocale = pageData.checkoutConfig?.locale ?? pageData.inferredConfig?.locale ?? '';
  let enrichedInferredConfig = pageData.inferredConfig;

  if (currentLocale === '') {
    for (const req of capturedRequests) {
      const localeFromUrl = extractLocaleFromUrl(req.url);
      if (localeFromUrl !== null) {
        enrichedInferredConfig = {
          ...(enrichedInferredConfig ?? {}),
          locale: localeFromUrl,
        };
        break;
      }
    }
  }

  const payload: ScanPayload = {
    tabId,
    pageUrl: pageData.pageUrl,
    page: { ...pageData, inferredConfig: enrichedInferredConfig },
    mainDocumentHeaders,
    mainDocumentHeadersAvailable:
      mainDocumentHeaders.length > 0 ||
      collected.capturedRequests.some(
        (request) => request.type === 'main_frame' && request.statusCode > 0
      ),
    capturedRequests,
    versionInfo: { detected: detectedVersion, latest: latestVersion },
    analyticsData: collected.analyticsData,
    scannedAt,
  };
  const checks = ALL_CHECKS.map((check) => check.run(payload));

  return {
    tabId,
    pageUrl: payload.pageUrl,
    scannedAt: payload.scannedAt,
    checks,
    health: calculateHealthScore(checks),
    standardCompliance: computeStandardCompliance(payload),
    payload,
  };
};
