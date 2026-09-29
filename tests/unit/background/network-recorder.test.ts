import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkRecorder } from '../../../src/background/network-recorder';
import { ANALYTICS_URL_PATTERNS } from '../../../src/shared/adyen-endpoint';

type HeadersListener = (details: Partial<chrome.webRequest.OnHeadersReceivedDetails>) => unknown;
type BodyListener = (details: Partial<chrome.webRequest.OnBeforeRequestDetails>) => unknown;

interface FakeEvent<L> {
  readonly addListener: ReturnType<typeof vi.fn>;
  readonly removeListener: ReturnType<typeof vi.fn>;
  listener: () => L;
}

const ANALYTICS_URL = 'https://checkoutanalytics-test.adyen.com/checkoutanalytics/v3/analytics';

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

function startRecorder(tabId = 7): NetworkRecorder {
  const recorder = new NetworkRecorder(tabId);
  recorder.start();
  return recorder;
}

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

beforeEach(() => {
  onHeadersReceived = fakeEvent();
  onBeforeRequest = fakeEvent();
  vi.stubGlobal('chrome', { webRequest: { onHeadersReceived, onBeforeRequest } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NetworkRecorder', () => {
  it('registers tab-scoped listeners on start and removes the same listeners on stop', () => {
    const recorder = startRecorder(42);

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

    recorder.stop();

    expect(onHeadersReceived.removeListener).toHaveBeenCalledWith(onHeadersReceived.listener());
    expect(onBeforeRequest.removeListener).toHaveBeenCalledWith(onBeforeRequest.listener());
  });

  it('records every response as the browser reports it', () => {
    const recorder = startRecorder();

    const returned = onHeadersReceived.listener()({
      url: 'https://merchant.example/checkout',
      type: 'main_frame',
      statusCode: 200,
      responseHeaders: [
        { name: 'Content-Security-Policy', value: "default-src 'self'" },
        { name: 'X-Empty' },
      ],
    });
    onHeadersReceived.listener()({
      url: 'https://cdn.example/font.woff2',
      type: 'font',
      statusCode: 304,
    });

    expect(returned).toBeUndefined();
    expect(recorder.result().responses).toEqual([
      {
        url: 'https://merchant.example/checkout',
        type: 'main_frame',
        statusCode: 200,
        headers: [
          { name: 'Content-Security-Policy', value: "default-src 'self'" },
          { name: 'X-Empty', value: '' },
        ],
      },
      { url: 'https://cdn.example/font.woff2', type: 'font', statusCode: 304, headers: [] },
    ]);
  });

  it('records POST bodies decoded as text, joining multi-part bodies', () => {
    const recorder = startRecorder();

    const returned = onBeforeRequest.listener()({
      url: ANALYTICS_URL,
      method: 'POST',
      requestBody: { raw: [{ bytes: bytesOf('{"flavor":') }, {}, { bytes: bytesOf('"dropin"}') }] },
    });

    expect(returned).toBeUndefined();
    expect(recorder.result().posts).toEqual([{ url: ANALYTICS_URL, body: '{"flavor":"dropin"}' }]);
  });

  it.each([
    ['non-POST requests', { method: 'GET', requestBody: { raw: [{ bytes: bytesOf('{}') }] } }],
    ['requests without a body', { method: 'POST' }],
    ['bodies without bytes', { method: 'POST', requestBody: { raw: [{}] } }],
  ])('skips %s', (_label, details) => {
    const recorder = startRecorder();

    onBeforeRequest.listener()({ url: ANALYTICS_URL, ...details });

    expect(recorder.result().posts).toEqual([]);
  });

  it('returns copies so callers cannot mutate recorded traffic', () => {
    const recorder = startRecorder();
    onHeadersReceived.listener()({
      url: 'https://merchant.example/',
      type: 'main_frame',
      statusCode: 200,
    });

    const first = recorder.result();
    (first.responses as unknown[]).length = 0;

    expect(recorder.result().responses).toHaveLength(1);
  });
});
