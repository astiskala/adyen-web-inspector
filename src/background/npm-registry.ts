/**
 * NPM registry client — fetches the latest adyen-web version and v6+ release dates.
 * Results are cached in chrome.storage.local for 24 hours.
 */

import {
  MIN_SUPPORTED_MAJOR_VERSION,
  NPM_CACHE_TTL_MS,
  NPM_REGISTRY_URL,
  STORAGE_NPM_CACHE_KEY,
} from '../shared/constants.js';
import { isRecord } from '../shared/utils.js';
import type { AdyenWebReleaseInfo } from './scan-browser.js';

interface NpmCacheEntry {
  readonly version: string;
  readonly releaseDates: Readonly<Record<string, string>>;
  readonly fetchedAt: number; // Unix ms
}

const STABLE_VERSION_PATTERN = /^(\d+)\.\d+\.\d+$/;

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function isNpmCacheEntry(value: unknown): value is NpmCacheEntry {
  if (!isRecord(value)) {
    return false;
  }

  const { version, releaseDates, fetchedAt } = value;
  return (
    typeof version === 'string' &&
    version.length > 0 &&
    isStringRecord(releaseDates) &&
    typeof fetchedAt === 'number' &&
    Number.isFinite(fetchedAt)
  );
}

function isSupportedStableVersion(version: string): boolean {
  const major = STABLE_VERSION_PATTERN.exec(version)?.[1];
  return major !== undefined && Number(major) >= MIN_SUPPORTED_MAJOR_VERSION;
}

/**
 * Reads `dist-tags.latest` and the publish times of supported stable versions
 * from a full npm packument. Returns null when the latest tag is missing.
 */
function parsePackument(data: unknown): AdyenWebReleaseInfo | null {
  if (!isRecord(data)) return null;
  const { 'dist-tags': distTags, time } = data;
  const latest = isRecord(distTags) ? distTags['latest'] : undefined;
  if (typeof latest !== 'string' || latest === '') return null;

  const releaseDates: Record<string, string> = {};
  if (isRecord(time)) {
    for (const [version, publishedAt] of Object.entries(time)) {
      if (typeof publishedAt === 'string' && isSupportedStableVersion(version)) {
        releaseDates[version] = publishedAt;
      }
    }
  }
  return { latest, releaseDates };
}

/**
 * Returns the latest published `@adyen/adyen-web` version with supported
 * release dates. Uses a 24-hour `chrome.storage.local` cache and returns
 * `null` on failure.
 */
export async function getAdyenWebReleaseInfo(): Promise<AdyenWebReleaseInfo | null> {
  const cached = await readCache();
  if (cached) {
    return { latest: cached.version, releaseDates: cached.releaseDates };
  }

  try {
    const response = await fetch(NPM_REGISTRY_URL);
    if (!response.ok) return null;

    const info = parsePackument(await response.json());
    if (info === null) return null;

    await writeCache({
      version: info.latest,
      releaseDates: info.releaseDates,
      fetchedAt: Date.now(),
    });
    return info;
  } catch {
    return null;
  }
}

async function readCache(): Promise<NpmCacheEntry | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_NPM_CACHE_KEY);
    const entry = result[STORAGE_NPM_CACHE_KEY];
    if (!isNpmCacheEntry(entry)) {
      if (entry !== undefined) {
        await chrome.storage.local.remove(STORAGE_NPM_CACHE_KEY);
      }
      return null;
    }

    const age = Date.now() - entry.fetchedAt;
    if (age < 0 || age > NPM_CACHE_TTL_MS) {
      await chrome.storage.local.remove(STORAGE_NPM_CACHE_KEY);
      return null;
    }

    return entry;
  } catch {
    return null;
  }
}

async function writeCache(entry: NpmCacheEntry): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_NPM_CACHE_KEY]: entry });
  } catch {
    // Non-critical — if storage fails, we just skip caching
  }
}
