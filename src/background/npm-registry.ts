/**
 * NPM registry client — fetches the latest adyen-web version.
 * Results are cached in chrome.storage.local for 24 hours.
 */

import { NPM_CACHE_TTL_MS, NPM_REGISTRY_URL, STORAGE_NPM_CACHE_KEY } from '../shared/constants.js';

interface NpmCacheEntry {
  version: string;
  fetchedAt: number; // Unix ms
}

interface NpmLatestResponse {
  version: string;
}

function isNpmCacheEntry(value: unknown): value is NpmCacheEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { version, fetchedAt } = value as Record<string, unknown>;
  return (
    typeof version === 'string' &&
    version.length > 0 &&
    typeof fetchedAt === 'number' &&
    Number.isFinite(fetchedAt)
  );
}

/**
 * Returns the latest published `@adyen/adyen-web` version.
 * Uses a 24-hour `chrome.storage.local` cache and returns `null` on failure.
 */
export async function getLatestAdyenWebVersion(): Promise<string | null> {
  // Check cache first
  const cached = await readCache();
  if (cached) {
    return cached.version;
  }

  try {
    const response = await fetch(NPM_REGISTRY_URL);
    if (!response.ok) return null;

    const data = (await response.json()) as NpmLatestResponse;
    const version = data.version;
    if (!version || typeof version !== 'string') return null;

    await writeCache({ version, fetchedAt: Date.now() });
    return version;
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
