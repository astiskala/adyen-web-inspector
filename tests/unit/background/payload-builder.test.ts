import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractVersionFromBundles,
  extractVersionFromRequests,
  extractVersionFromScripts,
  probeMainDocumentHeaders,
} from '../../../src/background/payload-builder';
import { makeRequest } from '../../fixtures/makeScanPayload';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('probeMainDocumentHeaders', () => {
  it('returns headers from a successful HEAD request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: {
          'content-security-policy': "default-src 'self'",
          'x-content-type-options': 'nosniff',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeMainDocumentHeaders('https://merchant.example/checkout')).resolves.toEqual([
      { name: 'content-security-policy', value: "default-src 'self'" },
      { name: 'x-content-type-options', value: 'nosniff' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://merchant.example/checkout',
      expect.objectContaining({
        method: 'HEAD',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
      })
    );
  });

  it('falls back to GET when HEAD fails or returns no headers', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('HEAD is not supported'))
      .mockResolvedValueOnce(new Response(null, { headers: { 'referrer-policy': 'same-origin' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeMainDocumentHeaders('https://merchant.example/checkout')).resolves.toEqual([
      { name: 'referrer-policy', value: 'same-origin' },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://merchant.example/checkout',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('returns no headers when both probe requests time out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, options?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal === null || signal === undefined) {
            reject(new Error('Expected an abort signal'));
            return;
          }

          signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Request timed out', 'AbortError'));
            },
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const headers = probeMainDocumentHeaders('https://merchant.example/checkout');
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(headers).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('extractVersionFromBundles', () => {
  it('prioritizes same-origin main bundles and extracts a valid version', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/main.js')) {
        return new Response('/* @adyen/adyen-web 6.10.2 */');
      }
      return new Response('adyen-web 6.9.1');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      extractVersionFromBundles('https://merchant.example/checkout', [
        'https://cdn.example/vendor.js',
        'https://merchant.example/chunk.js',
        'https://merchant.example/main.js',
        'https://merchant.example/main.js',
      ])
    ).resolves.toBe('6.10.2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://merchant.example/main.js',
      expect.objectContaining({ credentials: 'omit' })
    );
  });

  it('continues after unusable bundles and accepts a later matching pattern', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('adyen-web 6.invalid.0'))
      .mockResolvedValueOnce(new Response('checkoutshopper build 6.11.0'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      extractVersionFromBundles('https://merchant.example/checkout', [
        'https://merchant.example/vendor.js',
        'https://merchant.example/chunk.js',
      ])
    ).resolves.toBe('6.11.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when no same-origin bundle yields a version', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('ignored', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      extractVersionFromBundles('https://merchant.example/checkout', [
        'https://merchant.example/first.js',
        'https://merchant.example/second.js',
        'https://cdn.example/third.js',
      ])
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when a bundle request times out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, options?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Request timed out', 'AbortError'));
            },
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const version = extractVersionFromBundles('https://merchant.example/checkout', [
      'https://merchant.example/main.js',
    ]);
    await vi.advanceTimersByTimeAsync(2_500);

    await expect(version).resolves.toBeNull();
  });

  it('returns null without a valid page hostname', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      extractVersionFromBundles('not a URL', ['https://merchant.example/main.js'])
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('version extraction from resource URLs', () => {
  it('extracts versions from script and request URLs', () => {
    expect(
      extractVersionFromScripts([
        'https://checkoutshopper-live.adyen.com/checkoutshopper-sdk/6.3.1/adyen.js',
      ])
    ).toBe('6.3.1');
    expect(
      extractVersionFromRequests([
        makeRequest('https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/5.1.0/adyen.js'),
      ])
    ).toBe('5.1.0');
  });

  it('returns null when resource URLs do not contain an SDK version', () => {
    expect(extractVersionFromScripts(['https://merchant.example/main.js'])).toBeNull();
    expect(
      extractVersionFromRequests([makeRequest('https://merchant.example/main.js')])
    ).toBeNull();
  });
});
