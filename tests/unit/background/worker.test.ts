import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MSG_CHECKOUT_ACTIVITY_CLEARED,
  MSG_CHECKOUT_ACTIVITY_DETECTED,
  MSG_GET_TAB_STATE,
  MSG_REPORT_CHECKOUT_ACTIVITY,
  MSG_SCAN_REQUEST,
  MSG_TAB_STATE_CHANGED,
  type TabSnapshot,
} from '../../../src/shared/messages';

type MessageListener = (
  message: unknown,
  sender: { tab?: { id?: number }; url?: string; documentLifecycle?: string },
  sendResponse: (response?: unknown) => void
) => boolean;
type TabListener = (tabId: number, changeInfo: { status?: string }) => void;

const TAB = 5;
const EXTENSION_ORIGIN = 'chrome-extension://inspector/';

const harness = {} as {
  onMessage: MessageListener;
  onRemoved: (tabId: number) => void;
  onUpdated: TabListener;
  stored: Map<string, unknown>;
  isStorageFailing: boolean;
  notify: ReturnType<typeof vi.fn>;
  sendToTab: ReturnType<typeof vi.fn>;
};

function failIfAsked(): void {
  if (harness.isStorageFailing) throw new Error('storage unavailable');
}

function stubChrome(): void {
  const session = {
    get: vi.fn(async (keys: string[]) => {
      failIfAsked();
      return Object.fromEntries(
        keys.filter((key) => harness.stored.has(key)).map((key) => [key, harness.stored.get(key)])
      );
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      failIfAsked();
      for (const [key, value] of Object.entries(items)) harness.stored.set(key, value);
    }),
    remove: vi.fn(async (keys: string[]) => {
      failIfAsked();
      for (const key of keys) harness.stored.delete(key);
    }),
  };
  const listenerSlot = { addListener: vi.fn(), removeListener: vi.fn() };
  harness.notify = vi.fn().mockResolvedValue(undefined);
  harness.sendToTab = vi.fn().mockRejectedValue(new Error('Receiving end does not exist.'));
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: (onEvent: MessageListener) => (harness.onMessage = onEvent) },
      sendMessage: harness.notify,
      getURL: (path: string) => `${EXTENSION_ORIGIN}${path}`,
    },
    tabs: {
      get: vi.fn().mockRejectedValue(new Error('No tab with id: 5')),
      sendMessage: harness.sendToTab,
      onRemoved: {
        addListener: (onEvent: (tabId: number) => void) => (harness.onRemoved = onEvent),
      },
      onUpdated: { addListener: (onEvent: TabListener) => (harness.onUpdated = onEvent) },
    },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      session,
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn() },
    },
    webRequest: { onHeadersReceived: listenerSlot, onBeforeRequest: listenerSlot },
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
}

/**
Sends a runtime message to the worker; `respond` records its answer, if any.
Without a sender tab, the message comes from an extension page such as the popup.
*/
function send(
  message: unknown,
  senderTabId?: number
): { keptOpen: boolean; respond: ReturnType<typeof vi.fn> } {
  const respond = vi.fn();
  const sender =
    senderTabId === undefined
      ? { url: `${EXTENSION_ORIGIN}popup/index.html` }
      : { tab: { id: senderTabId }, url: 'https://merchant.example/checkout' };
  return { keptOpen: harness.onMessage(message, sender, respond), respond };
}

function tabSender(documentLifecycle: string): object {
  return { tab: { id: TAB }, url: 'https://merchant.example/checkout', documentLifecycle };
}

async function readTab(): Promise<unknown> {
  const { keptOpen, respond } = send({ type: MSG_GET_TAB_STATE, tabId: TAB });
  expect(keptOpen).toBe(true);
  await vi.waitFor(() => {
    expect(respond).toHaveBeenCalledTimes(1);
  });
  return respond.mock.calls[0]?.[0];
}

function lastSnapshot(): TabSnapshot | undefined {
  const published = harness.notify.mock.calls
    .map(([message]) => message as { type: string; tabId: number; snapshot: TabSnapshot })
    .filter((message) => message.type === MSG_TAB_STATE_CHANGED && message.tabId === TAB);
  return published.at(-1)?.snapshot;
}

