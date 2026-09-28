import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderCollector } from '../../../src/background/header-collector';
import { ANALYTICS_URL_PATTERNS } from '../../../src/shared/constants';

type HeadersListener = (details: Partial<chrome.webRequest.OnHeadersReceivedDetails>) => unknown;
type BodyListener = (details: Partial<chrome.webRequest.OnBeforeRequestDetails>) => unknown;

interface FakeEvent<L> {
  readonly addListener: ReturnType<typeof vi.fn>;
  readonly removeListener: ReturnType<typeof vi.fn>;
  listener(): L;
}

function fakeEvent<L>(): FakeEvent<L> {
  const addListener = vi.fn();
  return {
    addListener,
    removeListener: vi.fn(),
    listener: () => addListener.mock.calls[0]?.[0] as L,
  };
}

let onHeadersReceived: FakeEvent<HeadersListener>;
let onBeforeRequest: FakeEvent<BodyListener>;

function startCollector(tabId = 7): HeaderCollector {
  const collector = new HeaderCollector(tabId);
  collector.start();
  return collector;
}

function receive(details: Partial<chrome.webRequest.OnHeadersReceivedDetails>): void {
  onHeadersReceived.listener()({ statusCode: 200, responseHeaders: [], ...details });
}

function post(body: unknown, method = 'POST'): void {
  const bytes = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
  onBeforeRequest.listener()({ method, requestBody: { raw: [{ bytes: bytes.buffer }] } });
}

function sendGet(): void {
  post({ flavor: 'dropin' }, 'GET');
}

function sendWithoutBody(): void {
  onBeforeRequest.listener()({ method: 'POST' });
}

function sendWithoutBytes(): void {
  onBeforeRequest.listener()({ method: 'POST', requestBody: { raw: [{}] } });
}

function sendInvalidJson(): void {
  post('{not json');
}

function sendNonObjectJson(): void {
  post('"dropin"');
}

beforeEach(() => {
  onHeadersReceived = fakeEvent();
  onBeforeRequest = fakeEvent();
  vi.stubGlobal('chrome', { webRequest: { onHeadersReceived, onBeforeRequest } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HeaderCollector', () => {
  it('registers tab-scoped listeners on start and removes the same listeners on stop', () => {
    const collector = startCollector(42);

    expect(onHeadersReceived.addListener).toHaveBeenCalledWith(
      expect.any(Function),
      { tabId: 42, urls: ['<all_urls>'] },
      ['responseHeaders']
    );
    expect(onBeforeRequest.addListener).toHaveBeenCalledWith(
      expect.any(Function),
      { tabId: 42, urls: [...ANALYTICS_URL_PATTERNS] },
      ['requestBody']
    );

    collector.stop();

    expect(onHeadersReceived.removeListener).toHaveBeenCalledWith(onHeadersReceived.listener());
    expect(onBeforeRequest.removeListener).toHaveBeenCalledWith(onBeforeRequest.listener());
  });

  it('records main-document headers and the main-frame request', () => {
    const collector = startCollector();

    const result = onHeadersReceived.listener()({
      url: 'https://merchant.example/checkout',
      type: 'main_frame',
      statusCode: 200,
      responseHeaders: [
        { name: 'Content-Security-Policy', value: "default-src 'self'" },
        { name: 'X-Empty' },
      ],
    });

    expect(result).toBeUndefined();
    const expectedHeaders = [
      { name: 'Content-Security-Policy', value: "default-src 'self'" },
      { name: 'X-Empty', value: '' },
    ];
    expect(collector.getResult()).toEqual({
      mainDocumentHeaders: expectedHeaders,
      capturedRequests: [
        {
          url: 'https://merchant.example/checkout',
          type: 'main_frame',
          responseHeaders: expectedHeaders,
          statusCode: 200,
        },
      ],
      analyticsData: null,
    });
  });

  it('keeps the latest main-document headers after a redirect', () => {
    const collector = startCollector();

    receive({ url: 'https://merchant.example/', type: 'main_frame', statusCode: 302 });
    receive({
      url: 'https://merchant.example/checkout',
      type: 'main_frame',
      responseHeaders: [{ name: 'X-Frame-Options', value: 'DENY' }],
    });

    expect(collector.getResult().mainDocumentHeaders).toEqual([
      { name: 'X-Frame-Options', value: 'DENY' },
    ]);
  });

  it('captures Adyen requests by host and maps resource types', () => {
    const collector = startCollector();

    receive({
      url: 'https://checkoutshopper-test.cdn.adyen.com/sdk/6.31.0/adyen.js',
      type: 'script',
    });
    receive({
      url: 'https://checkoutshopper-test.cdn.adyen.com/sdk/adyen.css',
      type: 'stylesheet',
    });
    receive({
      url: 'https://checkoutanalytics-test.adyen.com/v3/analytics',
      type: 'xmlhttprequest',
    });
    receive({ url: 'https://eu.checkout-test.adyen.com/v71/sessions', type: 'xmlhttprequest' });
    receive({ url: 'https://cdn.example/app.js', type: 'script' });
    receive({ url: 'not a url', type: 'script' });

    expect(collector.getResult().capturedRequests.map(({ url, type }) => ({ url, type }))).toEqual([
      { url: 'https://checkoutshopper-test.cdn.adyen.com/sdk/6.31.0/adyen.js', type: 'script' },
      { url: 'https://checkoutshopper-test.cdn.adyen.com/sdk/adyen.css', type: 'stylesheet' },
      { url: 'https://checkoutanalytics-test.adyen.com/v3/analytics', type: 'other' },
      { url: 'https://eu.checkout-test.adyen.com/v71/sessions', type: 'other' },
    ]);
  });

  it('returns copies so callers cannot mutate collected state', () => {
    const collector = startCollector();
    onHeadersReceived.listener()({
      url: 'https://merchant.example/checkout',
      type: 'main_frame',
      statusCode: 200,
    });

    collector.getResult().capturedRequests.length = 0;

    expect(collector.getResult().capturedRequests).toEqual([
      {
        url: 'https://merchant.example/checkout',
        type: 'main_frame',
        responseHeaders: [],
        statusCode: 200,
      },
    ]);
  });

  it('merges selected string fields from analytics POST bodies, later values winning', () => {
    const collector = startCollector();

    post({ flavor: 'dropin', version: '6.31.0', channel: 'Web', ignored: 'x', locale: 42 });
    post({ version: '6.31.1', sessionId: 'CS123', platform: '', buildType: 'esm' });

    expect(collector.getResult().analyticsData).toEqual({
      flavor: 'dropin',
      version: '6.31.1',
      buildType: 'esm',
      channel: 'Web',
      sessionId: 'CS123',
    });
  });

  it.each([
    ['non-POST requests', sendGet],
    ['requests without a body', sendWithoutBody],
    ['bodies without bytes', sendWithoutBytes],
    ['invalid JSON', sendInvalidJson],
    ['non-object JSON', sendNonObjectJson],
  ])('ignores %s', (_label, send) => {
    const collector = startCollector();

    send();

    expect(collector.getResult().analyticsData).toBeNull();
  });
});
