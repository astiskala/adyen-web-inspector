import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromeScanBrowser } from '../../../src/background/chrome-scan-browser';
import { PAGE_GLOBALS } from '../../../src/shared/constants';
import { makePageExtract } from '../../fixtures/makeScanPayload';

type UpdatedListener = (tabId: number, changeInfo: { status?: string }) => void;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubTabs(status: string): { listeners: Set<UpdatedListener> } {
  const listeners = new Set<UpdatedListener>();
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn().mockResolvedValue({ status }),
      onUpdated: {
        addListener: (listener: UpdatedListener) => listeners.add(listener),
        removeListener: (listener: UpdatedListener) => listeners.delete(listener),
      },
    },
  });
  return { listeners };
}

describe('chromeScanBrowser.waitForTabComplete', () => {
  it('resolves at once for a loaded tab', async () => {
    const { listeners } = stubTabs('complete');

    await expect(chromeScanBrowser.waitForTabComplete(3, 1000)).resolves.toBeUndefined();
    expect(listeners.size).toBe(0);
  });

  it('waits for the tab to finish loading, ignoring other tabs', async () => {
    const { listeners } = stubTabs('loading');
    const loaded = chromeScanBrowser.waitForTabComplete(3, 1000);
    await vi.waitFor(() => {
      expect(listeners.size).toBe(1);
    });

    for (const listener of listeners) listener(4, { status: 'complete' });
    for (const listener of listeners) listener(3, { status: 'loading' });
    expect(listeners.size).toBe(1);
    for (const listener of listeners) listener(3, { status: 'complete' });

    await expect(loaded).resolves.toBeUndefined();
    expect(listeners.size).toBe(0);
  });

  it('rejects when the tab does not load within the timeout', async () => {
    vi.useFakeTimers();
    const { listeners } = stubTabs('loading');
    const loaded = chromeScanBrowser.waitForTabComplete(3, 1000);
    const assertion = expect(loaded).rejects.toThrow('Tab 3 did not finish loading within 1000ms');

    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(listeners.size).toBe(0);
  });
});

describe('chromeScanBrowser.extractFrames', () => {
  it('injects the page extractor into every frame and parses each result', async () => {
    const page = makePageExtract({ pageUrl: 'https://merchant.example/' });
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { frameId: 0, result: JSON.stringify(page) },
        { frameId: 2, result: null },
        { frameId: 3 },
      ]);
    vi.stubGlobal('chrome', { scripting: { executeScript } });

    await expect(chromeScanBrowser.extractFrames(5)).resolves.toEqual([
      { frameId: 0, result: page },
      { frameId: 2, result: null },
      { frameId: 3, result: null },
    ]);
    expect(executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 5, allFrames: true },
      files: ['page-extractor.js'],
      world: 'MAIN',
    });
    expect(executeScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ args: [PAGE_GLOBALS.pageExtractResultJson], world: 'MAIN' })
    );
  });

  it('reads the serialized extraction back from a page global', async () => {
    const executeScript = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('chrome', { scripting: { executeScript } });
    await chromeScanBrowser.extractFrames(5);
    const readGlobal = (executeScript.mock.calls[1]?.[0] as { func: (key: string) => unknown })
      .func;

    Reflect.set(globalThis, PAGE_GLOBALS.pageExtractResultJson, '{"pageUrl":"x"}');
    expect(readGlobal(PAGE_GLOBALS.pageExtractResultJson)).toBe('{"pageUrl":"x"}');
    Reflect.set(globalThis, PAGE_GLOBALS.pageExtractResultJson, 42);
    expect(readGlobal(PAGE_GLOBALS.pageExtractResultJson)).toBeNull();
    Reflect.deleteProperty(globalThis, PAGE_GLOBALS.pageExtractResultJson);
  });

  it('reports injection failures with the tab ID', async () => {
    vi.stubGlobal('chrome', {
      scripting: { executeScript: vi.fn().mockRejectedValue(new Error('Cannot access page')) },
    });

    await expect(chromeScanBrowser.extractFrames(5)).rejects.toThrow(
      'Page extraction script injection failed for tab 5: Cannot access page'
    );
  });
});

describe('chromeScanBrowser.captureNetwork', () => {
  it('observes the tab until stopped', () => {
    const event = (): {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    } => ({
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });
    const webRequest = { onHeadersReceived: event(), onBeforeRequest: event() };
    vi.stubGlobal('chrome', { webRequest });

    const capture = chromeScanBrowser.captureNetwork(5);
    expect(webRequest.onHeadersReceived.addListener).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ tabId: 5 }),
      ['responseHeaders']
    );

    expect(capture.stop()).toEqual({ responses: [], posts: [] });
    expect(webRequest.onHeadersReceived.removeListener).toHaveBeenCalled();
  });
});

describe('chromeScanBrowser clock', () => {
  it('sleeps on a timer and reads the wall clock', async () => {
    vi.useFakeTimers({ now: 1000 });
    const slept = chromeScanBrowser.sleep(500);
    await vi.advanceTimersByTimeAsync(500);

    await expect(slept).resolves.toBeUndefined();
    expect(chromeScanBrowser.now()).toBe(1500);
  });
});

/** A fetch that never settles until its abort signal fires. */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
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
}

describe('chromeScanBrowser.fetchDocumentHeaders', () => {
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

    await expect(
      chromeScanBrowser.fetchDocumentHeaders('https://merchant.example/checkout')
    ).resolves.toEqual([
      { name: 'content-security-policy', value: "default-src 'self'" },
      { name: 'x-content-type-options', value: 'nosniff' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
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

    await expect(
      chromeScanBrowser.fetchDocumentHeaders('https://merchant.example/checkout')
    ).resolves.toEqual([{ name: 'referrer-policy', value: 'same-origin' }]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://merchant.example/checkout',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('returns no headers when both probe requests time out', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const headers = chromeScanBrowser.fetchDocumentHeaders('https://merchant.example/checkout');
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(headers).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('chromeScanBrowser.fetchScriptText', () => {
  it('fetches script text without credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('adyen-web 6.9.1'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      chromeScanBrowser.fetchScriptText('https://merchant.example/main.js')
    ).resolves.toBe('adyen-web 6.9.1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://merchant.example/main.js',
      expect.objectContaining({ credentials: 'omit' })
    );
  });

  it('resolves null for error responses and timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ignored', { status: 500 })));
    await expect(chromeScanBrowser.fetchScriptText('https://merchant.example/a.js')).resolves.toBe(
      null
    );

    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const text = chromeScanBrowser.fetchScriptText('https://merchant.example/b.js');
    await vi.advanceTimersByTimeAsync(2500);
    await expect(text).resolves.toBeNull();
  });
});