beforeEach(async () => {
  harness.stored = new Map();
  harness.isStorageFailing = false;
  stubChrome();
  vi.resetModules();
  await import('../../../src/background/worker');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('service worker routing', () => {
  it('records checkout activity reported by a tab and clears it again', async () => {
    expect(send({ type: MSG_CHECKOUT_ACTIVITY_DETECTED, version: '6.31.0' }, TAB).keptOpen).toBe(
      false
    );
    await expect(readTab()).resolves.toMatchObject({
      checkoutActivity: { detected: true, version: '6.31.0' },
    });

    expect(send({ type: MSG_CHECKOUT_ACTIVITY_CLEARED }, TAB).keptOpen).toBe(false);
    await expect(readTab()).resolves.toMatchObject({ checkoutActivity: { detected: false } });
  });

  it('ignores activity reports that did not come from a tab, and unknown messages', async () => {
    expect(send({ type: MSG_CHECKOUT_ACTIVITY_DETECTED }).keptOpen).toBe(false);
    expect(send({ type: MSG_CHECKOUT_ACTIVITY_CLEARED }).keptOpen).toBe(false);
    expect(send({ type: 'SOMETHING_ELSE' }, TAB).keptOpen).toBe(false);

    await expect(readTab()).resolves.toMatchObject({ checkoutActivity: { detected: false } });
    expect(harness.stored.size).toBe(0);
  });

  it('ignores activity from a prerendered document, which the tab does not show yet', async () => {
    const respond = vi.fn<(response?: unknown) => void>();
    harness.onMessage({ type: MSG_CHECKOUT_ACTIVITY_DETECTED }, tabSender('prerender'), respond);
    await expect(readTab()).resolves.toMatchObject({ checkoutActivity: { detected: false } });

    harness.onMessage({ type: MSG_CHECKOUT_ACTIVITY_DETECTED }, tabSender('active'), respond);
    await expect(readTab()).resolves.toMatchObject({ checkoutActivity: { detected: true } });
  });

  it('ignores scan requests and state reads that a web page sent', async () => {
    send({ type: MSG_CHECKOUT_ACTIVITY_DETECTED }, TAB);
    await readTab();

    expect(send({ type: MSG_SCAN_REQUEST, tabId: TAB }, TAB).keptOpen).toBe(false);
    const { keptOpen, respond } = send({ type: MSG_GET_TAB_STATE, tabId: TAB }, TAB);
    expect(keptOpen).toBe(false);
    const forgedRespond = vi.fn<(response?: unknown) => void>();
    harness.onMessage(
      { type: MSG_GET_TAB_STATE, tabId: TAB },
      { url: 'https://evil.example/chrome-extension://inspector/' },
      forgedRespond
    );

    await readTab();
    expect(respond).not.toHaveBeenCalled();
    expect(forgedRespond).not.toHaveBeenCalled();
    expect(chrome.tabs.get).not.toHaveBeenCalled();
  });

  it('runs a requested scan and publishes its failure', async () => {
    expect(send({ type: MSG_SCAN_REQUEST, tabId: TAB }).keptOpen).toBe(false);

    await vi.waitFor(() => {
      expect(lastSnapshot()?.scan).toEqual({ state: 'failed', error: 'No tab with id: 5' });
    });
  });

  it('resets a tab when it starts loading a page and forgets it when closed', async () => {
    send({ type: MSG_CHECKOUT_ACTIVITY_DETECTED }, TAB);
    await readTab();

    harness.onUpdated(TAB, {});
    await expect(readTab()).resolves.toMatchObject({ checkoutActivity: { detected: true } });
    expect(harness.sendToTab).not.toHaveBeenCalled();

    harness.onUpdated(TAB, { status: 'complete' });
    await expect(readTab()).resolves.toMatchObject({ checkoutActivity: { detected: true } });
    expect(harness.sendToTab).toHaveBeenCalledWith(
      TAB,
      { type: MSG_REPORT_CHECKOUT_ACTIVITY },
      { frameId: 0 }
    );

    harness.onUpdated(TAB, { status: 'loading' });
    await expect(readTab()).resolves.toMatchObject({ checkoutActivity: { detected: false } });

    send({ type: MSG_CHECKOUT_ACTIVITY_DETECTED }, TAB);
    await readTab();
    harness.onRemoved(TAB);
    await vi.waitFor(() => {
      expect(harness.stored.size).toBe(0);
    });
  });

  it('answers null and swallows failures when the tab state cannot reach storage', async () => {
    harness.isStorageFailing = true;

    send({ type: MSG_CHECKOUT_ACTIVITY_DETECTED }, TAB);
    send({ type: MSG_CHECKOUT_ACTIVITY_CLEARED }, TAB);
    harness.onUpdated(TAB, { status: 'loading' });
    harness.onRemoved(TAB);

    await expect(readTab()).resolves.toBeNull();
  });

  it('swallows a scan whose outcome cannot be stored', async () => {
    harness.isStorageFailing = true;

    send({ type: MSG_SCAN_REQUEST, tabId: TAB });

    await vi.waitFor(() => {
      expect(chrome.tabs.get).toHaveBeenCalledWith(TAB);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(lastSnapshot()).toBeUndefined();
  });
});
