/**
 * SDK version — the version believed to be running on the inspected page. It
 * owns every version signal and its precedence, the Adyen URL and bundle-text
 * patterns, and the npm release-date lookup. Fetching bundle text is the
 * caller's I/O, so the Scan passes it in through its browser port.
 *
 * The passive detector bundles this module inline, so it must stay light.
 */

import type {
  AnalyticsData,
  CapturedRequest,
  CheckoutPage,
  SdkVersionSource,
  VersionInfo,
} from './types.js';
import { extractHostname } from './utils.js';
import { parseVersion } from './version-utils.js';

/** Patterns that read a version from Adyen CDN script and asset URLs. */
const SDK_URL_VERSION_PATTERNS = [
  /checkoutshopper-sdk[./](\d+\.\d+\.\d+)/,
  /\/sdk\/(\d+\.\d+\.\d+)\//,
] as const;

/** Patterns that read a version from bundled Adyen Web source, most specific first. */
const BUNDLE_VERSION_PATTERNS = [
  /@adyen\/adyen-web\D{0,80}["'`]?(\d+\.\d+\.\d+)["'`]?/i,
  /adyen-web\D{0,80}["'`]?(\d+\.\d+\.\d+)["'`]?/i,
  /checkoutshopper\D{0,80}["'`]?(\d+\.\d+\.\d+)["'`]?/i,
] as const;

/** At most this many same-origin bundles are fetched per scan. */
const BUNDLE_FETCH_LIMIT = 4;
/** Only the start of each bundle is searched. */
const BUNDLE_TEXT_SCAN_LIMIT = 1_500_000;

/** Fetches a script's text; resolves null when it is unavailable. */
type FetchScriptText = (url: string) => Promise<string | null>;

interface VersionEvidence {
  readonly page: Pick<CheckoutPage, 'adyenMetadata' | 'scripts' | 'pageUrl'>;
  readonly analyticsData: AnalyticsData | null;
  readonly capturedRequests: readonly CapturedRequest[];
  /** Latest published version on npm, the comparison point. */
  readonly latest: string | null;
  /** Publish timestamps from npm, keyed by version. */
  readonly releaseDates?: Readonly<Record<string, string>>;
}

interface DetectedVersion {
  readonly version: string;
  readonly source: SdkVersionSource;
}

/** Returns the first SDK version found in Adyen CDN script or asset URLs. */
export function findSdkVersionInUrls(urls: Iterable<string>): string | null {
  for (const url of urls) {
    for (const pattern of SDK_URL_VERSION_PATTERNS) {
      const version = pattern.exec(url)?.[1];
      if (version !== undefined) return version;
    }
  }
  return null;
}

function findSdkVersionInBundle(text: string): string | null {
  const scanned = text.slice(0, BUNDLE_TEXT_SCAN_LIMIT);
  for (const pattern of BUNDLE_VERSION_PATTERNS) {
    const candidate = pattern.exec(scanned)?.[1];
    if (candidate !== undefined && parseVersion(candidate) !== null) return candidate;
  }
  return null;
}

function bundlePriority(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes('main')) return 5;
  if (lower.includes('vendor')) return 4;
  if (lower.includes('bundle')) return 3;
  if (lower.includes('chunk')) return 2;
  return 1;
}

/** Same-origin scripts most likely to bundle Adyen Web, in fetch order. */
function selectBundleCandidates(pageUrl: string, scriptUrls: readonly string[]): string[] {
  const pageHost = extractHostname(pageUrl);
  if (pageHost === null || pageHost === '') return [];
  const ranked = scriptUrls
    .filter((url) => extractHostname(url) === pageHost)
    .toSorted((a, b) => bundlePriority(b) - bundlePriority(a));
  return [...new Set(ranked)].slice(0, BUNDLE_FETCH_LIMIT);
}

async function findVersionInBundles(
  pageUrl: string,
  scriptUrls: readonly string[],
  fetchScriptText: FetchScriptText
): Promise<string | null> {
  for (const url of selectBundleCandidates(pageUrl, scriptUrls)) {
    const text = await fetchScriptText(url);
    const version = text === null ? null : findSdkVersionInBundle(text);
    if (version !== null) return version;
  }
  return null;
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

async function detectVersion(
  evidence: VersionEvidence,
  fetchScriptText: FetchScriptText
): Promise<DetectedVersion | null> {
  const scriptUrls = evidence.page.scripts.map((script) => script.src);
  const signals: readonly [SdkVersionSource, () => string | null][] = [
    ['metadata', (): string | null => nonEmpty(evidence.page.adyenMetadata?.version)],
    ['analytics', (): string | null => nonEmpty(evidence.analyticsData?.version)],
    ['script-url', (): string | null => findSdkVersionInUrls(scriptUrls)],
    [
      'request-url',
      (): string | null => findSdkVersionInUrls(evidence.capturedRequests.map((r) => r.url)),
    ],
  ];
  for (const [source, read] of signals) {
    const version = read();
    if (version !== null) return { version, source };
  }
  const bundled = await findVersionInBundles(evidence.page.pageUrl, scriptUrls, fetchScriptText);
  return bundled === null ? null : { version: bundled, source: 'bundle' };
}

/**
 * Resolves the running SDK version from the strongest browser signal:
 * metadata, analytics, script URLs, request URLs, then same-origin bundle
 * text, which is fetched only when no stronger signal exists.
 */
export async function resolveVersionInfo(
  evidence: VersionEvidence,
  fetchScriptText: FetchScriptText
): Promise<VersionInfo> {
  const detected = await detectVersion(evidence, fetchScriptText);
  if (detected === null) return { detected: null, latest: evidence.latest };
  const releasedAt = evidence.releaseDates?.[detected.version];
  return {
    detected: detected.version,
    source: detected.source,
    latest: evidence.latest,
    ...(releasedAt === undefined ? {} : { detectedReleasedAt: releasedAt }),
  };
}
