import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NPM_CACHE_TTL_MS,
  NPM_REGISTRY_URL,
  STORAGE_NPM_CACHE_KEY,
} from '../../../src/shared/constants';
import { getAdyenWebReleaseInfo } from '../../../src/background/npm-registry';

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

function packument(latest: string, time: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ 'dist-tags': { latest }, time }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getAdyenWebReleaseInfo', () => {
  it('returns an unexpired cached entry without making a network request', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const storage = createStorageMock();
    storage.get.mockResolvedValue({
      [STORAGE_NPM_CACHE_KEY]: {
        version: '6.12.0',
        releaseDates: { '6.12.0': '2025-01-01T00:00:00.000Z' },
        fetchedAt: now - NPM_CACHE_TTL_MS,
      },
    });
    stubChromeStorage(storage);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAdyenWebReleaseInfo()).resolves.toEqual({
      latest: '6.12.0',
      releaseDates: { '6.12.0': '2025-01-01T00:00:00.000Z' },
    });
    expect(storage.get).toHaveBeenCalledWith(STORAGE_NPM_CACHE_KEY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { version: 6.12, releaseDates: {}, fetchedAt: 1_000_000 },
    { version: '6.12.0', releaseDates: {}, fetchedAt: '1_000_000' },
    { version: '', releaseDates: {}, fetchedAt: 1_000_000 },
    { version: '6.12.0', fetchedAt: 1_000_000 },
    { version: '6.12.0', releaseDates: { '6.12.0': 1 }, fetchedAt: 1_000_000 },
    { version: '6.12.0', releaseDates: ['6.12.0'], fetchedAt: 1_000_000 },
  ])('discards malformed or legacy cache entries: %o', async (entry: unknown) => {
    const storage = createStorageMock();
    storage.get.mockResolvedValue({ [STORAGE_NPM_CACHE_KEY]: entry });
    stubChromeStorage(storage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(packument('6.12.0')));

    await expect(getAdyenWebReleaseInfo()).resolves.toEqual({
      latest: '6.12.0',
      releaseDates: {},
    });
    expect(storage.remove).toHaveBeenCalledWith(STORAGE_NPM_CACHE_KEY);
  });

  it('discards a cache entry timestamped in the future', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const storage = createStorageMock();
    storage.get.mockResolvedValue({
      [STORAGE_NPM_CACHE_KEY]: { version: '6.12.0', releaseDates: {}, fetchedAt: now + 1 },
    });
    stubChromeStorage(storage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(packument('6.13.0')));

    await expect(getAdyenWebReleaseInfo()).resolves.toMatchObject({ latest: '6.13.0' });
    expect(storage.remove).toHaveBeenCalledWith(STORAGE_NPM_CACHE_KEY);
  });

  it('refreshes an expired cache entry and keeps only supported stable release dates', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const storage = createStorageMock();
    storage.get.mockResolvedValue({
      [STORAGE_NPM_CACHE_KEY]: {
        version: '6.11.0',
        releaseDates: {},
        fetchedAt: now - NPM_CACHE_TTL_MS - 1,
      },
    });
    stubChromeStorage(storage);
    const fetchMock = vi.fn().mockResolvedValue(
      packument('6.12.0', {
        created: '2020-01-01T00:00:00.000Z',
        modified: '2025-02-01T00:00:00.000Z',
        '5.72.0': '2024-06-01T00:00:00.000Z',
        '6.0.0-beta.1': '2024-07-01T00:00:00.000Z',
        '6.11.0': '2025-01-01T00:00:00.000Z',
        '6.12.0': '2025-02-01T00:00:00.000Z',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const releaseDates = {
      '6.11.0': '2025-01-01T00:00:00.000Z',
      '6.12.0': '2025-02-01T00:00:00.000Z',
    };
    await expect(getAdyenWebReleaseInfo()).resolves.toEqual({ latest: '6.12.0', releaseDates });
    expect(storage.remove).toHaveBeenCalledWith(STORAGE_NPM_CACHE_KEY);
    expect(fetchMock).toHaveBeenCalledWith(NPM_REGISTRY_URL);
    expect(storage.set).toHaveBeenCalledWith({
      [STORAGE_NPM_CACHE_KEY]: { version: '6.12.0', releaseDates, fetchedAt: now },
    });
  });

  it('continues without cache access when local storage fails', async () => {
    const storage = createStorageMock();
    storage.get.mockRejectedValue(new Error('storage unavailable'));
    stubChromeStorage(storage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(packument('6.12.0')));

    await expect(getAdyenWebReleaseInfo()).resolves.toMatchObject({ latest: '6.12.0' });
  });

  it('returns release info when writing the refreshed cache fails', async () => {
    const storage = createStorageMock();
    storage.set.mockRejectedValue(new Error('storage unavailable'));
    stubChromeStorage(storage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(packument('6.12.0')));

    await expect(getAdyenWebReleaseInfo()).resolves.toMatchObject({ latest: '6.12.0' });
  });

  it('returns release info without dates when the packument has no time map', async () => {
    const storage = createStorageMock();
    stubChromeStorage(storage);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ 'dist-tags': { latest: '6.12.0' } })))
    );

    await expect(getAdyenWebReleaseInfo()).resolves.toEqual({
      latest: '6.12.0',
      releaseDates: {},
    });
  });

  it('returns null for an unsuccessful registry response', async () => {
    const storage = createStorageMock();
    stubChromeStorage(storage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(getAdyenWebReleaseInfo()).resolves.toBeNull();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { 'dist-tags': null },
    { 'dist-tags': { latest: '' } },
    { 'dist-tags': { latest: 6.12 } },
  ])(
    'returns null when the registry response does not provide a latest version: %o',
    async (body: unknown) => {
      const storage = createStorageMock();
      stubChromeStorage(storage);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));

      await expect(getAdyenWebReleaseInfo()).resolves.toBeNull();
      expect(storage.set).not.toHaveBeenCalled();
    }
  );

  it('returns null when the registry request fails', async () => {
    const storage = createStorageMock();
    stubChromeStorage(storage);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));

    await expect(getAdyenWebReleaseInfo()).resolves.toBeNull();
  });
});
