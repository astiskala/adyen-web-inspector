import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NPM_CACHE_TTL_MS,
  NPM_REGISTRY_URL,
  STORAGE_NPM_CACHE_KEY,
} from '../../../src/shared/constants';
import { getLatestAdyenWebVersion } from '../../../src/background/npm-registry';

interface StorageMock {
  get: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

function createStorageMock(): StorageMock {
  return {
    get: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

function stubChromeStorage(storage: StorageMock): void {
  vi.stubGlobal('chrome', { storage: { local: storage } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getLatestAdyenWebVersion', () => {
  it('returns an unexpired cached version without making a network request', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const storage = createStorageMock();
    storage.get.mockResolvedValue({
      [STORAGE_NPM_CACHE_KEY]: { version: '6.12.0', fetchedAt: now - NPM_CACHE_TTL_MS },
    });
    stubChromeStorage(storage);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLatestAdyenWebVersion()).resolves.toBe('6.12.0');
    expect(storage.get).toHaveBeenCalledWith(STORAGE_NPM_CACHE_KEY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { version: 6.12, fetchedAt: 1_000_000 },
    { version: '6.12.0', fetchedAt: '1_000_000' },
    { version: '', fetchedAt: 1_000_000 },
  ])('discards malformed cache entries: %o', async (entry: unknown) => {
    const storage = createStorageMock();
    storage.get.mockResolvedValue({ [STORAGE_NPM_CACHE_KEY]: entry });
    stubChromeStorage(storage);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '6.12.0' })))
    );

    await expect(getLatestAdyenWebVersion()).resolves.toBe('6.12.0');
    expect(storage.remove).toHaveBeenCalledWith(STORAGE_NPM_CACHE_KEY);
  });

  it('discards a cache entry timestamped in the future', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const storage = createStorageMock();
    storage.get.mockResolvedValue({
      [STORAGE_NPM_CACHE_KEY]: { version: '6.12.0', fetchedAt: now + 1 },
    });
    stubChromeStorage(storage);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '6.13.0' })))
    );

    await expect(getLatestAdyenWebVersion()).resolves.toBe('6.13.0');
    expect(storage.remove).toHaveBeenCalledWith(STORAGE_NPM_CACHE_KEY);
  });

  it('refreshes an expired cache entry and replaces it with the latest version', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const storage = createStorageMock();
    storage.get.mockResolvedValue({
      [STORAGE_NPM_CACHE_KEY]: { version: '6.11.0', fetchedAt: now - NPM_CACHE_TTL_MS - 1 },
    });
    stubChromeStorage(storage);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ version: '6.12.0' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLatestAdyenWebVersion()).resolves.toBe('6.12.0');
    expect(storage.remove).toHaveBeenCalledWith(STORAGE_NPM_CACHE_KEY);
    expect(fetchMock).toHaveBeenCalledWith(NPM_REGISTRY_URL);
    expect(storage.set).toHaveBeenCalledWith({
      [STORAGE_NPM_CACHE_KEY]: { version: '6.12.0', fetchedAt: now },
    });
  });

  it('continues without cache access when local storage fails', async () => {
    const storage = createStorageMock();
    storage.get.mockRejectedValue(new Error('storage unavailable'));
    stubChromeStorage(storage);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '6.12.0' })))
    );

    await expect(getLatestAdyenWebVersion()).resolves.toBe('6.12.0');
  });

  it('returns the latest version when writing the refreshed cache fails', async () => {
    const storage = createStorageMock();
    storage.set.mockRejectedValue(new Error('storage unavailable'));
    stubChromeStorage(storage);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '6.12.0' })))
    );

    await expect(getLatestAdyenWebVersion()).resolves.toBe('6.12.0');
  });

  it('returns null for an unsuccessful registry response', async () => {
    const storage = createStorageMock();
    stubChromeStorage(storage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(getLatestAdyenWebVersion()).resolves.toBeNull();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it.each([{}, { version: '' }, { version: 6.12 }])(
    'returns null when the registry response does not provide a version: %o',
    async (body: unknown) => {
      const storage = createStorageMock();
      stubChromeStorage(storage);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));

      await expect(getLatestAdyenWebVersion()).resolves.toBeNull();
      expect(storage.set).not.toHaveBeenCalled();
    }
  );

  it('returns null when the registry request fails', async () => {
    const storage = createStorageMock();
    stubChromeStorage(storage);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));

    await expect(getLatestAdyenWebVersion()).resolves.toBeNull();
  });
});
